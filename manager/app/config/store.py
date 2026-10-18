import json
import os
import tempfile
from pathlib import Path
from typing import Any


class ConfigStore:
    """Small JSON store with atomic writes and per-user APPDATA placement."""
    def __init__(self, path: Path, defaults: dict[str, Any] | None = None):
        self.path = Path(path)
        self.defaults = dict(defaults or {})

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return dict(self.defaults)
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return {**self.defaults, **value} if isinstance(value, dict) else dict(self.defaults)
        except (OSError, ValueError):
            return dict(self.defaults)

    def save(self, values: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=self.path.name + ".", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(values, stream, ensure_ascii=False, indent=2)
                stream.flush(); os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name): os.unlink(name)

    def get(self, key: str, default: Any = None) -> Any:
        return self.load().get(key, default)

    def set(self, key: str, value: Any) -> None:
        values = self.load(); values[key] = value; self.save(values)
