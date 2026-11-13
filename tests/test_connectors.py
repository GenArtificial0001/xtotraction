import asyncio

import pytest

from backend.connectors import create_default_registry
from backend.core.http_client import ConnectorError
from tests.conftest import GRAPH_SOURCE, PROJECTS_ID, REST_SOURCE

run = asyncio.run


def make(role_cfg, http, **extra):
    return create_default_registry().create("source", {**role_cfg, **extra}, http=http)


def collect(source, limit=None):
    async def go():
        return [r async for r in source.fetch_records(limit=limit)]
    return run(go())


@pytest.mark.parametrize("cfg", [REST_SOURCE, GRAPH_SOURCE], ids=["rest", "graph"])
def test_lista_las_listas_del_sitio_sin_ocultas(http, cfg):
    cols = run(make(cfg, http).list_collections())
    assert [c["title"] for c in cols] == ["Documentos", "Envíos", "Proveedores", "Proyectos"]  # sin «Historial interno»
    assert {c["title"]: c["kind"] for c in cols}["Documentos"] == "biblioteca"
    assert next(c["id"] for c in cols if c["title"] == "Proyectos") == PROJECTS_ID


@pytest.mark.parametrize("cfg", [REST_SOURCE, GRAPH_SOURCE], ids=["rest", "graph"])
def test_trae_todas_las_columnas_con_etiqueta_y_tipo(http, cfg):
    fields = run(make(cfg, http, collectionId=PROJECTS_ID).collection_schema())
    by = {f.path.lower(): f for f in fields}
    assert {"title", "descripcion", "estado", "fechainicio", "presupuesto", "responsable", "email"} <= set(by)
    assert by["title"].label == "Título" and by["fechainicio"].type == "date" and by["presupuesto"].type == "number"
    assert "edit" not in by and "contenttype" not in by  # columnas técnicas fuera


@pytest.mark.parametrize("cfg", [REST_SOURCE, GRAPH_SOURCE], ids=["rest", "graph"])
def test_recorre_todas_las_paginas(http, cfg):
    recs = collect(make(cfg, http, collectionId=PROJECTS_ID))
    assert [r["Title"] for r in recs] == ["vision-ai", "portal-clientes", "migracion-erp", "chatbot-soporte", "data-lake"]
    assert len(collect(make(cfg, http, collectionId=PROJECTS_ID), limit=3)) == 3


def test_sin_lista_elegida_pide_elegirla(http):
    with pytest.raises(ConnectorError, match="lista principal"):
        run(make(REST_SOURCE, http).collection_schema())


def test_token_caducado_da_pista_clara(http):
    bad = {**REST_SOURCE, "headers": {"Authorization": "Bearer caducado"}}
    with pytest.raises(ConnectorError, match="caducó"):
        run(make(bad, http).list_collections())


def test_graph_credenciales_de_app_incorrectas(http):
    with pytest.raises(ConnectorError, match="Azure AD rechazó"):
        run(make({**GRAPH_SOURCE, "clientSecret": "mal"}, http).list_collections())


def test_graph_con_token_pegado(http):
    cfg = {"type": "sharepoint-graph", "siteUrl": GRAPH_SOURCE["siteUrl"], "authMode": "token", "headers": {"Authorization": "Bearer graph-token"},
           "graphBase": GRAPH_SOURCE["graphBase"]}
    assert len(run(make(cfg, http).list_collections())) == 4


def test_validaciones_de_configuracion(http):
    reg = create_default_registry()
    with pytest.raises(ValueError, match="URL del sitio"):
        reg.create("source", {"type": "sharepoint-rest"}, http=http)
    with pytest.raises(ValueError, match="Client secret"):
        reg.create("source", {"type": "sharepoint-graph", "siteUrl": "https://x.sharepoint.com", "tenantId": "t", "clientId": "c"}, http=http)
    with pytest.raises(ValueError, match="Bearer"):
        reg.create("source", {"type": "sharepoint-graph", "siteUrl": "https://x.sharepoint.com", "authMode": "token"}, http=http)
    with pytest.raises(ValueError, match="desconocido"):
        reg.create("source", {"type": "nope"})


def test_origen_http_generico_con_har_style_config(http):
    cfg = {"type": "http", "url": f"http://sp.test/sites/logistica/_api/web/lists(guid'{PROJECTS_ID}')/items",
           "headers": {"Authorization": "Bearer demo-token"}, "itemsPath": "auto"}
    src = make(cfg, http)
    recs = collect(src)
    assert len(recs) == 2  # el genérico no sabe paginar OData: solo la primera página
    records, fields = run(src.discover_fields(5))
    assert "Title" in [f.path for f in fields]
