import pytest

from backend.core.mapper import Mapper, MappingRule
from backend.core.object_path import ObjectPath
from backend.core.schema import SchemaInferer
from backend.core.transforms import TransformRegistry
from backend.connectors.http_target import HttpTarget
from backend.storage.repository import FileConfigRepository, InvalidId
from backend.storage.secrets import MASK, SecretMasker


def test_object_path_anidado_indices_y_claves_con_punto():
    o = {}
    ObjectPath.set(o, "a.b.0.c", 1)
    assert o == {"a": {"b": [{"c": 1}]}}
    assert ObjectPath.get(o, "a.b.0.c") == 1
    assert ObjectPath.get({"odata.etag": "x"}, "odata\\.etag") == "x"
    assert ObjectPath.get(o, "a.z.y") is None
    assert ObjectPath.has({"a": None}, "a") and not ObjectPath.has({}, "a")


def test_object_path_bloquea_claves_peligrosas():
    with pytest.raises(ValueError):
        ObjectPath.set({}, "__class__.x", 1)
    with pytest.raises(ValueError):
        ObjectPath.set({}, "a.__proto__.x", 1)


def test_schema_aplana_tipos_y_detecta_lista():
    inf = SchemaInferer()
    by = {f.path: f.type for f in inf.flatten({"Title": "x", "n": 2, "ok": True, "d": "2025-01-01T00:00:00Z", "owner": {"name": "a"}, "tags": ["a"], "k.y": 1})}
    assert by == {"Title": "string", "n": "number", "ok": "boolean", "d": "date", "owner.name": "string", "tags": "array", "k\\.y": "number"}
    assert inf.find_items_path([{"a": 1}]) == ""
    assert inf.find_items_path({"value": [{"a": 1}]}) == "value"
    assert inf.find_items_path({"d": {"results": [{"a": 1}, {"a": 2}]}}) == "d.results"
    assert inf.find_items_path({"x": 1}) is None
    assert inf.extract_items({"a": {"b": [{"i": 1}]}}, "a.b")["items"] == [{"i": 1}]
    assert inf.extract_items([{"i": 1}], "$")["items"] == [{"i": 1}]


def test_mapper_transformaciones_constantes_y_avisos():
    m = Mapper([{"source": "Title", "target": "name", "transform": "upper"}, {"source": "R.EMail", "target": "owner.email"},
                {"source": None, "target": "status", "constant": "active"}, {"source": "NoExiste", "target": "x"}])
    values, warnings = m.map({"Title": "vision-ai", "R": {"EMail": "a@b.c"}})
    assert values == {"name": "VISION-AI", "owner.email": "a@b.c", "status": "active"}
    assert len(warnings) == 1
    with pytest.raises(ValueError, match="origen ni valor fijo"):
        MappingRule(target="t")
    with pytest.raises(ValueError, match="desconocida"):
        Mapper([{"source": "a", "target": "b", "transform": "inexistente"}])


def test_transformaciones():
    t = TransformRegistry.with_defaults()
    assert t.get("number").apply("12000,50") == 12000.5
    assert t.get("number").apply("8000") == 8000 and isinstance(t.get("number").apply("8000"), int)
    assert t.get("number").apply("abc") is None
    assert t.get("stripHtml").apply("<p>Hola <b>mundo</b> &amp; más</p>") == "Hola mundo & más"
    assert t.get("dateOnly").apply("2025-03-01T08:00:00Z") == "2025-03-01"
    assert t.get("isoDate").apply("2025-03-01T08:00:00Z") == "2025-03-01T08:00:00.000Z"
    assert t.get("isoDate").apply("01/03/2025") == "2025-03-01T00:00:00.000Z"
    assert t.get("boolean").apply("Sí") is True


def test_secret_masker_cabeceras_y_secretos():
    cfg = {"source": {"headers": {"Authorization": "Bearer abc", "Accept": "json"}, "clientSecret": "s3", "tenantId": "t"},
           "target": {"headers": {"Cookie": "sid=1"}}}
    masked = SecretMasker.mask(cfg)
    assert masked["source"]["headers"] == {"Authorization": MASK, "Accept": "json"}
    assert masked["source"]["clientSecret"] == MASK and masked["source"]["tenantId"] == "t"
    assert cfg["source"]["clientSecret"] == "s3"  # no muta
    assert SecretMasker.restore(masked, cfg) == cfg
    nuevo = SecretMasker.restore({**masked, "source": {**masked["source"], "clientSecret": "otro"}}, cfg)
    assert nuevo["source"]["clientSecret"] == "otro"


def test_http_target_plantilla_url_con_marcadores_y_formulario():
    t = HttpTarget({"url": "https://t/api/p/{{id}}", "method": "PUT", "bodyTemplate": '{"id":0,"name":"","owner":{"email":""},"keep":"fijo"}'})
    req = t.build_request({"id": 7, "name": "vision-ai", "owner.email": "a@b.c"})
    assert req["url"] == "https://t/api/p/7"
    assert req["json"] == {"id": 7, "name": "vision-ai", "owner": {"email": "a@b.c"}, "keep": "fijo"}
    assert req["headers"]["Content-Type"] == "application/json"
    assert [f.path for f in t.describe_fields()] == ["id", "name", "owner.email", "keep"]
    with pytest.raises(ValueError, match="marcador"):
        HttpTarget({"url": "https://t/{{ref}}", "bodyTemplate": "{}"}).build_request({"name": "x"})
    form = HttpTarget({"url": "https://t", "bodyFormat": "form", "bodyTemplate": {"a": ""}})
    assert form.build_request({"a": "x y"})["body"] == "a=x+y"
    with pytest.raises(ValueError, match="JSON"):
        HttpTarget({"url": "https://t", "bodyTemplate": "{rota"}).validate()


def test_repositorio_valida_ids(tmp_path):
    repo = FileConfigRepository(tmp_path)
    saved = repo.save({"name": "x"})
    assert repo.get(saved["id"])["name"] == "x"
    assert (tmp_path / f"{saved['id']}.json").stat().st_mode & 0o777 == 0o600
    with pytest.raises(InvalidId):
        repo.get("../../etc/passwd")
    assert repo.delete(saved["id"]) and not repo.delete(saved["id"])
