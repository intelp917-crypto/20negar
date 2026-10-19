import hashlib
import shutil
import subprocess
from pathlib import Path
from app.core.backup_manager import BackupManager
from app.core.database_manager import DatabaseManager
from app.core.storage_manager import StorageManager
from app.core.startup_manager import StartupManager
from app.core.update_manager import UpdateManager
from app.config.defaults import default_paths
from dataclasses import replace
from app.core.bridge import CoreBridge

def test_database_storage_and_backup(tmp_path):
    db = DatabaseManager(tmp_path / "data/cineflow.sqlite")
    assert db.migrate() == 1 and db.validate()
    storage = StorageManager(tmp_path / "storage"); storage.ensure()
    assert storage.validate()
    source = tmp_path / "storage/a.txt"; source.write_text("ok")
    archive = BackupManager(tmp_path / "backups").create([source])
    restored = tmp_path / "restored"; BackupManager(tmp_path / "backups").restore(archive, restored)
    assert (restored / "a.txt").read_text() == "ok"

def test_backup_rejects_zip_slip(tmp_path):
    import zipfile
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as z: z.writestr("../evil", "x")
    try: BackupManager(tmp_path).restore(archive, tmp_path / "out")
    except ValueError: pass
    else: raise AssertionError("unsafe archive accepted")

def test_startup_and_checksum(tmp_path):
    startup = StartupManager("test", ["python", "-V"], tmp_path / "startup")
    startup.enable(); assert startup.enabled(); first = startup.shortcut_path.read_text(encoding="utf-8"); startup = StartupManager("test", ["python", "-c", "changed"], tmp_path / "startup"); startup.ensure(); assert startup.shortcut_path.read_text(encoding="utf-8") == first; startup.disable(); assert not startup.enabled()
    p = tmp_path / "x"; p.write_bytes(b"abc")
    assert UpdateManager().verify_sha256(p, hashlib.sha256(b"abc").hexdigest())

def test_startup_entry_runs_from_repo_with_env_and_log(tmp_path):
    log = tmp_path / "logs" / "startup-server.log"
    startup = StartupManager("server", ["node", "server.ts"], tmp_path / "startup",
                             cwd=tmp_path, log_file=log,
                             env={"PORT": "3000", "NEGAR_VIDEOS_DIR": r"D:\media 1%"})
    path = startup.enable(overwrite=True)
    text = path.read_text(encoding="utf-8")
    assert f"cd /d {subprocess.list2cmdline([str(tmp_path)])}" in text
    assert 'set "PORT=3000"' in text
    assert "D:\\media 1%%" in text          # cmd would expand a lone percent sign
    assert str(log) in text                    # sign-in output is kept for diagnosis
    assert startup.current()
    assert not StartupManager("server", ["node", "server.ts"], tmp_path / "startup",
                              cwd=tmp_path / "moved").current()


def test_hidden_startup_entry_has_no_console(tmp_path):
    startup = StartupManager("20Negar-Server", ["node", "server.ts"], tmp_path / "Startup",
                             cwd=tmp_path, hidden=True, script_dir=tmp_path / "scripts",
                             log_file=tmp_path / "logs" / "startup-server.log")
    path = startup.enable(overwrite=True)
    assert path.suffix == ".vbs" and path.exists()
    assert startup.script_path.exists()
    launcher = path.read_text(encoding="utf-16")
    assert str(startup.script_path) in launcher
    assert '", 0, False' in launcher          # hidden window, do not block sign-in
    assert "pause" not in startup.script_path.read_text(encoding="utf-8")
    assert startup.current()

    # A leftover visible entry must not start a second, windowed server.
    legacy = tmp_path / "Startup" / "20Negar-Server.cmd"
    legacy.write_text("@echo off\n", encoding="utf-8")
    assert not startup.current()
    startup.enable(overwrite=True)
    assert not legacy.exists() and startup.current()

    startup.disable()
    assert not path.exists() and not startup.script_path.exists()


def test_bridge_startup_repairs_a_stale_entry(tmp_path, monkeypatch):
    if not shutil.which("node"):
        return
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    paths = replace(default_paths(tmp_path), config_dir=tmp_path / "config")
    bridge = CoreBridge(paths)
    startup_dir = tmp_path / "appdata" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    startup_dir.mkdir(parents=True)
    stale = startup_dir / "20Negar-Server.cmd"
    stale.write_text("@echo off\ncd /d C:\\old-checkout\nnode server.ts\n", encoding="utf-8")
    status = bridge.startup_status()
    assert not status["server_current"]
    assert bridge.startup(True, True)["server_current"]
    entry = startup_dir / "20Negar-Server.vbs"
    assert entry.exists() and not stale.exists()
    script = Path(status["server_script"])
    assert script.exists()
    text = script.read_text(encoding="utf-8")
    assert f"cd /d {subprocess.list2cmdline([str(tmp_path)])}" in text
    assert "C:\\old-checkout" not in text
    assert bridge.startup_status()["server_current"]


def test_storage_migration_verifies_and_keeps_source(tmp_path):
    paths = replace(default_paths(tmp_path), config_dir=tmp_path / "config")
    paths.storage_dir.mkdir(parents=True)
    source = paths.storage_dir / "nested" / "video.mp4"; source.parent.mkdir(); source.write_bytes(b"video-bytes")
    bridge = CoreBridge(paths)
    target = tmp_path / "new media"
    result = bridge.migrate_storage_path(str(target))
    assert result["ok"] and result["migrated"]
    assert (target / "nested/video.mp4").read_bytes() == b"video-bytes"
    assert source.exists() and bridge.paths.storage_dir == target.resolve()

