"""Servidores de demostración (NO son SharePoint ni Traction reales) para probar el flujo completo:

  «SharePoint» logístico  http://127.0.0.1:4001   sitio /sites/logistica con varias listas
                          · REST:   /sites/logistica/_api/web/lists...      (Authorization: Bearer demo-token)
                          · Graph:  /v1.0/sites/...  y token en /{tenant}/oauth2/v2.0/token
                                    (client id «demo-app», secreto «demo-secret»)
  «Traction» destino      http://127.0.0.1:4002   POST /api/projects crea · GET /api/projects lista

Arranque:  python examples/mock_servers.py
"""
from __future__ import annotations

import asyncio

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

DEMO_TOKEN = "demo-token"
GRAPH_TOKEN = "graph-token"
SITE_PATH = "/sites/logistica"
PAGE = 2

# (nombre interno, título, tipo REST, faceta Graph)
PROJECT_COLS = [("ID", "ID", "Counter", "number"), ("Title", "Título", "Text", "text"), ("Descripcion", "Descripción", "Note", "text"),
                ("Estado", "Estado", "Choice", "choice"), ("FechaInicio", "Fecha de inicio", "DateTime", "dateTime"),
                ("Presupuesto", "Presupuesto", "Currency", "currency"), ("Responsable", "Responsable", "Text", "text"),
                ("Email", "Correo del responsable", "Text", "text")]
SHIPMENT_COLS = [("ID", "ID", "Counter", "number"), ("Title", "Referencia", "Text", "text"), ("Origen", "Origen", "Text", "text"),
                 ("Destino", "Destino", "Text", "text"), ("FechaSalida", "Fecha de salida", "DateTime", "dateTime"),
                 ("PesoKg", "Peso (kg)", "Number", "number"), ("Entregado", "Entregado", "Boolean", "boolean")]
SUPPLIER_COLS = [("ID", "ID", "Counter", "number"), ("Title", "Razón social", "Text", "text"), ("Pais", "País", "Text", "text"),
                 ("Contacto", "Contacto", "Text", "text"), ("Email", "Correo", "Text", "text")]

PROJECTS = [
    {"ID": 1, "Title": "vision-ai", "Descripcion": "<p>Visión por <b>computador</b></p>", "Estado": "Activo", "FechaInicio": "2025-03-01T08:00:00Z", "Presupuesto": "12000,50", "Responsable": "Ana Pérez", "Email": "ana@contoso.com"},
    {"ID": 2, "Title": "portal-clientes", "Descripcion": "<p>Portal de autoservicio</p>", "Estado": "En pausa", "FechaInicio": "2025-05-15T08:00:00Z", "Presupuesto": "8000", "Responsable": "Luis Gómez", "Email": "luis@contoso.com"},
    {"ID": 3, "Title": "migracion-erp", "Descripcion": "<p>Migración a la nube</p>", "Estado": "Activo", "FechaInicio": "2025-07-01T08:00:00Z", "Presupuesto": "45000", "Responsable": "Marta Ruiz", "Email": "marta@contoso.com"},
    {"ID": 4, "Title": "chatbot-soporte", "Descripcion": "<p>Asistente de soporte</p>", "Estado": "Planificado", "FechaInicio": "2025-09-10T08:00:00Z", "Presupuesto": "6500", "Responsable": "Ana Pérez", "Email": "ana@contoso.com"},
    {"ID": 5, "Title": "data-lake", "Descripcion": "<p>Lago de datos</p>", "Estado": "Activo", "FechaInicio": "2025-10-20T08:00:00Z", "Presupuesto": "30000", "Responsable": "Luis Gómez", "Email": "luis@contoso.com"},
]
SHIPMENTS = [
    {"ID": 1, "Title": "ENV-0001", "Origen": "Valencia", "Destino": "Lyon", "FechaSalida": "2025-11-02T06:30:00Z", "PesoKg": 1250.5, "Entregado": True},
    {"ID": 2, "Title": "ENV-0002", "Origen": "Bilbao", "Destino": "Hamburgo", "FechaSalida": "2025-11-04T09:00:00Z", "PesoKg": 820, "Entregado": False},
    {"ID": 3, "Title": "ENV-0003", "Origen": "Sevilla", "Destino": "Lisboa", "FechaSalida": "2025-11-05T07:15:00Z", "PesoKg": 310.25, "Entregado": False},
]
SUPPLIERS = [
    {"ID": 1, "Title": "Transportes Atlántico", "Pais": "España", "Contacto": "Rosa Vidal", "Email": "rosa@atlantico.example"},
    {"ID": 2, "Title": "Cargo Norte", "Pais": "Alemania", "Contacto": "Jan Weber", "Email": "jan@cargonorte.example"},
]
LISTS = [
    {"id": "11111111-1111-1111-1111-111111111111", "title": "Proyectos", "desc": "Cartera de proyectos", "cols": PROJECT_COLS, "items": PROJECTS, "hidden": False, "template": "genericList", "base": 100},
    {"id": "22222222-2222-2222-2222-222222222222", "title": "Envíos", "desc": "Envíos en curso", "cols": SHIPMENT_COLS, "items": SHIPMENTS, "hidden": False, "template": "genericList", "base": 100},
    {"id": "33333333-3333-3333-3333-333333333333", "title": "Proveedores", "desc": "", "cols": SUPPLIER_COLS, "items": SUPPLIERS, "hidden": False, "template": "genericList", "base": 100},
    {"id": "44444444-4444-4444-4444-444444444444", "title": "Documentos", "desc": "", "cols": [("ID", "ID", "Counter", "number"), ("Title", "Nombre", "Text", "text")], "items": [], "hidden": False, "template": "documentLibrary", "base": 101},
    {"id": "55555555-5555-5555-5555-555555555555", "title": "Historial interno", "desc": "", "cols": [], "items": [], "hidden": True, "template": "genericList", "base": 100},
]


