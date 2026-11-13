from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class InvalidId(ValueError):
    pass


class ConfigRepository(ABC):
    """Contrato de persistencia: cambia la implementación (BD, nube…) sin tocar el resto."""

    @abstractmethod
    def list(self) -> list[dict]: ...
    @abstractmethod
    def get(self, id_: str) -> dict | None: ...
    @abstractmethod
    def save(self, config: dict) -> dict: ...
    @abstractmethod
    def delete(self, id_: str) -> bool: ...


class FileConfigRepository(ConfigRepository):
    """Una configuración = un JSON en un directorio (permisos 0600)."""

    def __init__(self, directory: str | Path):
        self.dir = Path(directory)

    @staticmethod
    def is_valid_id(id_: object) -> bool:
        return isinstance(id_, str) and bool(_ID.match(id_))

    def _file(self, id_: str) -> Path:
        if not self.is_valid_id(id_):
            raise InvalidId("Identificador inválido")
        return self.dir / f"{id_}.json"

    def list(self) -> list[dict]:
        self.dir.mkdir(parents=True, exist_ok=True)
        items = []
        for f in self.dir.glob("*.json"):
            try:
                c = json.loads(f.read_text("utf-8"))
                items.append({"id": c["id"], "name": c.get("name") or "(sin nombre)", "updatedAt": c.get("updatedAt", "")})
            except (ValueError, KeyError, OSError):
                continue
        return sorted(items, key=lambda i: i["updatedAt"], reverse=True)

    def get(self, id_: str) -> dict | None:
        try:
            return json.loads(self._file(id_).read_text("utf-8"))
        except FileNotFoundError:
            return None

    def save(self, config: dict) -> dict:
        self.dir.mkdir(parents=True, exist_ok=True)
        id_ = config.get("id") or str(uuid.uuid4())
        saved = {**config, "id": id_, "updatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
        target = self._file(id_)
        fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(saved, fh, ensure_ascii=False, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, target)
        return saved

    def delete(self, id_: str) -> bool:
        try:
            self._file(id_).unlink()
            return True
        except FileNotFoundError:
            return False
