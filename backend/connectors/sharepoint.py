"""Orígenes de SharePoint por SITIO: listan todas las listas, permiten elegir una (la «principal») y traen
todas sus columnas, sin necesidad de un HAR.

- SharePointGraphSource: Microsoft Graph. Autenticación con un token o con una app de Azure AD
  (client credentials: tenant + client id + secreto) para uso continuo.
- SharePointRestSource: API REST de SharePoint (/_api). Autenticación con las cabeceras de sesión
  (Authorization/Cookie) pegadas o importadas de un HAR/curl.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, AsyncIterator
from urllib.parse import urlparse

from ..core.http_client import ConnectorError, check_response
from ..core.schema import FieldDescriptor
from .http_source import ApiSource

_NOISE = re.compile(r"(^|\.)(__metadata|__deferred|odata\\\.[a-z]+|@odata[^.]*)(\.|$)", re.I)


class SharePointSiteSource(ApiSource):
    """Lógica común: sitio, lista elegida y paginación OData."""

    max_pages = 500

    def validate(self) -> None:
        site = (self.config.get("siteUrl") or "").strip()
        u = urlparse(site)
        if u.scheme not in ("http", "https") or not u.netloc:
            raise ValueError("Indica la URL del sitio de SharePoint (p. ej. https://empresa.sharepoint.com/sites/logistica)")

    @property
    def site_url(self) -> str:
        return (self.config.get("siteUrl") or "").strip().rstrip("/")

    @property
    def collection_id(self) -> str:
        cid = (self.config.get("collectionId") or "").strip()
        if not cid:
            raise ConnectorError("Primero elige la lista principal.")
        return cid

    def is_noise_field(self, path: str) -> bool:
        return bool(_NOISE.search(path))

    async def _paged(self, url: str, params: dict | None, items_key: str = "value", next_keys: tuple = ()) -> AsyncIterator[Any]:
        page = 0
        while url and page < self.max_pages:
            data = await self.get_json(url, params=params if page == 0 else None)
            items = data.get(items_key)
            if items is None and isinstance(data.get("d"), dict):  # formato OData «verbose»
                items = data["d"].get("results")
                nxt = data["d"].get("__next")
            else:
                nxt = next((data.get(k) for k in next_keys if data.get(k)), None)
            for it in items or []:
                yield it
            url, page = nxt, page + 1


class SharePointRestSource(SharePointSiteSource):
    _SKIP = {"Edit", "LinkTitleNoMenu", "LinkTitle", "DocIcon", "ItemChildCount", "FolderChildCount", "SelectTitle", "_UIVersionString"}
    _NUMBER = {"Number", "Currency", "Integer", "Counter"}
    _ARRAY = {"MultiChoice", "LookupMulti", "UserMulti", "TaxonomyFieldTypeMulti"}
    _REF = {"Lookup", "User", "LookupMulti", "UserMulti"}

    @classmethod
    def descriptor(cls) -> dict:
        return {
            "type": "sharepoint-rest", "role": "source", "label": "SharePoint · sitio (REST, con sesión)", "supportsHar": True,
            "supportsDiscovery": True, "collectionLabel": "lista", "harImports": ["headers", "siteUrl"],
            "description": "Indica el sitio y pega las cabeceras de sesión: se listan todas las listas y eliges una. No necesitas un HAR.",
            "fields": [
                {"name": "siteUrl", "label": "URL del sitio", "type": "text", "required": True,
                 "placeholder": "https://empresa.sharepoint.com/sites/logistica"},
                {"name": "headers", "label": "Cabeceras de sesión (una por línea)", "type": "headers",
                 "help": "Authorization: Bearer … o Cookie: … (cópialo de un HAR/curl). Caducan: renuévalas si falla con 401/403."},
            ],
        }

    async def headers(self) -> dict:
        h = await super().headers()
        if not any(k.lower() == "accept" for k in h):
            h["Accept"] = "application/json;odata=nometadata"
        return h

    def _list_url(self) -> str:
        return f"{self.site_url}/_api/web/lists(guid'{self.collection_id}')"

    async def list_collections(self) -> list[dict]:
        out = []
        async for it in self._paged(f"{self.site_url}/_api/web/lists",
                                    {"$filter": "Hidden eq false", "$select": "Id,Title,ItemCount,BaseTemplate,Description"},
                                    next_keys=("odata.nextLink", "@odata.nextLink")):
            out.append({"id": it.get("Id"), "title": it.get("Title"), "count": it.get("ItemCount"),
                        "kind": "biblioteca" if it.get("BaseTemplate") == 101 else "lista", "description": it.get("Description") or ""})
        return sorted(out, key=lambda c: (c["title"] or "").lower())

    async def collection_schema(self) -> list[FieldDescriptor]:
        fields: list[FieldDescriptor] = []
        async for f in self._paged(f"{self._list_url()}/fields",
                                   {"$filter": "Hidden eq false", "$select": "InternalName,Title,TypeAsString,ReadOnlyField"},
                                   next_keys=("odata.nextLink", "@odata.nextLink")):
            name, kind = f.get("InternalName"), f.get("TypeAsString") or "Text"
            if not name or name in self._SKIP:
                continue
            if kind in self._NUMBER:
                t = "number"
            elif kind == "DateTime":
                t = "date"
            elif kind == "Boolean":
                t = "boolean"
            elif kind in self._ARRAY:
                t = "array"
            else:
                t = "string"
            path, label = name, f.get("Title") or name
            if kind in self._REF:  # en los elementos, estos campos llegan como <Nombre>Id
                path, label, t = f"{name}Id", f"{label} (id)", "array" if kind in self._ARRAY else "number"
            fields.append(FieldDescriptor(path, t, None, label))
        return fields

    async def fetch_records(self, limit: int | None = None) -> AsyncIterator[dict]:
        count = 0
        async for item in self._paged(f"{self._list_url()}/items", {"$top": "100"}, next_keys=("odata.nextLink", "@odata.nextLink")):
            yield item
            count += 1
            if limit is not None and count >= limit:
                return


class SharePointGraphSource(SharePointSiteSource):
    GRAPH = "https://graph.microsoft.com/v1.0"
    AUTHORITY = "https://login.microsoftonline.com"

    @classmethod
    def descriptor(cls) -> dict:
        return {
            "type": "sharepoint-graph", "role": "source", "label": "SharePoint · sitio (Microsoft Graph)", "supportsHar": True,
            "supportsDiscovery": True, "collectionLabel": "lista", "harImports": ["headers", "siteUrl"],
            "description": "Recomendado para uso continuo: se conecta con una app de Azure AD (o un token) y lista todas las listas del sitio.",
            "fields": [
                {"name": "siteUrl", "label": "URL del sitio", "type": "text", "required": True,
                 "placeholder": "https://empresa.sharepoint.com/sites/logistica"},
                {"name": "authMode", "label": "Autenticación", "type": "select", "default": "client-credentials",
                 "options": ["client-credentials", "token"],
                 "optionLabels": {"client-credentials": "App de Azure AD (tenant + client id + secreto)", "token": "Token Bearer pegado"}},
                {"name": "tenantId", "label": "Tenant ID", "type": "text", "showIf": {"authMode": "client-credentials"}},
                {"name": "clientId", "label": "Client ID (app registrada)", "type": "text", "showIf": {"authMode": "client-credentials"}},
                {"name": "clientSecret", "label": "Client secret", "type": "password", "showIf": {"authMode": "client-credentials"},
                 "help": "Necesita el permiso de aplicación Sites.Read.All (o Sites.Selected) con consentimiento de administrador."},
                {"name": "headers", "label": "Token (Authorization: Bearer …)", "type": "headers", "showIf": {"authMode": "token"}},
                {"name": "graphBase", "label": "Endpoint de Graph", "type": "text", "advanced": True, "default": cls.GRAPH},
                {"name": "authorityBase", "label": "Endpoint de login", "type": "text", "advanced": True, "default": cls.AUTHORITY},
            ],
        }

    def __init__(self, config: dict | None = None, **deps: Any):
        super().__init__(config, **deps)
        self._token: str | None = None
        self._token_exp = 0.0
        self._site_id: str | None = None

    def validate(self) -> None:
        super().validate()
        if (self.config.get("authMode") or "client-credentials") == "client-credentials":
            names = {"tenantId": "Tenant ID", "clientId": "Client ID", "clientSecret": "Client secret"}
            missing = [n for k, n in names.items() if not self.config.get(k)]
            if missing:
                raise ValueError("Faltan datos de la app de Azure AD: " + ", ".join(missing))
        elif not any(k.lower() == "authorization" for k in (self.config.get("headers") or {})):
            raise ValueError("Pega el token en la cabecera «Authorization: Bearer …»")

    @property
    def graph(self) -> str:
        return (self.config.get("graphBase") or self.GRAPH).rstrip("/")

    async def _access_token(self) -> str:
        if self._token and time.monotonic() < self._token_exp:
            return self._token
        authority = (self.config.get("authorityBase") or self.AUTHORITY).rstrip("/")
        res = await self.http.request(
            f"{authority}/{self.config['tenantId']}/oauth2/v2.0/token", method="POST",
            data={"client_id": self.config["clientId"], "client_secret": self.config["clientSecret"],
                  "scope": f"{self.graph.split('/v')[0]}/.default", "grant_type": "client_credentials"})
        if not res.ok:
            raise ConnectorError(f"Azure AD rechazó las credenciales de la app (HTTP {res.status}): {res.text[:200]}", res.status)
        data = json.loads(res.text)
        self._token = data["access_token"]
        self._token_exp = time.monotonic() + int(data.get("expires_in", 3600)) - 60
        return self._token

    async def headers(self) -> dict:
        h = await super().headers()
        if (self.config.get("authMode") or "client-credentials") == "client-credentials":
            h["Authorization"] = f"Bearer {await self._access_token()}"
        h.setdefault("Accept", "application/json")
        return h

    async def _site(self) -> str:
        if self._site_id:
            return self._site_id
        u = urlparse(self.site_url)
        path = u.path.rstrip("/")
        data = await self.get_json(f"{self.graph}/sites/{u.netloc}:{path}" if path else f"{self.graph}/sites/{u.netloc}")
        self._site_id = data["id"]
        return self._site_id

    async def list_collections(self) -> list[dict]:
        site = await self._site()
        out = []
        async for it in self._paged(f"{self.graph}/sites/{site}/lists", {"$select": "id,name,displayName,description,webUrl,list", "$top": "200"},
                                    next_keys=("@odata.nextLink",)):
            facet = it.get("list") or {}
            if facet.get("hidden"):
                continue
            out.append({"id": it["id"], "title": it.get("displayName") or it.get("name"), "count": None,
                        "kind": "biblioteca" if facet.get("template") == "documentLibrary" else "lista", "description": it.get("description") or ""})
        return sorted(out, key=lambda c: (c["title"] or "").lower())

    _FACET_TYPES = {"text": "string", "number": "number", "currency": "number", "dateTime": "date", "boolean": "boolean",
                    "choice": "string", "calculated": "string", "hyperlinkOrPicture": "object", "geolocation": "object"}

    async def collection_schema(self) -> list[FieldDescriptor]:
        site = await self._site()
        fields: list[FieldDescriptor] = []
        async for c in self._paged(f"{self.graph}/sites/{site}/lists/{self.collection_id}/columns", {"$top": "500"}, next_keys=("@odata.nextLink",)):
            if c.get("hidden") or not c.get("name"):
                continue
            facet = next((k for k in c if k in self._FACET_TYPES or k in ("lookup", "personOrGroup")), None)
            name, label = c["name"], c.get("displayName") or c["name"]
            if facet in ("lookup", "personOrGroup"):  # llegan como <Nombre>LookupId
                fields.append(FieldDescriptor(f"{name}LookupId", "number", None, f"{label} (id)"))
            else:
                fields.append(FieldDescriptor(name, self._FACET_TYPES.get(facet, "string"), None, label))
        if not any(f.path.lower() == "id" for f in fields):
            fields.insert(0, FieldDescriptor("id", "string", None, "ID del elemento"))
        return fields

    async def fetch_records(self, limit: int | None = None) -> AsyncIterator[dict]:
        site, count = await self._site(), 0
        async for item in self._paged(f"{self.graph}/sites/{site}/lists/{self.collection_id}/items", {"$expand": "fields", "$top": "100"},
                                      next_keys=("@odata.nextLink",)):
            rec = dict(item.get("fields") or {})
            rec.setdefault("id", item.get("id"))
            yield rec
            count += 1
            if limit is not None and count >= limit:
                return
