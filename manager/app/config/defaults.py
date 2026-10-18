from dataclasses import dataclass
from pathlib import Path
import os


def find_repo_root(start: Path | None = None) -> Path:
    """Find the application repository, without assuming the current directory."""
    current = (start or Path.cwd()).resolve()
    candidates = [current, *current.parents]
    for path in candidates:
        if (path / "manager").is_dir() and ((path / "package.json").exists() or (path / ".git").exists()):
            return path
    return current


def appdata_dir(app_name: str = "20negar-manager") -> Path:
    base = os.environ.get("APPDATA") or os.environ.get("XDG_CONFIG_HOME")
    return Path(base) / app_name if base else Path.home() / ".config" / app_name


@dataclass(frozen=True)
class AppPaths:
    repo_root: Path
    config_dir: Path
    data_dir: Path
    database: Path
    storage_dir: Path
    logs_dir: Path
    backups_dir: Path


def default_paths(repo_root: Path | None = None, app_name: str = "20negar-manager") -> AppPaths:
    root = (repo_root or find_repo_root()).resolve()
    data = root / "data"
    return AppPaths(root, appdata_dir(app_name), data, data / "cineflow.sqlite", data / "storage", data / "logs", data / "backups")
