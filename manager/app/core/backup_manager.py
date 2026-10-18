from pathlib import Path
import shutil
import tempfile
import zipfile
import json
import hashlib
from datetime import datetime, timezone

class BackupManager:
    def __init__(self, backup_dir: Path): self.backup_dir = Path(backup_dir)
    def create(self, sources: list[Path], destination: Path | None = None) -> Path:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        destination = destination or self.backup_dir / "backup.zip"
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(suffix=".zip", dir=destination.parent, delete=False) as tmp:
            temporary = Path(tmp.name)
        try:
            manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "files": []}
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                for source in sources:
                    source = Path(source)
                    if source.is_file():
                        archive.write(source, source.name); manifest["files"].append({"name": source.name, "size": source.stat().st_size, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
                    elif source.is_dir():
                        for file in source.rglob("*"):
                            if file.is_file():
                                archive.write(file, file.relative_to(source.parent)); manifest["files"].append({"name": str(file.relative_to(source.parent)), "size": file.stat().st_size})
                archive.writestr("MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            temporary.replace(destination); return destination
        finally:
            temporary.unlink(missing_ok=True)
    def restore(self, archive: Path, destination: Path) -> None:
        destination = Path(destination).resolve(); destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                target = (destination / name).resolve()
                if destination not in (target, *target.parents): raise ValueError("unsafe archive path")
            z.extractall(destination)
