from __future__ import annotations

from typing import Any

from .object_path import ObjectPath
from .transforms import TransformRegistry

_MISSING = object()


class MappingRule:
    """Un vínculo: campo de origen (o valor fijo) → campo de destino, con transformación opcional."""

    def __init__(self, target: str, source: str | None = None, transform: str | None = None, constant: Any = _MISSING):
        if not target:
            raise ValueError("Cada regla necesita un campo destino")
        if not source and constant is _MISSING:
            raise ValueError(f"El destino «{target}» no tiene origen ni valor fijo")
        self.source = source or None
        self.target = target
        self.transform = transform or "none"
        self.constant = constant

    @classmethod
    def from_dict(cls, d: dict) -> "MappingRule":
        return cls(target=d.get("target"), source=d.get("source"), transform=d.get("transform"),
                   constant=d["constant"] if "constant" in d else _MISSING)

    @property
    def is_constant(self) -> bool:
        return not self.source


class Mapper:
    """Convierte un registro del origen en {ruta_destino: valor} aplicando las reglas."""

    def __init__(self, rules: list, transforms: TransformRegistry | None = None):
        self.transforms = transforms or TransformRegistry.with_defaults()
        self.rules = [r if isinstance(r, MappingRule) else MappingRule.from_dict(r) for r in rules]
        for r in self.rules:
            self.transforms.get(r.transform)  # falla pronto si no existe

    def map(self, record: dict) -> tuple[dict, list[str]]:
        values: dict[str, Any] = {}
        warnings: list[str] = []
        for rule in self.rules:
            if rule.is_constant:
                value = rule.constant
            else:
                value = ObjectPath.get(record, rule.source, _MISSING)
                if value is _MISSING:
                    warnings.append(f"El origen «{rule.source}» no existe en este registro")
                    continue
            values[rule.target] = self.transforms.get(rule.transform).apply(value)
        return values, warnings