def _json(body, status=200):
    return JSONResponse(body, status_code=status)


def create_sharepoint_app() -> FastAPI:
    app = FastAPI(docs_url=None, openapi_url=None)
    by_id = {l["id"]: l for l in LISTS}

    def authorized(request: Request) -> bool:
        return request.headers.get("authorization") in (f"Bearer {DEMO_TOKEN}", f"Bearer {GRAPH_TOKEN}")

    def page(request: Request, items: list, key: str):
        skip = int(request.query_params.get("$skip", 0))
        chunk = items[skip:skip + PAGE]
        nxt = None
        if skip + PAGE < len(items):
            nxt = f"{request.url.scheme}://{request.url.netloc}{request.url.path}?$skip={skip + PAGE}"
        return chunk, nxt

    # ---------- REST ----------
    @app.get(SITE_PATH + "/_api/web/lists")
    async def rest_lists(request: Request):
        if not authorized(request):
            return _json({"error": "unauthorized"}, 401)
        hide = "Hidden eq false" in request.query_params.get("$filter", "")
        rows = [{"Id": l["id"], "Title": l["title"], "ItemCount": len(l["items"]), "BaseTemplate": l["base"], "Description": l["desc"], "Hidden": l["hidden"]}
                for l in LISTS if not (hide and l["hidden"])]
        return _json({"value": rows})

    @app.get(SITE_PATH + "/_api/web/lists(guid'{lid}')/fields")
    async def rest_fields(lid: str, request: Request):
        if not authorized(request):
            return _json({"error": "unauthorized"}, 401)
        lst = by_id.get(lid)
        if not lst:
            return _json({"error": "lista no encontrada"}, 404)
        extra = [{"InternalName": "Attachments", "Title": "Datos adjuntos", "TypeAsString": "Attachments", "ReadOnlyField": False},
                 {"InternalName": "Edit", "Title": "Editar", "TypeAsString": "Computed", "ReadOnlyField": True}]
        return _json({"value": [{"InternalName": n, "Title": t, "TypeAsString": rt, "ReadOnlyField": n == "ID"} for n, t, rt, _ in lst["cols"]] + extra})

    @app.get(SITE_PATH + "/_api/web/lists(guid'{lid}')/items")
    async def rest_items(lid: str, request: Request):
        if not authorized(request):
            return _json({"error": "unauthorized"}, 401)
        lst = by_id.get(lid)
        if not lst:
            return _json({"error": "lista no encontrada"}, 404)
        chunk, nxt = page(request, lst["items"], "value")
        body = {"odata.metadata": "demo", "value": [{**i, "Id": i["ID"], "odata.etag": '"1"'} for i in chunk]}
        if nxt:
            body["odata.nextLink"] = nxt
        return _json(body)

    # ---------- Microsoft Graph ----------
    @app.post("/{tenant}/oauth2/v2.0/token")
    async def token(tenant: str, request: Request):
        from urllib.parse import parse_qs
        form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
        if form.get("client_id") == "demo-app" and form.get("client_secret") == "demo-secret" and form.get("grant_type") == "client_credentials":
            return _json({"access_token": GRAPH_TOKEN, "expires_in": 3599, "token_type": "Bearer"})
        return _json({"error": "invalid_client"}, 401)

    @app.get("/v1.0/sites/{host}:" + SITE_PATH)
    async def graph_site(host: str, request: Request):
        if not authorized(request):
            return _json({"error": {"code": "InvalidAuthenticationToken"}}, 401)
        return _json({"id": f"{host},site-collection,web-id", "displayName": "Logística"})

    @app.get("/v1.0/sites/{sid}/lists")
    async def graph_lists(sid: str, request: Request):
        if not authorized(request):
            return _json({"error": {"code": "InvalidAuthenticationToken"}}, 401)
        return _json({"value": [{"id": l["id"], "name": l["title"], "displayName": l["title"], "description": l["desc"],
                                 "list": {"hidden": l["hidden"], "template": l["template"]}} for l in LISTS]})

    @app.get("/v1.0/sites/{sid}/lists/{lid}/columns")
    async def graph_columns(sid: str, lid: str, request: Request):
        if not authorized(request):
            return _json({"error": {"code": "InvalidAuthenticationToken"}}, 401)
        lst = by_id.get(lid)
        if not lst:
            return _json({"error": {"code": "itemNotFound"}}, 404)
        cols = [{"name": ("id" if n == "ID" else n), "displayName": t, "hidden": False, "readOnly": n == "ID", facet: {}} for n, t, _, facet in lst["cols"]]
        cols.append({"name": "ContentType", "displayName": "Tipo de contenido", "hidden": True, "text": {}})
        return _json({"value": cols})

    @app.get("/v1.0/sites/{sid}/lists/{lid}/items")
    async def graph_items(sid: str, lid: str, request: Request):
        if not authorized(request):
            return _json({"error": {"code": "InvalidAuthenticationToken"}}, 401)
        lst = by_id.get(lid)
        if not lst:
            return _json({"error": {"code": "itemNotFound"}}, 404)
        chunk, nxt = page(request, lst["items"], "value")
        body = {"value": [{"id": str(i["ID"]), "fields": {k: v for k, v in i.items() if k != "ID"}} for i in chunk]}
        if nxt:
            body["@odata.nextLink"] = nxt
        return _json(body)

    return app


