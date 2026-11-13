from __future__ import annotations

from .connectors import SourceConnector, TargetConnector


class ConnectorRegistry:
    """Catálogo de conectores disponibles por rol (source|target) y tipo."""

    def __init__(self):
        self._classes: dict[str, dict[str, type]] = {"source": {}, "target": {}}

    def register(self, cls: type) -> "ConnectorRegistry":
        d = cls.descriptor()
        if d["role"] not in self._classes:
            raise ValueError(f"Rol de conector desconocido: {d['role']}")
        self._classes[d["role"]][d["type"]] = cls
        return self

    def create(self, role: str, config: dict, **deps):
        cls = self._classes[role].get((config or {}).get("type"))
        if cls is None:
            raise ValueError(f"Tipo de {'origen' if role == 'source' else 'destino'} desconocido: {(config or {}).get('type')}")
        instance = cls(config, **deps)
        instance.validate()
        return instance

    def descriptors(self, role: str) -> list[dict]:
        return [c.descriptor() for c in self._classes[role].values()]
