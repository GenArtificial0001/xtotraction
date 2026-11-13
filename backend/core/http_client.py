from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx


class ConnectorError(Exception):
    """Error al hablar con un origen o un destino (mensaje pensado para mostrarse al usuario)."""

    def __init__(self, message: str, status: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass
class HttpResponse:
    ok: bool
    status: int
    reason: str
    headers: dict = field(default_factory=dict)
    text: str = ""


def snippet(text: str | None, n: int = 300) -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:n]


class HttpClient:
    """Envoltorio de httpx con timeout, validación de protocolo y errores legibles."""

    def __init__(self, timeout: float = 30.0, transport: httpx.AsyncBaseTransport | None = None):
        self.timeout = timeout
        self.transport = transport

    async def request(self, url: str, method: str = "GET", headers: dict | None = None, body: str | None = None,
                      params: dict | None = None, data: dict | None = None, timeout: float | None = None) -> HttpResponse:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ConnectorError(f"URL inválida o con protocolo no permitido: {url}")
        try:
            async with httpx.AsyncClient(timeout=timeout or self.timeout, follow_redirects=True, transport=self.transport) as c:
                r = await c.request(method, url, headers=headers or {}, params=params, data=data,
                                    content=body.encode("utf-8") if body else None)
        except httpx.TimeoutException:
            raise ConnectorError(f"Tiempo de espera agotado al llamar a {parsed.netloc}") from None
        except UnicodeError:
            raise ConnectorError("Alguna cabecera tiene caracteres no válidos (revisa lo copiado del navegador).") from None
        except httpx.HTTPError as err:
            raise ConnectorError(f"No se pudo conectar con {parsed.netloc}: {err}") from None
        return HttpResponse(r.is_success, r.status_code, r.reason_phrase, dict(r.headers), r.text)


def check_response(res: HttpResponse, who: str = "El origen") -> None:
    if res.ok:
        return
    hint = ""
    if res.status in (401, 403):
        hint = " · La sesión o el token probablemente caducó (o no tiene permisos): renueva las credenciales."
    raise ConnectorError(f"{who} respondió HTTP {res.status} {res.reason}{hint} — {snippet(res.text, 160)}", res.status, res.text)
