"""Aplicación FastAPI: API JSON + frontend estático (HTML/CSS/JS).

Arranque:  uvicorn backend.main:app --port 3000
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .connectors import create_default_registry
from .core.http_client import ConnectorError
from .core.registry import ConnectorRegistry
from .core.service import SyncService, ValidationError
from .storage.repository import FileConfigRepository, InvalidId
from .storage.secrets import SecretMasker

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
MAX_BODY = 5 * 1024 * 1024


def create_app(data_dir: str | Path | None = None, registry: ConnectorRegistry | None = None,
               deps: dict | None = None, serve_frontend: bool = True) -> FastAPI:
    repo = FileConfigRepository(data_dir or os.environ.get("DATA_DIR") or ROOT / "data")
    service = SyncService(registry or create_default_registry(), repo, deps=deps)
    app = FastAPI(title="Traction Sync", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.service, app.state.repo = service, repo

    # ---- errores → {"error": "..."} (lo que espera el frontend)
    def err(status: int, message: str) -> JSONResponse:
        return JSONResponse({"error": message}, status_code=status)

    @app.exception_handler(ValidationError)
    async def _validation(_: Request, e: ValidationError):
        return err(400, str(e))

    @app.exception_handler(InvalidId)
    async def _invalid_id(_: Request, e: InvalidId):
        return err(400, str(e))

    @app.exception_handler(ConnectorError)
    async def _connector(_: Request, e: ConnectorError):
        return err(502, str(e))

    @app.middleware("http")
    async def _limit_body(request: Request, call_next):
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            return err(413, "Cuerpo demasiado grande")
        return await call_next(request)

    # ---- API
    @app.get("/api/meta")
    async def meta():
        return service.meta()

    @app.get("/api/configs")
    async def list_configs():
        return repo.list()

    @app.get("/api/configs/{id_}")
    async def get_config(id_: str):
        c = repo.get(id_)
        return SecretMasker.mask(c) if c else err(404, "Configuración no encontrada")

    @app.post("/api/configs")
    async def save_config(body: dict = Body(...)):
        if body.get("id") and not repo.is_valid_id(body["id"]):
            raise InvalidId("Identificador inválido")
        return SecretMasker.mask(repo.save(service.resolve(body)))

    @app.delete("/api/configs/{id_}")
    async def delete_config(id_: str):
        return {"ok": True} if repo.delete(id_) else err(404, "Configuración no encontrada")

    @app.post("/api/source/preview")
    async def source_preview(body: dict = Body(...)):
        return await service.preview({"id": body.get("id"), "source": body.get("source")}, body.get("limit") or 5)

    @app.post("/api/source/collections")
    async def source_collections(body: dict = Body(...)):
        return await service.collections({"id": body.get("id"), "source": body.get("source")})

    @app.post("/api/source/schema")
    async def source_schema(body: dict = Body(...)):
        return await service.schema({"id": body.get("id"), "source": body.get("source")}, body.get("limit") or 5)

    @app.post("/api/target/describe")
    async def target_describe(body: dict = Body(...)):
        return service.describe_target(body.get("target") or {})

    @app.post("/api/run")
    async def run(body: dict = Body(...)):
        job = service.build_job(body.get("config"), dry_run=body.get("dryRun") is not False, limit=body.get("limit"))

        async def stream():
            async for ev in job.run():
                yield json.dumps(ev, ensure_ascii=False) + "\n"

        return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    if serve_frontend:  # al final: las rutas /api tienen prioridad
        app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
    return app


app = create_app()
