from pathlib import Path
from app.config.defaults import default_paths, find_repo_root
from app.config.store import ConfigStore
from app.config.settings import validate_settings

def test_defaults_and_repo(tmp_path):
    paths = default_paths(tmp_path)
    assert paths.database == tmp_path / "data/cineflow.sqlite"
    assert paths.storage_dir == tmp_path / "data/storage"

def test_store_atomic_and_defaults(tmp_path):
    store = ConfigStore(tmp_path / "settings.json", {"port": 3000})
    assert store.get("port") == 3000
    store.set("port", 4000)
    assert ConfigStore(store.path).get("port") == 4000

def test_malformed_settings_are_safe():
    result = validate_settings({"port": "nope", "health_url": "not a url", "startup_enabled": "yes"})
    assert result["port"] == 3000
    assert result["health_url"].startswith("http://")
    assert result["startup_enabled"] is False
