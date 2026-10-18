from pathlib import Path
from app.config.defaults import default_paths, find_repo_root
from app.config.store import ConfigStore

def test_defaults_and_repo(tmp_path):
    paths = default_paths(tmp_path)
    assert paths.database == tmp_path / "data/cineflow.sqlite"
    assert paths.storage_dir == tmp_path / "data/storage"

def test_store_atomic_and_defaults(tmp_path):
    store = ConfigStore(tmp_path / "settings.json", {"port": 3000})
    assert store.get("port") == 3000
    store.set("port", 4000)
    assert ConfigStore(store.path).get("port") == 4000
