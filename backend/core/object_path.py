"""Acceso a propiedades anidadas por ruta con puntos («Author.Title», «tags.0»).

Las claves que contienen un punto se escapan como «\\.». Se bloquean claves peligrosas
(para que una ruta venida de la configuración no pueda tocar atributos internos).
"""
from __future__ import annotations

from typing import Any

_FORBIDDEN = {"__proto__", "constructor", "prototype", "__class__", "__dict__"}


class ObjectPath:
    @staticmethod
    def split(path: str | None) -> list[str]:
        if path is None or path == "":
            return []
        s, out, cur, i = str(path), [], "", 0
        while i < len(s):
            c = s[i]
            if c == "\\" and s[i + 1 : i + 2] == ".":
                cur += "."
                i += 1
            elif c == ".":
                out.append(cur)
                cur = ""
            else:
                cur += c
            i += 1
        out.append(cur)
        return out

    @staticmethod
    def append(path: str, key: Any) -> str:
        k = str(key).replace(".", "\\.")
        return k if not path else f"{path}.{k}"

    @staticmethod
    def get(obj: Any, path: str | None, default: Any = None) -> Any:
        cur = obj
        for seg in ObjectPath.split(path):
            if isinstance(cur, dict):
                if seg not in cur:
                    return default
                cur = cur[seg]
            elif isinstance(cur, list) and seg.isdigit() and int(seg) < len(cur):
                cur = cur[int(seg)]
            else:
                return default
        return cur

    @staticmethod
    def has(obj: Any, path: str | None) -> bool:
        sentinel = object()
        return ObjectPath.get(obj, path, sentinel) is not sentinel

    @staticmethod
    def set(obj: Any, path: str, value: Any) -> Any:
        segs = ObjectPath.split(path)
        if not segs:
            raise ValueError("Ruta vacía")
        for s in segs:
            if s in _FORBIDDEN:
                raise ValueError(f"Segmento de ruta no permitido: {s}")
        cur = obj
        for i, seg in enumerate(segs[:-1]):
            nxt_is_index = segs[i + 1].isdigit()
            if isinstance(cur, list):
                idx = int(seg)
                while len(cur) <= idx:
                    cur.append(None)
                if not isinstance(cur[idx], (dict, list)):
                    cur[idx] = [] if nxt_is_index else {}
                cur = cur[idx]
            else:
                if not isinstance(cur.get(seg), (dict, list)):
                    cur[seg] = [] if nxt_is_index else {}
                cur = cur[seg]
        last = segs[-1]
        if isinstance(cur, list):
            idx = int(last)
            while len(cur) <= idx:
                cur.append(None)
            cur[idx] = value
        else:
            cur[last] = value
        return obj
