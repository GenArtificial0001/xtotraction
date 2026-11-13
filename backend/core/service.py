from __future__ import annotations

from typing import Any

from ..storage.repository import ConfigRepository
from ..storage.secrets import SecretMasker
from .mapper import Mapper
from .registry import ConnectorRegistry
from .schema import FieldDescriptor
from .sync_job import SyncJob
from .transforms import TransformRegistry


class ValidationError(ValueError):
    """Configuración inválida (se responde 400)."""


class SyncService:
    """Fachada de aplicación: valida configuraciones, instancia conectores y ejecuta consultas y jobs."""

    def __init__(self, registry: ConnectorRegistry, repository: ConfigRepository,
                 transforms: TransformRegistry | None = None, deps: dict | None = None):
        self.registry, self.repository = registry, repository
        self.transforms = transforms or TransformRegistry.with_defaults()
        self.deps = deps or {}  # dependencias inyectables a los conectores (p. ej. HttpClient en tests)

    def meta(self) -> dict:
        return {"sources": self.registry.descriptors("source"), "targets": self.registry.descriptors("target"),
                "transforms": self.transforms.list()}

    def resolve(self, config: Any) -> dict:
        """Sustituye valores enmascarados por los guardados (si la configuración ya existe)."""
        if not isinstance(config, dict):
            raise ValidationError("Configuración ausente")
        stored = None
        if config.get("id"):
            try:
                stored = self.repository.get(config["id"])
            except ValueError:
                stored = None
        return SecretMasker.restore(config, stored)

    def _build(self, role: str, cfg: dict):
        try:
            return self.registry.create(role, cfg, **self.deps)
        except ValueError as err:
            raise ValidationError(f"{'Origen' if role == 'source' else 'Destino'}: {err}") from None

    def _source(self, raw: dict):
        return self._build("source", self.resolve(raw).get("source") or {})

    async def preview(self, raw: dict, limit: int = 5) -> dict:
        records, fields = await self._source(raw).discover_fields(min(max(int(limit or 5), 1), 25))
        return {"fields": [f.to_dict() for f in fields], "records": records}

    async def collections(self, raw: dict) -> dict:
        return {"collections": await self._source(raw).list_collections()}

    async def schema(self, raw: dict, limit: int = 5) -> dict:
        """Todas las columnas de la colección elegida (con ejemplos tomados de los primeros registros)."""
        source = self._source(raw)
        columns = await source.collection_schema()
        records = await source.sample(min(max(int(limit or 5), 1), 25))
        by_path = {f.path: f for f in columns}
        for rec in records:
            for path, f in by_path.items():
                if f.sample in (None, "") and rec.get(path) not in (None, ""):
                    f.sample = rec[path]
        fields: list[FieldDescriptor] = list(by_path.values())
        return {"fields": [f.to_dict() for f in fields], "records": records}

    def describe_target(self, config: dict) -> dict:
        return {"fields": [f.to_dict() for f in self._build("target", config).describe_fields()]}

    def build_job(self, raw: dict, dry_run: bool = True, limit: int | None = None) -> SyncJob:
        config = self.resolve(raw)
        source = self._build("source", config.get("source") or {})
        target = self._build("target", config.get("target") or {})
        mappings = config.get("mappings")
        if not isinstance(mappings, list) or not mappings:
            raise ValidationError("No hay ningún mapeo definido")
        try:
            mapper = Mapper(mappings, self.transforms)
        except ValueError as err:
            raise ValidationError(f"Mapeo: {err}") from None
        opts = config.get("options") or {}
        try:
            lim = int(limit) if limit and int(limit) > 0 else None
            delay = max(0, int(opts.get("delayMs") or 0))
        except (TypeError, ValueError):
            raise ValidationError("Opciones numéricas inválidas") from None
        return SyncJob(source, target, mapper, dry_run=dry_run is not False, limit=lim, delay_ms=delay,
                       stop_on_error=bool(opts.get("stopOnError")))
