from pathlib import Path
import os

class StorageManager:
    def __init__(self, root: Path): self.root = Path(root)
    def ensure(self) -> Path: self.root.mkdir(parents=True, exist_ok=True); return self.root
    def validate(self) -> bool:
        try: return self.root.exists() and self.root.is_dir() and os.access(self.root, os.W_OK)
        except OSError: return False
    def safe_path(self, relative: str | Path) -> Path:
        candidate = (self.root / relative).resolve()
        if self.root.resolve() not in (candidate, *candidate.parents): raise ValueError("path escapes storage root")
        return candidate
