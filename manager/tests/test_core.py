import hashlib
from app.core.backup_manager import BackupManager
from app.core.database_manager import DatabaseManager
from app.core.storage_manager import StorageManager
from app.core.startup_manager import StartupManager
from app.core.update_manager import UpdateManager

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
    startup.enable(); assert startup.enabled(); startup.disable(); assert not startup.enabled()
    p = tmp_path / "x"; p.write_bytes(b"abc")
    assert UpdateManager().verify_sha256(p, hashlib.sha256(b"abc").hexdigest())
