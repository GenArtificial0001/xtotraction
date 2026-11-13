"""Transformaciones de valores. Para añadir una: subclase de Transform y registrarla en TransformRegistry."""
from __future__ import annotations

import html as _html
import json
import re
from datetime import datetime, timezone
from typing import Any


class Transform:
    id = "transform"
    label = "Transformación"

    def apply(self, value: Any) -> Any:
        return value


class IdentityTransform(Transform):
    id, label = "none", "Sin cambios"


class TrimTransform(Transform):
    id, label = "trim", "Quitar espacios"

    def apply(self, v):
        return v.strip() if isinstance(v, str) else v


class UpperTransform(Transform):
    id, label = "upper", "MAYÚSCULAS"

    def apply(self, v):
        return v.upper() if isinstance(v, str) else v


class LowerTransform(Transform):
    id, label = "lower", "minúsculas"

    def apply(self, v):
        return v.lower() if isinstance(v, str) else v


class StringTransform(Transform):
    id, label = "string", "A texto"

    def apply(self, v):
        if v is None:
            return None
        return json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)


class NumberTransform(Transform):
    id, label = "number", "A número"

    def apply(self, v):
        if v is None or v == "" or isinstance(v, bool):
            return None
        try:
            n = float(v.replace(",", ".")) if isinstance(v, str) else float(v)
        except (TypeError, ValueError):
            return None
        return int(n) if n.is_integer() else n


class BooleanTransform(Transform):
    id, label = "boolean", "A sí/no (booleano)"

    def apply(self, v):
        if isinstance(v, str):
            return v.strip().lower() in {"true", "1", "yes", "si", "sí", "y"}
        return bool(v)


def _parse_date(v) -> datetime | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    try:
        d = datetime.fromisoformat(str(v).strip().replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
            try:
                d = datetime.strptime(str(v).strip(), fmt)
                break
            except ValueError:
                d = None
        if d is None:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


class IsoDateTransform(Transform):
    id, label = "isoDate", "Fecha ISO 8601"

    def apply(self, v):
        d = _parse_date(v)
        return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") if d else None


class DateOnlyTransform(Transform):
    id, label = "dateOnly", "Solo fecha (AAAA-MM-DD)"

    def apply(self, v):
        d = _parse_date(v)
        return d.astimezone(timezone.utc).date().isoformat() if d else None


class StripHtmlTransform(Transform):
    id, label = "stripHtml", "Quitar HTML (texto enriquecido)"

    def apply(self, v):
        if not isinstance(v, str):
            return v
        t = re.sub(r"<br\s*/?>", "\n", v, flags=re.I)
        t = re.sub(r"</(p|div|li)>", "\n", t, flags=re.I)
        t = _html.unescape(re.sub(r"<[^>]+>", "", t))
        return re.sub(r"\n{3,}", "\n\n", t).strip()


class TransformRegistry:
    def __init__(self):
        self._map: dict[str, Transform] = {}

    def register(self, cls: type[Transform]) -> "TransformRegistry":
        self._map[cls.id] = cls()
        return self

    def get(self, id_: str | None) -> Transform:
        t = self._map.get(id_ or "none")
        if t is None:
            raise ValueError(f"Transformación desconocida: {id_}")
        return t

    def list(self) -> list[dict]:
        return [{"id": t.id, "label": t.label} for t in self._map.values()]

    @classmethod
    def with_defaults(cls) -> "TransformRegistry":
        r = cls()
        for t in (IdentityTransform, TrimTransform, UpperTransform, LowerTransform, StringTransform, NumberTransform,
                  BooleanTransform, IsoDateTransform, DateOnlyTransform, StripHtmlTransform):
            r.register(t)
        return r
