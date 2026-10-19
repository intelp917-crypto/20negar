import json
import sqlite3
from dataclasses import replace
from pathlib import Path

from app.config.defaults import default_paths
from app.core.bridge import CoreBridge, _dotenv_value
from app.core.database_manager import DatabaseManager


def make_bridge(tmp_path: Path) -> tuple[CoreBridge, Path]:
    """A bridge in an isolated repository that looks like the real checkout."""
    repo = tmp_path / "repo"
    (repo / "manager").mkdir(parents=True)
    (repo / "package.json").write_text("{}", encoding="utf-8")
    paths = replace(default_paths(repo), config_dir=tmp_path / "config")
    bridge = CoreBridge(paths)
    bridge.paths.database.parent.mkdir(parents=True, exist_ok=True)
    return bridge, repo


def make_database(path: Path, table: str = "users") -> None:
    connection = sqlite3.connect(path)
    connection.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, name TEXT)")
    connection.execute(f"INSERT INTO {table} (name) VALUES ('admin')")
    connection.commit()
    connection.close()


def test_database_path_switch_is_effective_everywhere(tmp_path):
    bridge, repo = make_bridge(tmp_path)
    source = bridge.paths.database
    make_database(source, "users")

    target = tmp_path / "external drive" / "studio.sqlite"
    result = bridge.apply_database_path(str(target))

    assert result["ok"] and result["changed"] and result["valid"]
    assert bridge.paths.database == target.resolve()
    assert bridge.settings["database"] == str(target.resolve())
    assert target.exists()

    connection = sqlite3.connect(target)
    assert connection.execute("SELECT name FROM users").fetchone()[0] == "admin"
    connection.close()

    # The TypeScript server reads this file on its next boot.
    env = (repo / ".env").read_text(encoding="utf-8")
    assert f"NEGAR_DB_FILE_PATH={target.resolve()}" in env
    assert bridge.server_env()["NEGAR_DB_FILE_PATH"] == str(target.resolve())

    settings = json.loads(bridge.store.path.read_text(encoding="utf-8"))
    assert settings["database"] == str(target.resolve())

    # A recovery archive is always created before the move.
    assert result["backup"] and Path(result["backup"]).exists()


def test_database_adopt_mode_keeps_existing_file(tmp_path):
    bridge, _repo = make_bridge(tmp_path)
    make_database(bridge.paths.database, "users")
    target = tmp_path / "restored.sqlite"
    make_database(target, "adopted")

    result = bridge.apply_database_path(str(target), mode="adopt")

    assert result["ok"] and result["mode"] == "adopt"
    connection = sqlite3.connect(target)
    assert connection.execute("SELECT name FROM sqlite_master WHERE name='adopted'").fetchone()
    connection.close()
    assert bridge.paths.database == target.resolve()


def test_database_replace_preserves_existing_destination(tmp_path):
    bridge, _repo = make_bridge(tmp_path)
    make_database(bridge.paths.database, "users")
    target = tmp_path / "occupied.sqlite"
    make_database(target, "old")

    result = bridge.apply_database_path(str(target), mode="replace")

    assert result["ok"] and result["preserved"]
    assert Path(result["preserved"]).exists()
    connection = sqlite3.connect(target)
    assert connection.execute("SELECT name FROM sqlite_master WHERE name='users'").fetchone()
    connection.close()


def test_storage_switch_writes_env_and_migrates(tmp_path):
    bridge, repo = make_bridge(tmp_path)
    bridge.paths.storage_dir.mkdir(parents=True)
    (bridge.paths.storage_dir / "videos").mkdir()
    (bridge.paths.storage_dir / "videos" / "clip.mp4").write_bytes(b"media")
    target = tmp_path / "new media"

    result = bridge.apply_storage_path(str(target), migrate=True)

    assert result["ok"] and result["migrated"] and result["copied_files"] == 1
    assert (target / "videos" / "clip.mp4").read_bytes() == b"media"
    env = (repo / ".env").read_text(encoding="utf-8")
    assert f"NEGAR_STORAGE_DIR={target.resolve()}" in env
    assert bridge.server_env()["NEGAR_STORAGE_DIR"] == str(target.resolve())


def test_database_operations_release_the_file(tmp_path):
    """A leaked SQLite handle makes the server's atomic rename fail with EBUSY."""
    path = tmp_path / "locked.sqlite"
    manager = DatabaseManager(path)
    assert manager.migrate() == 1
    assert manager.validate()
    moved = path.with_suffix(".moved")
    path.replace(moved)  # raises PermissionError on Windows if a handle is open
    assert moved.exists()


def test_dotenv_values_survive_windows_paths():
    assert _dotenv_value(r"C:\new\data\studio.sqlite") == r"C:\new\data\studio.sqlite"
    assert _dotenv_value(r"C:\Program Files\20Negar") == r"C:\Program Files\20Negar"
    quoted = _dotenv_value(r"C:\media #2")
    assert quoted.startswith("'") and quoted.endswith("'")
