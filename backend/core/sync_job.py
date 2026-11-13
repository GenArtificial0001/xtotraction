from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from .mapper import Mapper


class SyncJob:
    """Orquesta origen → mapper → destino y emite eventos (start, record, error, done) en tiempo real."""

    def __init__(self, source, target, mapper: Mapper, dry_run: bool = True, limit: int | None = None,
                 delay_ms: int = 0, stop_on_error: bool = False):
        self.source, self.target, self.mapper = source, target, mapper
        self.dry_run, self.limit, self.delay_ms, self.stop_on_error = dry_run, limit, delay_ms, stop_on_error

    async def run(self) -> AsyncIterator[dict]:
        yield {"type": "start", "dryRun": self.dry_run}
        total = ok = failed = 0
        aborted = False
        try:
            async for record in self.source.fetch_records(limit=self.limit):
                index = total
                total += 1
                values, warnings = self.mapper.map(record)
                try:
                    result = await self.target.send(values, dry_run=self.dry_run)
                except Exception as err:  # un registro con error no detiene el resto
                    result = {"ok": False, "error": str(err)}
                if result.get("ok"):
                    ok += 1
                else:
                    failed += 1
                yield {"type": "record", "index": index, "label": self._label(values), "warnings": warnings, **result}
                if not result.get("ok") and self.stop_on_error:
                    aborted = True
                    break
                if self.limit and total >= self.limit:
                    break
                if self.delay_ms and not self.dry_run:
                    await asyncio.sleep(self.delay_ms / 1000)
        except Exception as err:
            yield {"type": "error", "error": str(err)}
            aborted = True
        yield {"type": "done", "total": total, "ok": ok, "failed": failed, "aborted": aborted, "dryRun": self.dry_run}

    @staticmethod
    def _label(values: dict[str, Any]) -> str:
        vals = list(values.values())
        first = next((v for v in vals if isinstance(v, str) and v), vals[0] if vals else None)
        return "" if first is None else str(first)[:80]
