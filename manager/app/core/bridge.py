"""Application-facing facade used by the Qt layer.

The facade owns no UI state and is deliberately easy to exercise from tests.
It manages the real repository server and keeps the Python settings, the
``.env`` file consumed by the Node/TypeScript server, and the running process
in sync so a path change really changes where the server writes.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

from ..config.defaults import AppPaths, default_paths
from ..config.settings import settings_store, validate_settings
from .backup_manager import BackupManager
from .database_manager import DatabaseManager
from .diagnostics import Diagnostics
from .log_manager import LogManager
from .server_controller import ServerController
from .startup_manager import StartupManager
from .update_manager import UpdateManager

APP_VERSION = "0.2.0"
MANAGED_ENV_KEYS = ("PORT", "NEGAR_DB_FILE_PATH", "NEGAR_STORAGE_DIR", "NEGAR_VIDEOS_DIR",
                    "NEGAR_DATA_DIR", "NEGAR_SSL_DIR", "NEGAR_ACME_WEBROOT",
                    "ENABLE_STANDARD_PORTS", "SECURE_PORT")
RUNNING_PHASES = {"running", "external", "starting", "unhealthy"}


def _is_within(root: Path | str, path: Path | str) -> bool:
    root, path = Path(root).expanduser().resolve(), Path(path).expanduser().resolve()
    return root == path or root in path.parents


def _dotenv_value(value: Any) -> str:
    """Format a value so dotenv (server/config.ts) reads it back verbatim.

    dotenv expands ``\\n`` inside double quotes, which corrupts every Windows
    path containing a ``\\n...`` segment. Unquoted values are literal, so they
    are preferred; values with ``#`` or padding are single quoted.
    """
    text = str(value)
    if "\n" in text or "\r" in text:
        raise ValueError("configuration values cannot contain line breaks")
    if not text or text != text.strip() or "#" in text:
        if "'" in text:
            raise ValueError(f"unsupported character in configuration value: {text!r}")
        return f"'{text}'"
    return text


class CoreBridge:
    def __init__(self, paths: AppPaths | None = None) -> None:
        self.paths = paths or default_paths()
        self.store = settings_store(self.paths)
        self.settings = validate_settings(self.store.load())
        if self.settings.get("storage_dir"):
            self.paths = replace(self.paths, storage_dir=Path(self.settings["storage_dir"]))
        if self.settings.get("database"):
            self.paths = replace(self.paths, database=Path(self.settings["database"]))
        self.controller: ServerController | None = None
        self._adopt_checked = False
        self._action_lock = threading.RLock()
        self._storage_cache: tuple[float, int] = (0.0, -1)
        self._videos_cache: tuple[float, int] = (0.0, -1)
        self.log = LogManager(self.paths.logs_dir).logger()
        self.output: list[str] = []
        self.output_lock = threading.Lock()
        self._repair_startup_entries()

    # ------------------------------------------------------------------
    # Settings and server environment
    # ------------------------------------------------------------------
    def save_settings(self, values: dict[str, Any], sync_env: bool = True) -> dict[str, Any]:
        merged = validate_settings({**self.settings, **values})
        self.store.save(merged)
        self.settings = merged
        if sync_env:
            try:
                self._write_server_env(self._env_values())
            except OSError as exc:  # read-only checkout: settings still persist
                self.log.warning("Could not update .env: %s", exc)
        if self.controller is not None:
            self.controller.env.update(self._server_env())
            self.controller.health_url = merged["health_url"]
            self.controller.startup_timeout = float(merged["startup_timeout"])
        return merged

    @property
    def videos_dir(self) -> Path:
        """Where uploaded originals and their renditions live.

        The server key stays ``videos/<file>`` either way; only the physical root
        moves, so existing database rows keep working after a switch.
        """
        configured = str(self.settings.get("videos_dir") or "").strip()
        if configured:
            return Path(configured).expanduser().resolve()
        return (self.paths.storage_dir / "videos").expanduser().resolve()

    def _env_values(self) -> dict[str, str]:
        values = {"PORT": str(self.settings["port"])}
        if self.settings.get("storage_dir"):
            values["NEGAR_STORAGE_DIR"] = str(Path(self.settings["storage_dir"]).expanduser().resolve())
        if self.settings.get("videos_dir"):
            values["NEGAR_VIDEOS_DIR"] = str(self.videos_dir)
        if self.settings.get("database"):
            values["NEGAR_DB_FILE_PATH"] = str(Path(self.settings["database"]).expanduser().resolve())
        return values

    def _server_env(self) -> dict[str, str]:
        env = {"PORT": str(self.settings["port"]), "NODE_ENV": str(self.settings["mode"])}
        if self.settings.get("storage_dir"):
            env["NEGAR_STORAGE_DIR"] = str(Path(self.settings["storage_dir"]).expanduser().resolve())
        if self.settings.get("videos_dir"):
            env["NEGAR_VIDEOS_DIR"] = str(self.videos_dir)
        if self.settings.get("database"):
            env["NEGAR_DB_FILE_PATH"] = str(Path(self.settings["database"]).expanduser().resolve())
        return env

    def server_env_file(self) -> Path:
        return self.paths.repo_root / ".env"

    def server_env(self) -> dict[str, str]:
        """The managed values the JS layer will read on its next start."""
        path = self.server_env_file()
        values: dict[str, str] = {}
        if not path.exists():
            return values
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
                if not match or match.group(1) not in MANAGED_ENV_KEYS:
                    continue
                raw = match.group(2).strip()
                if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"'", '"'}:
                    raw = raw[1:-1]
                values[match.group(1)] = raw
        except OSError as exc:
            self.log.warning("Could not read .env: %s", exc)
        return values

    # ------------------------------------------------------------------
    # Controller and lifecycle
    # ------------------------------------------------------------------
    def _controller(self) -> ServerController:
        if self.controller is None:
            command = ServerController.command_for_repo(self.paths.repo_root, self.settings["mode"])
            env = os.environ.copy()
            env.update(self._server_env())
            self.controller = ServerController(
                command, self.paths.repo_root, self.settings["health_url"],
                env=env, startup_timeout=float(self.settings["startup_timeout"]))
        if not self._adopt_checked:
            self._adopt_checked = True
            pid = int(self.settings.get("server_pid") or 0)
            started = float(self.settings.get("server_process_started") or 0) or None
            if pid and self.controller.adopt(pid, started):
                self.log.info("Re-attached to running server pid=%s", pid)
            elif pid:
                self._forget_identity()
        return self.controller

    def _attach_output(self) -> None:
        if self.controller is None:
            return
        process = getattr(self.controller.process_manager, "_last_process", None)
        if process is not None:
            self.controller.process_manager.start_output_reader(
                lambda line: self._drain_line(line, "server"))

    def _remember_identity(self, identity) -> None:
        try:
            self.save_settings({
                "server_pid": identity.pid,
                "server_process_started": identity.process_started_at or 0.0,
                "server_started_at": identity.started_at,
            }, sync_env=False)
        except OSError as exc:
            self.log.warning("Could not persist the server identity: %s", exc)

    def _forget_identity(self) -> None:
        try:
            self.save_settings({"server_pid": 0, "server_process_started": 0.0,
                                "server_started_at": 0.0}, sync_env=False)
        except OSError as exc:
            self.log.warning("Could not clear the server identity: %s", exc)

    def _drain_line(self, line: str, label: str) -> None:
        text = f"[{label}] {line.rstrip()}"
        with self.output_lock:
            self.output.append(text)
            del self.output[:-800]
        self.log.info(text)

    def start_server(self) -> dict[str, Any]:
        with self._action_lock:
            try:
                controller = self._controller()
                if controller.is_running() or controller.probe(timeout=0.5).healthy:
                    return {"ok": True, "phase": "running", "message": "Server is already running"}
                identity = controller.start()
                self._attach_output()
                self._remember_identity(identity)
                self.log.info("Server start: pid=%s", identity.pid)
                return {"ok": True, "phase": "starting", "pid": identity.pid,
                        "started_at": identity.started_at}
            except Exception as exc:
                self.log.exception("Server start failed")
                return {"ok": False, "phase": "stopped", "message": str(exc)}

    def stop_server(self) -> dict[str, Any]:
        with self._action_lock:
            try:
                controller = self._controller()
                if controller.identity is None:
                    if controller.probe(timeout=0.8).healthy:
                        return {"ok": False, "phase": "external",
                                "message": "This server was not started by the manager. "
                                           "Stop it from its own console, or restart it from here."}
                    return {"ok": True, "phase": "stopped", "message": "Server is not running"}
                ok = controller.stop(float(self.settings["startup_timeout"]))
                self._forget_identity()
                self.log.info("Server stop: %s", ok)
                return {"ok": ok, "phase": "stopped" if ok else "unhealthy"}
            except Exception as exc:
                self.log.exception("Server stop failed")
                return {"ok": False, "phase": "unhealthy", "message": str(exc)}

    def restart_server(self) -> dict[str, Any]:
        with self._action_lock:
            controller = self._controller()
            was_running = controller.is_running()
            if was_running and not self.stop_server()["ok"]:
                return {"ok": False, "phase": "unhealthy", "message": "Could not stop the server"}
            result = self.start_server()
            result["restarted"] = was_running
            return result

    def service_action(self, action: str) -> dict[str, Any]:
        action = str(action).lower()
        if action == "start":
            return self.start_server()
        if action == "stop":
            return self.stop_server()
        if action == "restart":
            return self.restart_server()
        return {"ok": False, "message": f"Unknown action: {action}"}

    def wait_until_healthy(self, timeout: float | None = None) -> dict[str, Any]:
        deadline = time.monotonic() + float(timeout or self.settings["startup_timeout"])
        controller = self._controller()
        while time.monotonic() < deadline:
            if controller.probe(timeout=1.0).healthy:
                return {"healthy": True, "phase": "running", "runtime": self.runtime_config()}
            time.sleep(0.4)
        return {"healthy": False, "phase": controller.status().get("phase"), "runtime": self.runtime_config()}

    # ------------------------------------------------------------------
    # Observation
    # ------------------------------------------------------------------
    def state(self) -> dict[str, Any]:
        try:
            controller = self._controller()
            data = controller.status()
        except Exception as exc:
            data = {"phase": "stopped", "running": False, "managed": False,
                    "health": {"ok": False, "error": str(exc)}, "status": "stopped", "uptime": 0}
        database = self.paths.database
        data.update({
            "repo": str(self.paths.repo_root),
            "database": str(database),
            "database_exists": database.exists(),
            "database_size": database.stat().st_size if database.exists() else 0,
            "storage": str(self.paths.storage_dir),
            "storage_size": self.storage_size(),
            "videos": str(self.videos_dir),
            "videos_size": self.videos_size(),
            "port": self.settings["port"],
            "mode": self.settings["mode"],
            "health_url": self.settings["health_url"],
            "runtime": self.runtime_config(),
        })
        return data

    def health(self) -> dict[str, Any]:
        return self.state()

    def metrics(self) -> dict[str, Any]:
        data = self.state()
        usage = shutil.disk_usage(self.paths.repo_root)
        data["disk_free"] = usage.free
        data["disk_total"] = usage.total
        return data

    def probe(self) -> dict[str, Any]:
        try:
            result = self._controller().probe(timeout=2.0)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": result.healthy, "status_code": result.status,
                "latency_ms": result.latency_ms, "error": result.error,
                "url": self.settings["health_url"]}

    def recent_logs(self, limit: int = 500) -> list[str]:
        with self.output_lock:
            return self.output[-limit:]

    def clear_output(self) -> None:
        with self.output_lock:
            self.output.clear()

    def runtime_config(self) -> dict[str, str]:
        """Paths the server reported on its last start (printed by server/config.ts)."""
        result: dict[str, str] = {}
        with self.output_lock:
            lines = list(self.output)
        markers = (("database", "Database file:"), ("videos", "Videos root:"),
                   ("storage", "Storage root:"), ("data", "Data directory:"))
        for line in reversed(lines):
            for key, marker in markers:
                if key not in result and marker in line:
                    result[key] = line.split(marker, 1)[1].strip()
            if len(result) == len(markers):
                break
        return result

    @staticmethod
    def _tree_size(root: Path) -> int:
        try:
            return sum(p.stat().st_size for p in root.rglob("*") if p.is_file()) if root.exists() else 0
        except OSError:
            return 0

    def storage_size(self, max_age: float = 30.0) -> int:
        """Everything under the storage root, plus the videos root when it moved."""
        stamp, size = self._storage_cache
        if size >= 0 and time.monotonic() - stamp < max_age:
            return size
        root = self.paths.storage_dir
        total = self._tree_size(root)
        videos = self.videos_dir
        if not _is_within(root, videos):
            total += self._tree_size(videos)
        self._storage_cache = (time.monotonic(), total)
        return total

    def videos_size(self, max_age: float = 30.0) -> int:
        stamp, size = self._videos_cache
        if size >= 0 and time.monotonic() - stamp < max_age:
            return size
        size = self._tree_size(self.videos_dir)
        self._videos_cache = (time.monotonic(), size)
        return size

    def storage_info(self) -> dict[str, Any]:
        root = self.paths.storage_dir
        usage = shutil.disk_usage(root if root.exists() else root.parent)
        return {"path": str(root), "exists": root.exists(), "size": self.storage_size(0),
                "free": usage.free, "total": usage.total}

    def validate_database(self, path: Path | None = None) -> dict[str, Any]:
        target = Path(path or self.paths.database)
        db = DatabaseManager(target)
        valid = db.validate()
        return {"ok": valid, "path": str(target), "valid": valid,
                "size": target.stat().st_size if target.exists() else 0,
                "modified": target.stat().st_mtime if target.exists() else None}

    # ------------------------------------------------------------------
    # Storage destination
    # ------------------------------------------------------------------
    def apply_storage_path(self, value: str, migrate: bool = False,
                           restart: bool = True) -> dict[str, Any]:
        with self._action_lock:
            target = self._resolve_directory(value)
            source = self.paths.storage_dir.expanduser().resolve()
            if target == source:
                return {"ok": True, "changed": False, "path": str(target),
                        "migrated": False, "message": "Already using this location"}
            self._guard_independent(target, self.paths.database, "storage")
            if self.settings.get("videos_dir") and self._videos_inside(target):
                raise ValueError("The videos folder is inside the new storage root. "
                                 "Move the videos folder to an independent path first, "
                                 "or reset it to the storage default.")

            was_running = self._server_is_up()
            if was_running and self.controller is not None and self.controller.identity is None:
                raise RuntimeError("The server is running outside the manager. Stop it first, "
                                   "then change the storage destination.")
            target.mkdir(parents=True, exist_ok=True)
            if not os.access(target, os.W_OK):
                raise PermissionError(f"Storage is not writable: {target}")
            stopped = bool(was_running and self.stop_server().get("ok"))
            copied = 0
            try:
                if migrate:
                    copied = self._migrate_tree(source, target)
                self._write_server_env({
                    "NEGAR_STORAGE_DIR": str(target),
                    "NEGAR_DB_FILE_PATH": str(self.paths.database.expanduser().resolve()),
                    "PORT": str(self.settings["port"]),
                })
                self.settings = self.save_settings({"storage_dir": str(target)})
                self.paths = replace(self.paths, storage_dir=target)
                self._storage_cache = (0.0, -1)
                if self.controller is not None:
                    self.controller.env["NEGAR_STORAGE_DIR"] = str(target)
                result: dict[str, Any] = {
                    "ok": True, "changed": True, "path": str(target), "migrated": bool(migrate),
                    "copied_files": copied, "source": str(source), "source_retained": bool(migrate),
                    "restart_required": not (stopped and restart),
                }
            except Exception:
                if stopped:
                    self.start_server()
                raise
            if stopped and restart:
                outcome = self.start_server()
                wait = self.wait_until_healthy() if outcome.get("ok") else outcome
                result.update({"restarted": bool(outcome.get("ok")),
                               "healthy": bool(wait.get("healthy")),
                               "runtime": wait.get("runtime", {})})
            return result

    def migrate_storage_path(self, value: str) -> dict[str, Any]:
        """Copy media to a new root, verify every byte, then switch config."""
        return self.apply_storage_path(value, migrate=True)

    def set_storage_path(self, value: str) -> dict[str, Any]:
        return self.apply_storage_path(value, migrate=False)

    # ------------------------------------------------------------------
    # Videos destination (may live on another drive)
    # ------------------------------------------------------------------
    def apply_videos_path(self, value: str, migrate: bool = False,
                          restart: bool = True) -> dict[str, Any]:
        """Point the server's `videos/` keys at another folder or drive.

        The folder must stay outside the media storage root, so moving storage
        later can never orphan or duplicate the video files.
        """
        with self._action_lock:
            target = self._resolve_directory(value)
            source = self.videos_dir
            if target == source:
                return {"ok": True, "changed": False, "path": str(target),
                        "migrated": False, "message": "Already using this location"}
            self._guard_videos_target(target)
            if _is_within(source, target) or _is_within(target, source):
                raise ValueError("The new videos folder must not sit inside the current "
                                 "videos folder (or contain it).")

            was_running = self._server_is_up()
            if was_running and self.controller is not None and self.controller.identity is None:
                raise RuntimeError("The server is running outside the manager. Stop it first, "
                                   "then change the videos folder.")
            target.mkdir(parents=True, exist_ok=True)
            if not os.access(target, os.W_OK):
                raise PermissionError(f"The videos folder is not writable: {target}")
            stopped = bool(was_running and self.stop_server().get("ok"))
            copied = 0
            try:
                if migrate:
                    copied = self._migrate_tree(source, target)
                self._write_server_env({
                    "NEGAR_VIDEOS_DIR": str(target),
                    "NEGAR_STORAGE_DIR": str(self.paths.storage_dir.expanduser().resolve()),
                    "NEGAR_DB_FILE_PATH": str(self.paths.database.expanduser().resolve()),
                    "PORT": str(self.settings["port"]),
                })
                self.settings = self.save_settings({"videos_dir": str(target)}, sync_env=False)
                self._videos_cache = (0.0, -1)
                self._storage_cache = (0.0, -1)
                if self.controller is not None:
                    self.controller.env["NEGAR_VIDEOS_DIR"] = str(target)
                result: dict[str, Any] = {
                    "ok": True, "changed": True, "path": str(target), "migrated": bool(migrate),
                    "copied_files": copied, "source": str(source),
                    "source_retained": bool(migrate),
                    "restart_required": not (stopped and restart),
                }
            except Exception:
                if stopped:
                    self.start_server()
                raise
            if stopped and restart:
                outcome = self.start_server()
                wait = self.wait_until_healthy() if outcome.get("ok") else outcome
                runtime = wait.get("runtime", {})
                active = runtime.get("videos")
                result.update({"restarted": bool(outcome.get("ok")),
                               "healthy": bool(wait.get("healthy")),
                               "runtime": runtime,
                               "verified": bool(active and Path(active) == target)})
            self.log.info("Videos destination: %s -> %s (migrated=%s)", source, target, migrate)
            return result

    def migrate_videos_path(self, value: str) -> dict[str, Any]:
        return self.apply_videos_path(value, migrate=True)

    def set_videos_path(self, value: str) -> dict[str, Any]:
        return self.apply_videos_path(value, migrate=False)

    def reset_videos_path(self, restart: bool = True) -> dict[str, Any]:
        """Return videos to `<storage root>/videos` (the server default)."""
        with self._action_lock:
            if not self.settings.get("videos_dir"):
                return {"ok": True, "changed": False, "path": str(self.videos_dir),
                        "message": "Already using the storage default"}
            source = self.videos_dir
            target = (self.paths.storage_dir / "videos").expanduser().resolve()
            was_running = self._server_is_up()
            if was_running and self.controller is not None and self.controller.identity is None:
                raise RuntimeError("The server is running outside the manager. Stop it first, "
                                   "then change the videos folder.")
            target.mkdir(parents=True, exist_ok=True)
            stopped = bool(was_running and self.stop_server().get("ok"))
            try:
                self._write_server_env({}, remove=("NEGAR_VIDEOS_DIR",))
                self.settings = self.save_settings({"videos_dir": ""}, sync_env=False)
                self._videos_cache = (0.0, -1)
                self._storage_cache = (0.0, -1)
                if self.controller is not None:
                    self.controller.env.pop("NEGAR_VIDEOS_DIR", None)
            except Exception:
                if stopped:
                    self.start_server()
                raise
            result: dict[str, Any] = {"ok": True, "changed": True, "path": str(target),
                                      "source": str(source), "migrated": False,
                                      "source_retained": True}
            if stopped and restart:
                outcome = self.start_server()
                wait = self.wait_until_healthy() if outcome.get("ok") else outcome
                runtime = wait.get("runtime", {})
                active = runtime.get("videos")
                result.update({"restarted": bool(outcome.get("ok")),
                               "healthy": bool(wait.get("healthy")), "runtime": runtime,
                               "verified": bool(active and Path(active) == target)})
            return result

    def _videos_inside(self, storage: Path) -> bool:
        """True when a custom videos folder would sit inside `storage`."""
        videos = self.videos_dir
        return _is_within(storage, videos) or _is_within(videos, storage)

    def _guard_videos_target(self, target: Path) -> None:
        storage = self.paths.storage_dir.expanduser().resolve()
        if _is_within(storage, target) or _is_within(target, storage):
            raise ValueError("The videos folder must be outside the media storage root. "
                             "Choose another folder or drive.")
        database = self.paths.database.expanduser().resolve()
        if target == database or _is_within(target, database):
            raise ValueError("The videos folder cannot contain the database file.")

    # ------------------------------------------------------------------
    # Database destination
    # ------------------------------------------------------------------
    def apply_database_path(self, value: str, mode: str = "replace",
                            restart: bool = True) -> dict[str, Any]:
        """Move the SQLite file and make the JS server use it.

        ``mode`` is ``replace`` (copy the current database to the destination)
        or ``adopt`` (use an existing database already at the destination).
        """
        with self._action_lock:
            target = self._resolve_database(value)
            current = self.paths.database.expanduser().resolve()
            if target == current:
                return {"ok": True, "changed": False, "path": str(target),
                        "message": "Already using this location"}
            self._guard_independent(target, self.paths.storage_dir, "database")
            target.parent.mkdir(parents=True, exist_ok=True)
            if not os.access(target.parent, os.W_OK):
                raise PermissionError(f"Database directory is not writable: {target.parent}")
            if mode == "adopt" and not target.exists():
                raise FileNotFoundError(f"No database to adopt at {target}")
            if mode not in {"replace", "adopt"}:
                raise ValueError(f"Unknown database switch mode: {mode}")

            was_running = self._server_is_up()
            if was_running and self.controller is not None and self.controller.identity is None:
                raise RuntimeError("The server is running outside the manager. Stop it first, "
                                   "then change the database destination.")
            if was_running and not self.stop_server().get("ok"):
                raise RuntimeError("The server could not be stopped, so the database was left untouched.")

            backup: str | None = None
            preserved: str | None = None
            try:
                if current.exists():
                    backup = str(self.create_backup(destination=self.paths.backups_dir /
                                                    f"pre-db-move-{time.strftime('%Y%m%d-%H%M%S')}.zip")["path"])
                if mode == "replace":
                    if target.exists():
                        preserved = f"{target}.replaced-{time.strftime('%Y%m%d-%H%M%S')}"
                        os.replace(target, preserved)
                    if current.exists():
                        self._copy_verified(current, target)
                    else:
                        DatabaseManager(target).migrate()
                validation = self.validate_database(target)
                if not validation["valid"]:
                    raise IOError(f"The database at {target} failed its integrity check")
                self._write_server_env({
                    "NEGAR_DB_FILE_PATH": str(target),
                    "NEGAR_STORAGE_DIR": str(self.paths.storage_dir.expanduser().resolve()),
                    "PORT": str(self.settings["port"]),
                })
                self.settings = self.save_settings({"database": str(target)})
                self.paths = replace(self.paths, database=target)
                self._forget_identity()
                if self.controller is not None:
                    self.controller.env["NEGAR_DB_FILE_PATH"] = str(target)
            except Exception:
                self._restore_previous_database(current, target, mode, preserved)
                if was_running:
                    self.start_server()
                raise

            result: dict[str, Any] = {
                "ok": True, "changed": True, "path": str(target), "mode": mode,
                "valid": validation["valid"], "backup": backup, "preserved": preserved,
                "size": target.stat().st_size if target.exists() else 0,
                "restart_required": not (was_running and restart),
                "env_file": str(self.server_env_file()),
                "env": self.server_env(),
            }
            if was_running and restart:
                outcome = self.start_server()
                wait = self.wait_until_healthy() if outcome.get("ok") else outcome
                runtime = wait.get("runtime", {})
                active = runtime.get("database")
                result.update({"restarted": bool(outcome.get("ok")),
                               "healthy": bool(wait.get("healthy")),
                               "runtime": runtime,
                               "verified": bool(active and Path(active) == target)})
            return result

    def set_database_path(self, value: str) -> dict[str, Any]:
        return self.apply_database_path(value, mode="replace")

    def _restore_previous_database(self, current: Path, target: Path, mode: str,
                                   preserved: str | None) -> None:
        try:
            if mode == "replace" and preserved and os.path.exists(preserved):
                os.replace(preserved, target)
            elif mode == "replace" and target.exists() and target != current:
                target.unlink(missing_ok=True)
            self.save_settings({"database": str(current)})
            self._write_server_env({"NEGAR_DB_FILE_PATH": str(current)})
            self.paths = replace(self.paths, database=current)
        except OSError as exc:
            self.log.error("Rollback after a failed database move was incomplete: %s", exc)

    # ------------------------------------------------------------------
    # Backups
    # ------------------------------------------------------------------
    def create_backup(self, include_media: bool = False,
                      destination: Path | None = None) -> dict[str, Any]:
        sources = [self.paths.database]
        excluded: list[Path] = []
        if include_media:
            sources.append(self.paths.storage_dir)
            if not _is_within(self.paths.storage_dir, self.videos_dir):
                # The retained old videos folder must not be zipped twice, and
                # must never shadow the active folder on restore.
                sources.append(self.videos_dir)
                excluded.append(self.paths.storage_dir / "videos")
        target = destination or (self.paths.backups_dir /
                                 f"20negar-backup-{time.strftime('%Y%m%d-%H%M%S')}.zip")
        path = BackupManager(self.paths.backups_dir).create(sources, target, exclude=excluded)
        self.log.info("Backup created: %s", path)
        return {"ok": True, "path": str(path), "size": path.stat().st_size}

    def backups(self) -> list[dict[str, Any]]:
        root = self.paths.backups_dir
        if not root.exists():
            return []
        entries = []
        for path in sorted(root.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                stats = path.stat()
                entries.append({"name": path.name, "path": str(path), "size": stats.st_size,
                                "created_at": stats.st_mtime})
            except OSError:
                continue
        return entries

    def restore_backup(self, archive: Path) -> dict[str, Any]:
        archive = Path(archive)
        if not archive.exists():
            return {"ok": False, "message": "Backup does not exist"}
        with self._action_lock:
            was_running = self._server_is_up()
            if was_running and self.controller is not None and self.controller.identity is None:
                raise RuntimeError("The server is running outside the manager. Stop it first, "
                                   "then restore a backup.")
            if was_running and not self.stop_server().get("ok"):
                raise RuntimeError("The server could not be stopped, so the backup was not restored.")
            snapshot = self.create_backup(
                destination=self.paths.backups_dir /
                f"pre-restore-{time.strftime('%Y%m%d-%H%M%S')}.zip")
            with tempfile.TemporaryDirectory(prefix="20negar-restore-") as directory:
                root = Path(directory)
                BackupManager(self.paths.backups_dir).restore(archive, root)
                database = next((p for p in root.iterdir()
                                 if p.is_file() and p.suffix.lower() in {".sqlite", ".db"}), None)
                if database is not None:
                    self.paths.database.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(database, self.paths.database)
                media = root / "storage"
                # A videos folder archived on its own (relocated destination)
                # always wins; the storage copy would be the retained old one.
                dedicated = root / "videos"
                if media.is_dir():
                    for file in media.rglob("*"):
                        if not file.is_file():
                            continue
                        relative = file.relative_to(media)
                        if dedicated.is_dir() and relative.parts and relative.parts[0] == "videos":
                            continue
                        base = (self.videos_dir if relative.parts and relative.parts[0] == "videos"
                                else self.paths.storage_dir)
                        destination = base / relative
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(file, destination)
                if dedicated.is_dir():
                    for file in dedicated.rglob("*"):
                        if not file.is_file():
                            continue
                        destination = self.videos_dir / file.relative_to(dedicated)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(file, destination)
            self._storage_cache = (0.0, -1)
            self._videos_cache = (0.0, -1)
            result = {"ok": True, "recovery_snapshot": snapshot["path"],
                      "database": str(self.paths.database)}
            if was_running:
                outcome = self.start_server()
                result["restarted"] = bool(outcome.get("ok"))
            return result

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------
    def _resolve_directory(self, value: str) -> Path:
        text = str(value or "").strip()
        if not text:
            raise ValueError("A destination path is required")
        return Path(os.path.expandvars(text)).expanduser().resolve()

    def _resolve_database(self, value: str) -> Path:
        target = self._resolve_directory(value)
        if target.suffix == "":
            target = target.with_suffix(".sqlite")
        if target.exists() and target.is_dir():
            raise ValueError(f"Database path is a directory: {target}")
        return target

    @staticmethod
    def _guard_independent(target: Path, other: Path, kind: str) -> None:
        other = Path(other).expanduser().resolve()
        if target == other:
            raise ValueError(f"{kind} and the other storage location must be independent paths")
        if kind == "database":
            if target == other or other in target.parents:
                raise ValueError("The database file cannot live inside the media storage folder")

    def _server_is_up(self) -> bool:
        try:
            controller = self._controller()
        except Exception:
            return False
        return controller.is_running() or controller.probe(timeout=0.6).healthy

    @staticmethod
    def _digest(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _copy_verified(self, source: Path, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".copying")
        try:
            shutil.copy2(source, temporary)
            if source.stat().st_size != temporary.stat().st_size:
                raise IOError(f"copy verification failed: {source.name}")
            if self._digest(source) != self._digest(temporary):
                raise IOError(f"checksum verification failed: {source.name}")
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def _migrate_tree(self, source: Path, target: Path) -> int:
        files = [p for p in source.rglob("*") if p.is_file()] if source.exists() else []
        copied = 0
        for source_file in files:
            relative = source_file.relative_to(source)
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, destination)
            if source_file.stat().st_size != destination.stat().st_size:
                raise IOError(f"copy verification failed: {relative}")
            if self._digest(source_file) != self._digest(destination):
                raise IOError(f"checksum verification failed: {relative}")
            copied += 1
        return copied

    def _write_server_env(self, updates: dict[str, str], remove=()) -> None:
        """Patch the dotenv file the TypeScript server loads at boot."""
        env_path = self.server_env_file()
        lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
        for key in remove:
            pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(key)}\s*=")
            lines = [line for line in lines if not pattern.match(line)]
        for key, value in updates.items():
            formatted = _dotenv_value(value)
            pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(key)}\s*=")
            replaced = False
            kept: list[str] = []
            for line in lines:
                if pattern.match(line):
                    if not replaced:
                        kept.append(f"{key}={formatted}")
                        replaced = True
                    continue
                kept.append(line)
            if not replaced:
                kept.append(f"{key}={formatted}")
            lines = kept
        env_path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".env.", dir=env_path.parent, text=True)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write("\n".join(lines) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, env_path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    # ------------------------------------------------------------------
    # Startup, diagnostics, updates
    # ------------------------------------------------------------------
    def _startup_dir(self) -> Path:
        return StartupManager("20Negar-Manager", []).startup_dir

    def _startup_entries(self) -> tuple[StartupManager, StartupManager]:
        """Both sign-in entries, always anchored at the repository this manager runs."""
        startup_dir = self._startup_dir()
        manager_command = ([sys.executable] if getattr(sys, "frozen", False)
                           else [sys.executable, str(self.paths.repo_root / "manager" / "main.py")])
        server_command = ServerController.command_for_repo(self.paths.repo_root, self.settings["mode"])
        scripts = self.paths.config_dir / "startup"
        # hidden=True: at sign-in WScript starts the batch file with no console
        # window, so no node.exe/cmd window is left on screen.
        manager = StartupManager("20Negar-Manager", manager_command, startup_dir,
                                 cwd=self.paths.repo_root, hidden=True, script_dir=scripts)
        server = StartupManager("20Negar-Server", server_command, startup_dir,
                                cwd=self.paths.repo_root, env=self._server_env(),
                                log_file=self.paths.logs_dir / "startup-server.log",
                                hidden=True, script_dir=scripts)
        return manager, server

    def startup_dir(self) -> Path:
        return self._startup_dir()

    def _repair_startup_entries(self) -> None:
        """Rewrite enabled sign-in entries that still point at another checkout.

        Older builds wrote the entry without a working directory, so Windows ran
        it from the user profile and the server never came up. Repairing on start
        means an existing installation is fixed by simply opening the manager.
        """
        try:
            manager, server = self._startup_entries()
            if self.settings.get("start_gui_on_login") and not manager.current():
                manager.enable(overwrite=True)
                self.log.info("Refreshed the manager sign-in entry")
            if self.settings.get("startup_server_enabled") and not server.current():
                server.enable(overwrite=True)
                self.log.info("Refreshed the server sign-in entry")
        except (OSError, FileNotFoundError) as exc:
            self.log.warning("Could not refresh the sign-in entries: %s", exc)

    def startup_status(self) -> dict[str, Any]:
        manager, server = self._startup_entries()
        return {"manager": manager.enabled(), "server": server.enabled(),
                "directory": str(manager.startup_dir), "manager_path": str(manager.shortcut_path),
                "server_path": str(server.shortcut_path), "server_log": str(server.log_file),
                "server_script": str(server.script_path),
                "server_current": server.current(), "server_command": server.command_line(),
                "repo_root": str(self.paths.repo_root)}

    def startup(self, manager_enabled: bool, server_enabled: bool) -> dict[str, Any]:
        manager, server = self._startup_entries()
        # Apply always rewrites: a moved repository or a new videos folder must not
        # leave a stale entry behind that silently starts the old configuration.
        manager_path = manager.enable(overwrite=True) if manager_enabled else \
            (manager.disable() or manager.shortcut_path)
        server_path = server.enable(overwrite=True) if server_enabled else \
            (server.disable() or server.shortcut_path)
        self.save_settings({"start_gui_on_login": manager_enabled,
                            "startup_server_enabled": server_enabled,
                            "startup_enabled": server_enabled})
        return {"ok": True, "manager_enabled": manager_enabled, "server_enabled": server_enabled,
                "manager_path": str(manager_path), "server_path": str(server_path),
                "directory": str(manager.startup_dir), "server_log": str(server.log_file),
                "server_current": server.current() if server_enabled else False}

    def diagnostics(self) -> dict[str, Any]:
        return Diagnostics().collect(self.paths, self.settings, self.state())

    # ------------------------------------------------------------------
    # Updates
    # ------------------------------------------------------------------
    def update_check(self) -> dict[str, Any]:
        """Read-only comparison with GitHub; never touches the working tree."""
        return UpdateManager(self.paths.repo_root).check()

    def update_status(self) -> dict[str, Any]:
        """Backward-compatible alias used by older pages."""
        return self.update_check()

    def apply_update(self) -> dict[str, Any]:
        """Stop the server, snapshot the database, fast-forward, then restart.

        Every failure after the stop restarts the server again, so the studio is
        never left offline because an update could not be applied.
        """
        with self._action_lock:
            manager = UpdateManager(self.paths.repo_root)
            check = manager.check()
            if not check.get("ok"):
                return {"ok": False, "changed": False, "check": check,
                        "message": check.get("message") or "The update check failed."}
            if check.get("up_to_date") or not check.get("can_apply"):
                return {"ok": True, "changed": False, "check": check,
                        "message": check.get("message") or "Already up to date."}

            was_running = self._server_is_up()
            if was_running and self.controller is not None and self.controller.identity is None:
                return {"ok": False, "changed": False, "check": check,
                        "message": "The server was started outside the manager. "
                                   "Stop it first, then update."}
            if was_running and not self.stop_server().get("ok"):
                return {"ok": False, "changed": False, "check": check,
                        "message": "The server could not be stopped, so nothing was updated."}

            backup: str | None = None
            try:
                if self.paths.database.exists():
                    backup = str(self.create_backup(destination=self.paths.backups_dir /
                                                    f"pre-update-{time.strftime('%Y%m%d-%H%M%S')}.zip")["path"])
                result = manager.apply()
                self.log.info("Update applied: %s -> %s (%s files)",
                              result.get("from_commit", "")[:10],
                              result.get("to_commit", "")[:10],
                              len(result.get("files_changed", [])))
            except Exception as exc:
                self.log.error("Update failed: %s", exc)
                outcome: dict[str, Any] = {}
                if was_running:
                    outcome = self.start_server()
                return {"ok": False, "changed": False, "check": check,
                        "backup": backup, "restarted": bool(outcome.get("ok")),
                        "message": str(exc)}

            files = list(result.get("files_changed", []))
            response: dict[str, Any] = {
                "ok": True, "changed": bool(result.get("changed")), "check": check,
                "from_commit": result.get("from_commit"), "to_commit": result.get("to_commit"),
                "files_changed": files, "npm_installed": bool(result.get("npm_installed")),
                "backup": backup,
                # The manager itself is Python running from this checkout.
                "manager_changed": any(str(name).startswith("manager/") for name in files),
            }
            if was_running:
                outcome = self.start_server()
                wait = self.wait_until_healthy() if outcome.get("ok") else outcome
                response.update(restarted=bool(outcome.get("ok")),
                                healthy=bool(wait.get("healthy")),
                                runtime=wait.get("runtime", {}))
            response["message"] = result.get("message") or "Update applied."
            if response.get("manager_changed"):
                response["message"] += " Restart the manager to load the updated UI."
            if was_running and not response.get("healthy", True):
                response["message"] += " The server is restarting; check Logs if it stays offline."
            return response

    # ------------------------------------------------------------------
    # HTTPS certificates (self-signed and Let's Encrypt)
    # ------------------------------------------------------------------
    def _server_data_dir(self) -> Path:
        configured = str(self.server_env().get("NEGAR_DATA_DIR") or "").strip()
        return Path(configured).expanduser().resolve() if configured \
            else (self.paths.repo_root / "data")

    def certificates(self):
        # Keep cryptography optional at import time: the manager must always
        # start, even before scripts\install.bat has installed the dependency.
        try:
            from .cert_manager import CertificateManager
        except ImportError as exc:
            raise RuntimeError(
                "The 'cryptography' package is required for HTTPS certificates. "
                "Run scripts\\install.bat (or pip install cryptography), then "
                "restart the manager.") from exc
        env = self.server_env()
        data = self._server_data_dir()
        certs = Path(env["NEGAR_SSL_DIR"]).expanduser().resolve() \
            if env.get("NEGAR_SSL_DIR") else data / "certs"
        webroot = Path(env["NEGAR_ACME_WEBROOT"]).expanduser().resolve() \
            if env.get("NEGAR_ACME_WEBROOT") else data / "acme"
        return CertificateManager(certs, webroot)

    def tls_status(self) -> dict[str, Any]:
        try:
            status = self.certificates().status()
        except Exception as exc:
            return {"ok": False, "configured": False, "kind": "none",
                    "feature_unavailable": True, "error": str(exc)}
        status.update({
            "domain": str(self.settings.get("tls_domain") or status.get("domain") or ""),
            "email": str(self.settings.get("tls_email") or ""),
            "staging": bool(self.settings.get("tls_staging", False)),
            "autorenew": bool(self.settings.get("tls_autorenew", True)),
            "autorenew_days": int(self.settings.get("tls_autorenew_days", 30) or 30),
            "last_check": float(self.settings.get("tls_last_check", 0.0) or 0.0),
            "https_active": self._https_expected(),
        })
        return status

    def _https_expected(self) -> bool:
        """The server mounts HTTPS on SECURE_PORT when standard ports are on."""
        env = self.server_env()
        return str(env.get("ENABLE_STANDARD_PORTS", "true")).lower() != "false"

    def tls_save(self, values: dict[str, Any]) -> dict[str, Any]:
        allowed = {key: values[key] for key in
                   ("tls_domain", "tls_email", "tls_staging", "tls_autorenew",
                    "tls_autorenew_days") if key in values}
        self.settings = self.save_settings(allowed, sync_env=False)
        return self.tls_status()

    def _reload_https(self, status: dict[str, Any]) -> dict[str, Any]:
        """Node reads the certificate only at listener creation: restart once."""
        if not self._server_is_up():
            status["restarted"] = False
            return status
        if self.controller is not None and self.controller.identity is None:
            status["warning"] = ("The server is running outside the manager — restart it "
                                 "to load the new certificate.")
            status["restarted"] = False
            return status
        if not self.stop_server().get("ok"):
            status["warning"] = "The server could not be stopped; restart it to load the certificate."
            status["restarted"] = False
            return status
        outcome = self.start_server()
        wait = self.wait_until_healthy() if outcome.get("ok") else outcome
        status["restarted"] = bool(outcome.get("ok"))
        status["healthy"] = bool(wait.get("healthy"))
        return status

    def tls_install_self_signed(self) -> dict[str, Any]:
        with self._action_lock:
            try:
                status = self.certificates().install_self_signed()
            except Exception as exc:
                self.log.error("Self-signed certificate failed: %s", exc)
                return {"ok": False, "message": str(exc)}
            self.log.info("Self-signed certificate installed at %s", status.get("cert_path"))
            status.update(ok=True, message="Self-signed certificate installed for this server.")
            return self._reload_https(status)

    def tls_issue(self, domain: str | None = None, email: str | None = None,
                  staging: bool | None = None) -> dict[str, Any]:
        with self._action_lock:
            values = {
                "tls_domain": str(domain if domain is not None
                                  else self.settings.get("tls_domain") or "").strip(),
                "tls_email": str(email if email is not None
                                 else self.settings.get("tls_email") or "").strip(),
                "tls_staging": bool(self.settings.get("tls_staging", False))
                if staging is None else bool(staging),
            }
            if not values["tls_domain"]:
                # Auto-renewal must keep using the domain the certificate already
                # covers even if the preference field was emptied.
                values["tls_domain"] = str(self.certificates().status().get("domain") or "")
            self.settings = self.save_settings(values, sync_env=False)
            if not values["tls_domain"]:
                return {"ok": False, "message": "A domain name is required."}
            running = self._server_is_up()
            try:
                status = self.certificates().issue(
                    values["tls_domain"], values["tls_email"] or None,
                    staging=values["tls_staging"], server_running=running)
            except Exception as exc:
                self.log.error("Let's Encrypt issuance failed: %s", exc)
                return {"ok": False, "message": str(exc), "domain": values["tls_domain"],
                        "server_running": running}
            self.save_settings({"tls_last_check": time.time()}, sync_env=False)
            self.log.info("Let's Encrypt certificate installed for %s", values["tls_domain"])
            status.update(ok=True, domain=values["tls_domain"],
                          message=f"Certificate installed for {values['tls_domain']}.")
            if not running:
                status["warning"] = ("The server was stopped, so the challenge was answered "
                                     "locally. Start the server to use HTTPS.")
            return self._reload_https(status)

    def tls_renew(self) -> dict[str, Any]:
        return self.tls_issue()

    def tls_renew_if_needed(self) -> dict[str, Any]:
        """Auto-renew entry point; safe to call on a timer."""
        status = self.tls_status()
        if not self.settings.get("tls_autorenew", True):
            return {"ok": True, "renewed": False, "reason": "disabled", "status": status}
        if status.get("kind") != "letsencrypt":
            return {"ok": True, "renewed": False, "reason": "not-managed", "status": status}
        threshold = int(self.settings.get("tls_autorenew_days", 30) or 30)
        days_left = status.get("days_left")
        if days_left is None or int(days_left) > threshold:
            self.save_settings({"tls_last_check": time.time()}, sync_env=False)
            return {"ok": True, "renewed": False, "reason": "not-due",
                    "days_left": days_left, "status": status}
        result = self.tls_issue()
        result["renewed"] = bool(result.get("ok"))
        result["reason"] = "renewed" if result.get("ok") else "failed"
        return result

    def export_diagnostics(self, target: Path) -> Path:
        target.write_text(json.dumps(self.diagnostics(), ensure_ascii=False, indent=2),
                          encoding="utf-8")
        return target
