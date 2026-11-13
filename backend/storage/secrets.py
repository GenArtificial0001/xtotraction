"""Evita que las credenciales guardadas vuelvan al navegador: salen enmascaradas y, al guardar,
un valor enmascarado conserva el original."""
from __future__ import annotations

import copy
import re

MASK = "••••••••"
_SENSITIVE_HEADER = re.compile(r"^(authorization|cookie|set-cookie|proxy-authorization|x-requestdigest|x-csrf-token|x-xsrf-token)$|token|secret|api[-_]?key|password", re.I)
_SENSITIVE_KEY = re.compile(r"secret|password|token|api[-_]?key", re.I)
ROLES = ("source", "target")


class SecretMasker:
    @staticmethod
    def is_sensitive_header(name: str) -> bool:
        return bool(_SENSITIVE_HEADER.search(name))

    @staticmethod
    def mask(config: dict) -> dict:
        out = copy.deepcopy(config)
        for role in ROLES:
            c = out.get(role)
            if not isinstance(c, dict):
                continue
            if isinstance(c.get("headers"), dict):
                c["headers"] = {k: (MASK if SecretMasker.is_sensitive_header(k) and v else v) for k, v in c["headers"].items()}
            for k, v in list(c.items()):
                if k != "headers" and isinstance(v, str) and v and _SENSITIVE_KEY.search(k):
                    c[k] = MASK
        return out

    @staticmethod
    def restore(incoming: dict, stored: dict | None) -> dict:
        out = copy.deepcopy(incoming)
        if not stored:
            return out
        for role in ROLES:
            c, s = out.get(role), (stored.get(role) or {})
            if not isinstance(c, dict):
                continue
            if isinstance(c.get("headers"), dict):
                sh = s.get("headers") or {}
                c["headers"] = {k: (sh.get(k, "") if v == MASK else v) for k, v in c["headers"].items()}
            for k, v in list(c.items()):
                if k != "headers" and v == MASK:
                    c[k] = s.get(k, "")
        return out
