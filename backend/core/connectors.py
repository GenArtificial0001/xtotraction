"""Contratos de origen y destino. Para soportar uno nuevo basta con heredar, implementar y registrar."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

from .http_client import ConnectorError
from .schema import FieldDescriptor, SchemaInferer


class SourceConnector(ABC):
    """ORIGEN de datos (SharePoint, una API, un CSV…).

    Obligatorio: `descriptor` y `fetch_records`.
    Opcional (descubrimiento): `list_collections` y `collection_schema`, para orígenes donde primero se
    elige una colección (p. ej. una lista de SharePoint, una tabla) y luego se mapean todas sus columnas.
    """

    @classmethod
    @abstractmethod
    def descriptor(cls) -> dict:
        """Metadatos: type, role, label, fields (la interfaz genera el formulario con esto)."""

    def __init__(self, config: dict | None = None, **_deps: Any):
        self.config = config or {}

    def validate(self) -> None:
        """Lanza ValueError si la configuración es inválida."""

    @abstractmethod
    def fetch_records(self, limit: int | None = None) -> AsyncIterator[dict]:
        """Generador asíncrono de registros (diccionarios)."""

    def is_noise_field(self, path: str) -> bool:
        return False

    # --- descubrimiento (opcional) ---
    async def list_collections(self) -> list[dict]:
        raise ConnectorError("Este origen no permite listar colecciones.")

    async def collection_schema(self) -> list[FieldDescriptor]:
        raise ConnectorError("Este origen no describe sus columnas; usa «Probar» para traer una muestra.")

    # --- utilidades comunes ---
    async def sample(self, n: int = 5) -> list[dict]:
        out: list[dict] = []
        async for rec in self.fetch_records(limit=n):
            out.append(rec)
            if len(out) >= n:
                break
        return out

    async def discover_fields(self, n: int = 5) -> tuple[list[dict], list[FieldDescriptor]]:
        records = await self.sample(n)
        fields = SchemaInferer().infer_from_records(records, exclude=self.is_noise_field)
        return records, fields


class TargetConnector(ABC):
    """DESTINO de datos: recibe {ruta_destino: valor} por registro y lo envía."""

    @classmethod
    @abstractmethod
    def descriptor(cls) -> dict: ...

    def __init__(self, config: dict | None = None, **_deps: Any):
        self.config = config or {}

    def validate(self) -> None:
        pass

    def describe_fields(self) -> list[FieldDescriptor]:
        return []

    @abstractmethod
    def build_request(self, values: dict) -> dict: ...

    @abstractmethod
    async def send(self, values: dict, dry_run: bool = False) -> dict:
        """Devuelve {ok, status, request, response?, error?}."""
