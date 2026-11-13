import json

from tests.conftest import GRAPH_SOURCE, PROJECTS_ID, REST_SOURCE, TARGET

MAPPINGS = [
    {"source": "Title", "target": "name"},
    {"source": "Descripcion", "target": "description", "transform": "stripHtml"},
    {"source": "Presupuesto", "target": "budget", "transform": "number"},
    {"source": "Responsable", "target": "owner.name"},
    {"source": "Email", "target": "owner.email"},
    {"source": None, "target": "status", "constant": "active"},
]


def config(source):
    return {"name": "Proyectos → destino", "source": {**source, "collectionId": PROJECTS_ID}, "target": TARGET, "mappings": MAPPINGS}


def run(client, cfg, **opts):
    r = client.post("/api/run", json={"config": cfg, **opts})
    return r.status_code, [json.loads(l) for l in r.text.strip().splitlines()] if r.status_code == 200 else r.json()


def test_flujo_descubrimiento_listas_columnas(client):
    cols = client.post("/api/source/collections", json={"source": REST_SOURCE}).json()["collections"]
    assert "Proyectos" in [c["title"] for c in cols]
    schema = client.post("/api/source/schema", json={"source": {**REST_SOURCE, "collectionId": PROJECTS_ID}}).json()
    by = {f["path"]: f for f in schema["fields"]}
    assert by["Title"]["label"] == "Título" and by["Title"]["sample"] == "vision-ai"
    assert by["Presupuesto"]["sample"] == "12000,50"
    assert len(schema["records"]) == 5


def test_simulacro_no_envia_y_muestra_la_peticion(client, world):
    status, evs = run(client, config(REST_SOURCE), dryRun=True)
    assert status == 200 and not world["traction"].state.created
    recs = [e for e in evs if e["type"] == "record"]
    assert recs[0]["request"]["body"] == {"name": "vision-ai", "description": "Visión por computador", "status": "active", "budget": 12000.5,
                                          "owner": {"name": "Ana Pérez", "email": "ana@contoso.com"}, "tags": ["importado"]}
    assert evs[-1] == {"type": "done", "total": 5, "ok": 5, "failed": 0, "aborted": False, "dryRun": True}


def test_envio_real_desde_graph_con_limite(client, world):
    status, evs = run(client, config(GRAPH_SOURCE), dryRun=False, limit=3)
    assert evs[-1]["ok"] == 3 and evs[-1]["total"] == 3
    created = world["traction"].state.created
    assert [p["name"] for p in created] == ["vision-ai", "portal-clientes", "migracion-erp"]
    assert created[0]["owner"]["email"] == "ana@contoso.com"


def test_error_por_registro_no_aborta_y_credencial_mala_se_informa(client):
    cfg = config(REST_SOURCE)
    cfg["mappings"] = [m for m in cfg["mappings"] if m["target"] != "name"]  # el destino exige name → 422
    _, evs = run(client, cfg, dryRun=False, limit=2)
    assert evs[-1]["failed"] == 2 and "422" in next(e for e in evs if e["type"] == "record")["error"]
    bad = config({**REST_SOURCE, "headers": {"Authorization": "Bearer caducado"}})
    _, evs = run(client, bad, dryRun=True)
    assert "caducó" in next(e for e in evs if e["type"] == "error")["error"]


def test_configuraciones_guardadas_enmascaran_secretos_y_los_conservan(client):
    saved = client.post("/api/configs", json=config(GRAPH_SOURCE)).json()
    assert saved["id"] and saved["source"]["clientSecret"] != "demo-secret"
    loaded = client.get(f"/api/configs/{saved['id']}").json()
    assert "demo-secret" not in json.dumps(loaded) and "demo-token" not in json.dumps(loaded)
    _, evs = run(client, loaded, dryRun=True, limit=1)  # el servidor restaura el secreto guardado
    assert evs[-1]["ok"] == 1
    assert client.get("/api/configs").json()[0]["id"] == saved["id"]
    assert client.delete(f"/api/configs/{saved['id']}").status_code == 200
    assert client.get(f"/api/configs/{saved['id']}").status_code == 404
    assert client.get("/api/configs/..%2F..%2Fetc").status_code in (400, 404)


def test_validaciones_y_meta(client):
    assert client.post("/api/run", json={"config": {"source": {"type": "nope"}, "target": {}}}).status_code == 400
    assert client.post("/api/run", json={"config": {**config(REST_SOURCE), "mappings": []}}).status_code == 400
    assert client.post("/api/source/collections", json={"source": {"type": "http", "url": "http://x"}}).status_code == 502
    meta = client.get("/api/meta").json()
    assert [s["type"] for s in meta["sources"]] == ["http", "sharepoint-graph", "sharepoint-rest"]
    assert [t["type"] for t in meta["targets"]] == ["http"]
    assert next(s for s in meta["sources"] if s["type"] == "sharepoint-rest")["supportsDiscovery"] is True


def test_frontend_estatico_y_sin_path_traversal(client):
    assert "xtox" in client.get("/").text
    assert client.get("/shared/HarParser.js").status_code == 200
    assert client.get("/%2e%2e/backend/main.py").status_code == 404
    assert client.get("/../backend/main.py").status_code == 404
