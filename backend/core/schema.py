"""Deduce los campos disponibles a partir de datos reales y localiza la lista de registros en una respuesta."""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Any, Callable

from .object_path import ObjectPath

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$")
_PREFERRED_ITEMS = ["value", "d.results", "results", "Row", "items", "data", "records", "rows"]


@dataclass
class FieldDescriptor:
    path: str
    type: str = "string"
    sample: Any = None
    label: str | None = None  # nombre para mostrar (p. ej. el de la columna en SharePoint)

    def to_dict(self) -> dict:
        d = asdict(self)
        if d["label"] is None:
            del d["label"]
        return d


def type_of(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        return "date" if _ISO_DATE.match(value) else "string"
    return "string"


class SchemaInferer:
    def __init__(self, max_array_items: int = 3, max_depth: int = 8):
        self.max_array_items = max_array_items
        self.max_depth = max_depth

    def flatten(self, value: Any, prefix: str = "", depth: int = 0, out: list | None = None) -> list[FieldDescriptor]:
        out = [] if out is None else out

        def leaf(v: Any) -> None:
            out.append(FieldDescriptor(prefix, type_of(v), v))

        if depth > self.max_depth:
            if prefix:
                leaf(str(value))
            return out
        if isinstance(value, dict):
            if not value:
                if prefix:
                    leaf(value)
                return out
            for k, v in value.items():
                self.flatten(v, ObjectPath.append(prefix, k), depth + 1, out)
        elif isinstance(value, list):
            if not value or all(not isinstance(v, (dict, list)) for v in value):
                if prefix:
                    leaf(value)
            else:
                for i, v in enumerate(value[: self.max_array_items]):
                    self.flatten(v, ObjectPath.append(prefix, i), depth + 1, out)
        elif prefix:
            leaf(value)
        return out

    def infer_from_records(self, records: list, exclude: Callable[[str], bool] = lambda p: False) -> list[FieldDescriptor]:
        merged: dict[str, FieldDescriptor] = {}
        for rec in records:
            for f in self.flatten(rec):
                if exclude(f.path):
                    continue
                prev = merged.get(f.path)
                if prev is None or (prev.sample in (None, "") and f.sample is not None):
                    merged[f.path] = f
        return list(merged.values())

    def find_items_path(self, data: Any) -> str | None:
        if isinstance(data, list):
            return ""
        cands: list[tuple[str, int]] = []

        def walk(node: Any, path: str, depth: int) -> None:
            if depth > 4 or not isinstance(node, (dict, list)):
                return
            if isinstance(node, list):
                if node and all(isinstance(x, dict) for x in node):
                    cands.append((path, len(node)))
                return
            for k, v in node.items():
                walk(v, ObjectPath.append(path, k), depth + 1)

        walk(data, "", 0)
        if not cands:
            return None

        def rank(c: tuple[str, int]):
            p, n = c
            return (_PREFERRED_ITEMS.index(p) if p in _PREFERRED_ITEMS else len(_PREFERRED_ITEMS), -n)

        return sorted(cands, key=rank)[0][0]

    def extract_items(self, data: Any, items_path: str | None) -> dict:
        path = self.find_items_path(data) if items_path in (None, "auto") else items_path
        if path == "$":
            path = ""
        if path is None:
            return {"items_path": None, "items": [data] if isinstance(data, dict) else []}
        node = data if path == "" else ObjectPath.get(data, path)
        if isinstance(node, list):
            return {"items_path": path, "items": [x for x in node if isinstance(x, dict)]}
        return {"items_path": path, "items": [node] if isinstance(node, dict) else []}
