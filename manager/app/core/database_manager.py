from pathlib import Path
import sqlite3
import os
import shutil
import tempfile

class DatabaseManager:
    def __init__(self, path: Path, version: int = 1): self.path, self.version = Path(path), version
    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path); conn.execute("PRAGMA foreign_keys=ON"); return conn
    def validate(self) -> bool:
        try:
            with self.connect() as conn: return conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        except (OSError, sqlite3.Error): return False
    def migrate(self) -> int:
        backup = None
        if self.path.exists():
            fd, name = tempfile.mkstemp(prefix=self.path.name + ".", suffix=".bak", dir=self.path.parent)
            os.close(fd); backup = Path(name); shutil.copy2(self.path, backup)
        try:
            with self.connect() as conn:
                current = conn.execute("PRAGMA user_version").fetchone()[0]
                if current < 1:
                    conn.execute("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                    conn.execute("PRAGMA user_version=1"); current = 1
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            if not self.validate(): raise sqlite3.DatabaseError("migration integrity check failed")
            return current
        except Exception:
            if backup:
                shutil.copy2(backup, self.path)
            raise
        finally:
            if backup: backup.unlink(missing_ok=True)
