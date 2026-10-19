"""Validated persistent settings for the manager and the managed server."""
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
    # UI preferences
    "ui_theme": "dark",
    "close_to_tray": True,
    "last_page": "Dashboard",
    "window_geometry": "",
    # Effective server paths. Empty means "server default" (repo/data).
    "storage_dir": "",
    "database": "",
    # Last server identity, used to re-attach to a process started earlier.
    "server_pid": 0,
    "server_process_started": 0.0,
    "server_started_at": 0.0,
    # HTTPS / certificates
    "tls_domain": "",
    "tls_email": "",
    "tls_staging": False,
    "tls_autorenew": True,
    "tls_autorenew_days": 30,
    "tls_last_check": 0.0,
}

_BOOL_KEYS = ("startup_enabled", "start_gui_on_login", "startup_server_enabled",
              "restart_on_crash", "close_to_tray", "tls_staging", "tls_autorenew")

def settings_store(paths: AppPaths | None = None) -> ConfigStore:
    paths = paths or default_paths()
    return ConfigStore(paths.config_dir / "settings.json", DEFAULT_SETTINGS)


def validate_settings(values: dict) -> dict:
    if not isinstance(values, dict):
        values = {}
    result = {**DEFAULT_SETTINGS, **values}
    for key, low, high in (("port", 1, 65535), ("monitor_interval", 1, 3600),
                           ("startup_timeout", 5, 600), ("low_disk_gb", 0, 1024),
                           ("tls_autorenew_days", 1, 90)):
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
    result["ui_theme"] = result["ui_theme"] if result["ui_theme"] in {"dark", "light"} else "dark"
    for key in _BOOL_KEYS:
        result[key] = result[key] if isinstance(result[key], bool) else DEFAULT_SETTINGS[key]
    for key in ("storage_dir", "database", "tls_domain", "tls_email"):
        value = str(result.get(key) or "").strip()
        result[key] = value
    try:
        result["tls_last_check"] = float(result.get("tls_last_check") or 0)
    except (TypeError, ValueError):
        result["tls_last_check"] = 0.0
    for key in ("last_page", "window_geometry"):
        result[key] = str(result.get(key) or "")
    for key, cast in (("server_pid", int), ("server_process_started", float), ("server_started_at", float)):
        try:
            result[key] = cast(result.get(key) or 0)
        except (TypeError, ValueError):
            result[key] = DEFAULT_SETTINGS[key]
    return result
