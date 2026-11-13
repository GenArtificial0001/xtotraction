from __future__ import annotations

import json
from typing import Any, AsyncIterator

from ..core.connectors import SourceConnector
from ..core.http_client import ConnectorError, HttpClient, check_response, snippet
from ..core.schema import SchemaInferer


class ApiSource(SourceConnector):
    """Base de los orígenes que hablan JSON por HTTP: cabeceras, descarga y errores comunes."""

    def __init__(self, config: dict | None = None, http: HttpClient | None = None, **deps: Any):
        super().__init__(config, **deps)
        self.http = http or HttpClient()
        self.inferer = SchemaInferer()

    async def headers(self) -> dict:
        return dict(self.config.get("headers") or {})

    async def get_json(self, url: str, params: dict | None = None, method: str = "GET", body: str | None = None) -> Any:
        res = await self.http.request(url, method=method, headers=await self.headers(), params=params, body=body)
        check_response(res)
        try:
            return json.loads(res.text)
        except ValueError:
            raise ConnectorError(f"El origen no devolvió JSON (¿página de login?): {snippet(res.text, 120)}") from None


class HttpSource(ApiSource):
    """Origen genérico: cualquier endpoint HTTP que devuelva JSON (con o sin paginación)."""

    @classmethod
    def descriptor(cls) -> dict:
        return {
            "type": "http", "role": "source", "label": "Cualquier web o API (importar .har / curl)", "supportsHar": True,
            "description": "Para cualquier sistema que devuelva JSON: sube el .har (o pega un curl) de la petición que trae los datos y se cargan la URL, las cabeceras y los campos.",
            "fields": [
                {"name": "url", "label": "URL origen", "type": "text", "required": True, "placeholder": "https://api.ejemplo.com/proyectos"},
                {"name": "method", "label": "Método", "type": "select", "options": ["GET", "POST"], "default": "GET"},
                {"name": "headers", "label": "Cabeceras / autenticación (una por línea: Nombre: valor)", "type": "headers"},
                {"name": "body", "label": "Cuerpo de la petición (opcional)", "type": "textarea"},
                {"name": "itemsPath", "label": "Ruta de la lista de registros", "type": "text", "default": "auto",
                 "help": "«auto» la detecta sola. Usa «$» si la respuesta ya es una lista, o p. ej. «data.items»."},
            ],
        }

    def validate(self) -> None:
        if not self.resolve_url():
            raise ValueError("Falta la URL del origen")
        if (self.config.get("method") or "GET").upper() not in ("GET", "POST"):
            raise ValueError("Método no soportado en el origen")

    def resolve_url(self) -> str:
        return self.config.get("url") or ""

    def next_url(self, data: Any, current: str) -> str | None:
        return None

    max_pages = 200

    async def fetch_records(self, limit: int | None = None) -> AsyncIterator[dict]:
        url, page, count = self.resolve_url(), 0, 0
        while url and page < self.max_pages and (limit is None or count < limit):
            first = page == 0
            data = await self.get_json(url, method=(self.config.get("method") or "GET").upper() if first else "GET",
                                       body=self.config.get("body") if first else None)
            for item in self.inferer.extract_items(data, self.config.get("itemsPath"))["items"]:
                yield item
                count += 1
                if limit is not None and count >= limit:
                    return
            url, page = self.next_url(data, url), page + 1