def create_traction_app() -> FastAPI:
    app = FastAPI(docs_url=None, openapi_url=None)
    created: list[dict] = []
    app.state.created = created

    @app.api_route("/api/projects", methods=["GET", "POST"])
    async def projects(request: Request):
        if request.headers.get("authorization") != f"Bearer {DEMO_TOKEN}":
            return _json({"error": "unauthorized"}, 401)
        if request.method == "GET":
            return _json(created)
        try:
            body = await request.json()
        except ValueError:
            return _json({"error": "JSON inválido"}, 400)
        if not body.get("name"):
            return _json({"error": "name es obligatorio"}, 422)
        project = {"id": len(created) + 1, **body}
        created.append(project)
        return _json(project, 201)

    return app


async def _serve() -> None:
    import uvicorn
    servers = [uvicorn.Server(uvicorn.Config(create_sharepoint_app(), host="127.0.0.1", port=4001, log_level="warning")),
               uvicorn.Server(uvicorn.Config(create_traction_app(), host="127.0.0.1", port=4002, log_level="warning"))]
    print("«SharePoint» demo → http://127.0.0.1:4001/sites/logistica   (REST: Bearer demo-token · Graph: app demo-app / secreto demo-secret)")
    print("«Traction»  demo → http://127.0.0.1:4002/api/projects      (Bearer demo-token)")
    await asyncio.gather(*(s.serve() for s in servers))


if __name__ == "__main__":
    asyncio.run(_serve())
