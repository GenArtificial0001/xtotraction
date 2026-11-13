from __future__ import annotations

import copy
import json
import re
from typing import Any
from urllib.parse import quote, urlencode

from ..core.connectors import TargetConnector
from ..core.http_client import HttpClient, snippet
from ..core.object_path import ObjectPath
from ..core.schema import FieldDescriptor, SchemaInferer

METHODS = ["POST", "PUT", "PATCH"]


class HttpTarget(TargetConnector):
    """Destino HTTP genérico (Traction u otro sistema: la URL puede cambiar en cada configuración).

    Usa como plantilla el cuerpo de una petición real (p. ej. importada de un .har o un curl): los campos
    mapeados sustituyen sus valores y el resto de la plantilla se conserva. La URL admite marcadores
    {{ruta.del.campo}} resueltos con el cuerpo final (útil en PUT /proyectos/{{id}}).
    """

    @classmethod
    def descriptor(cls) -> dict:
        return {
            "type": "http", "role": "target", "label": "Cualquier web o API (importar .har / curl)", "supportsHar": True,
            "description": "Sube el .har (o pega un curl) de la petición que crea un registro en el destino (Traction u otra web). Su cuerpo es la plantilla y sus campos son los campos destino.",
            "fields": [
                {"name": "name", "label": "Nombre del destino", "type": "text", "placeholder": "Traction"},
                {"name": "url", "label": "URL destino", "type": "text", "required": True, "placeholder": "https://destino.ejemplo.com/api/projects"},
                {"name": "method", "label": "Método", "type": "select", "options": METHODS, "default": "POST"},
                {"name": "headers", "label": "Cabeceras / autenticación (una por línea)", "type": "headers"},
                {"name": "bodyFormat", "label": "Formato del cuerpo", "type": "select", "options": ["json", "form"], "default": "json"},
                {"name": "bodyTemplate", "label": "Plantilla del cuerpo (JSON)", "type": "json",
                 "help": "Sus campos son los campos destino. Los valores no mapeados se envían tal cual."},
            ],
        }

    def __init__(self, config: dict | None = None, http: HttpClient | None = None, **deps: Any):
        super().__init__(config, **deps)
        self.http = http or HttpClient()
        self.inferer = SchemaInferer()

    @property
    def template(self) -> Any:
        t = self.config.get("bodyTemplate")
        if t in (None, ""):
            return {}
        return json.loads(t) if isinstance(t, str) else t

    def validate(self) -> None:
        if not self.config.get("url"):
            raise ValueError("Falta la URL del destino")
        if (self.config.get("method") or "POST").upper() not in METHODS:
            raise ValueError("Método no soportado en el destino")
        try:
            _ = self.template
        except ValueError:
            raise ValueError("La plantilla del cuerpo no es JSON válido") from None

    def describe_fields(self) -> list[FieldDescriptor]:
        return self.inferer.flatten(self.template)

    def build_request(self, values: dict) -> dict:
        body = copy.deepcopy(self.template)
        for path, value in values.items():
            ObjectPath.set(body, path, value)

        def repl(m: re.Match) -> str:
            v = ObjectPath.get(body, m.group(1).strip())
            if v is None:
                raise ValueError(f"El marcador {{{{{m.group(1).strip()}}}}} de la URL no tiene valor")
            return quote(str(v), safe="")

        url = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", repl, self.config["url"])
        headers = dict(self.config.get("headers") or {})
        has = lambda n: any(k.lower() == n for k in headers)  # noqa: E731
        if self.config.get("bodyFormat") == "form":
            payload = urlencode([(k, json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else ("" if v is None else str(v)))
                                 for k, v in body.items()])
            if not has("content-type"):
                headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            payload = json.dumps(body, ensure_ascii=False)
            if not has("content-type"):
                headers["Content-Type"] = "application/json"
        return {"method": (self.config.get("method") or "POST").upper(), "url": url, "headers": headers, "body": payload, "json": body}

    async def send(self, values: dict, dry_run: bool = False) -> dict:
        req = self.build_request(values)
        preview = {"method": req["method"], "url": req["url"], "body": req["json"]}
        if dry_run:
            return {"ok": True, "status": None, "dryRun": True, "request": preview}
        res = await self.http.request(req["url"], method=req["method"], headers=req["headers"], body=req["body"])
        out = {"ok": res.ok, "status": res.status, "request": preview, "response": snippet(res.text, 400)}
        if not res.ok:
            out["error"] = f"HTTP {res.status} {res.reason} — {snippet(res.text, 200)}"
        return out
