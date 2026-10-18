import hashlib
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
