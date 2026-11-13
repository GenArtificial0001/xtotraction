import httpx
import pytest
from fastapi.testclient import TestClient

from backend.core.http_client import HttpClient
from backend.main import create_app
from examples.mock_servers import create_sharepoint_app, create_traction_app


class HostRouter(httpx.AsyncBaseTransport):
    """Enruta cada host a una app ASGI en memoria: las pruebas no abren sockets ni usan la red."""

    def __init__(self, routes: dict):
        self.routes = {host: httpx.ASGITransport(app=app) for host, app in routes.items()}

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        t = self.routes.get(request.url.netloc.decode())
        if t is None:
            raise httpx.ConnectError(f"host sin simular: {request.url.netloc.decode()}")
        return await t.handle_async_request(request)


@pytest.fixture
def world():
    traction = create_traction_app()
    return {"traction": traction, "transport": HostRouter({"sp.test": create_sharepoint_app(), "tr.test": traction})}


@pytest.fixture
def http(world):
    return HttpClient(transport=world["transport"])


@pytest.fixture
def client(tmp_path, http):
    return TestClient(create_app(data_dir=tmp_path / "data", deps={"http": http}))


REST_SOURCE = {"type": "sharepoint-rest", "siteUrl": "http://sp.test/sites/logistica", "headers": {"Authorization": "Bearer demo-token"}}
GRAPH_SOURCE = {"type": "sharepoint-graph", "siteUrl": "http://sp.test/sites/logistica", "authMode": "client-credentials",
                "tenantId": "t1", "clientId": "demo-app", "clientSecret": "demo-secret",
                "graphBase": "http://sp.test/v1.0", "authorityBase": "http://sp.test"}
TARGET = {"type": "http", "url": "http://tr.test/api/projects", "method": "POST", "bodyFormat": "json",
          "headers": {"Authorization": "Bearer demo-token"},
          "bodyTemplate": '{"name": "", "description": "", "status": "x", "budget": 0, "owner": {"name": "", "email": ""}, "tags": ["importado"]}'}
PROJECTS_ID = "11111111-1111-1111-1111-111111111111"
