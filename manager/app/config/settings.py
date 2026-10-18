"""Validated persistent settings for the manager and the managed server."""
from pathlib import Path
from urllib.parse import urlparse
from .defaults import AppPaths, default_paths
from .store import ConfigStore

DEFAULT_SETTINGS = {
    "health_url": "http://127.0.0.1:3000/api/health",
    "port": 3000,
    "mode": "development",
    "startup_enabled": False,
    "start_gui_on_login": False,
    "startup_server_enabled": False,
    "restart_on_crash": False,
    "monitor_interval": 5,
    "startup_timeout": 30,
    "low_disk_gb": 5,
}

def settings_store(paths: AppPaths | None = None) -> ConfigStore:
    paths = paths or default_paths()
    return ConfigStore(paths.config_dir / "settings.json", DEFAULT_SETTINGS)


def validate_settings(values: dict) -> dict:
    if not isinstance(values, dict):
        values = {}
    result = {**DEFAULT_SETTINGS, **values}
    for key, low, high in (("port", 1, 65535), ("monitor_interval", 1, 3600),
                           ("startup_timeout", 5, 600), ("low_disk_gb", 0, 1024)):
        value = result.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            value = DEFAULT_SETTINGS[key]
        try:
            value = int(value)
        except (TypeError, ValueError):
            value = DEFAULT_SETTINGS[key]
        result[key] = max(low, min(high, value))
    url = result.get("health_url")
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme not in {"http", "https"} or not parsed.netloc:
        result["health_url"] = DEFAULT_SETTINGS["health_url"]
    result["mode"] = result["mode"] if result["mode"] in {"development", "production"} else "development"
    for key in ("startup_enabled", "start_gui_on_login", "startup_server_enabled", "restart_on_crash"):
        result[key] = result[key] if isinstance(result[key], bool) else DEFAULT_SETTINGS[key]
    return result
