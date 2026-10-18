"""Validated persistent settings for the manager and the managed server."""
from pathlib import Path
import shutil
from .defaults import AppPaths, default_paths
from .store import ConfigStore

DEFAULT_SETTINGS = {
    "health_url": "http://127.0.0.1:3000/api/health",
    "port": 3000,
    "mode": "development",
    "startup_enabled": False,
    "start_gui_on_login": False,
    "restart_on_crash": False,
    "monitor_interval": 5,
    "startup_timeout": 30,
    "low_disk_gb": 5,
}

def settings_store(paths: AppPaths | None = None) -> ConfigStore:
    paths = paths or default_paths()
    return ConfigStore(paths.config_dir / "settings.json", DEFAULT_SETTINGS)


def validate_settings(values: dict) -> dict:
    result = {**DEFAULT_SETTINGS, **values}
    result["port"] = max(1, min(65535, int(result["port"])))
    result["monitor_interval"] = max(1, min(3600, int(result["monitor_interval"])))
    result["startup_timeout"] = max(5, min(600, int(result["startup_timeout"])))
    result["low_disk_gb"] = max(0, min(1024, int(result["low_disk_gb"])))
    result["mode"] = result["mode"] if result["mode"] in {"development", "production"} else "development"
    for key in ("startup_enabled", "start_gui_on_login", "restart_on_crash"):
        result[key] = bool(result[key])
    return result
