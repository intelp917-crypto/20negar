"""Application-facing facade used by the Qt layer.

The facade owns no UI state and is deliberately easy to exercise from tests.
It manages the actual repository server instead of returning demo metrics.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

from ..config.defaults import AppPaths, default_paths
from ..config.settings import DEFAULT_SETTINGS, settings_store, validate_settings
from .backup_manager import BackupManager
from .database_manager import DatabaseManager
from .diagnostics import Diagnostics
from .log_manager import LogManager
from .server_controller import ServerController
from .startup_manager import StartupManager
from .update_manager import UpdateManager


class CoreBridge:
    def __init__(self, paths: AppPaths | None = None) -> None:
        self.paths = paths or default_paths()
        self.store = settings_store(self.paths)
        self.settings = validate_settings(self.store.load())
        if self.settings.get("storage_dir"): self.paths = replace(self.paths, storage_dir=Path(self.settings["storage_dir"]))
        if self.settings.get("database"): self.paths = replace(self.paths, database=Path(self.settings["database"]))
        self.controller: ServerController | None = None
        self.log = LogManager(self.paths.logs_dir).logger()
        self.output: list[str] = []
        self.output_lock = threading.Lock()

    def save_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        self.settings = validate_settings({**self.settings, **values})
        self.store.save(self.settings)
        return self.settings

    def _controller(self) -> ServerController:
        if self.controller is None:
            url = self.settings["health_url"]
            command = ServerController.command_for_repo(self.paths.repo_root, self.settings["mode"])
            env = os.environ.copy()
            # The server reads these overrides before creating its data folders.
            env["PORT"] = str(self.settings["port"])
            env["NODE_ENV"] = self.settings["mode"]
            if self.settings.get("storage_dir"): env["NEGAR_STORAGE_DIR"] = str(self.settings["storage_dir"])
            if self.settings.get("database"): env["NEGAR_DB_FILE_PATH"] = str(self.settings["database"])
            self.controller = ServerController(command, self.paths.repo_root, url, env=env)
        return self.controller

    def _drain(self, stream: Any, label: str) -> None:
        for line in iter(stream.readline, ""):
            text = f"[{label}] {line.rstrip()}"
            with self.output_lock:
                self.output.append(text)
                del self.output[:-500]
            self.log.info(text)
        stream.close()

    def _drain_line(self, line: str, label: str) -> None:
        text = f"[{label}] {line.rstrip()}"
        with self.output_lock:
            self.output.append(text)
            del self.output[:-500]
        self.log.info(text)

    def service_action(self, action: str) -> dict[str, Any]:
        try:
            controller = self._controller()
            if action in {"start", "restart"}:
                if action == "restart" and controller.is_running():
                    controller.stop(float(self.settings["startup_timeout"]))
                identity = controller.start()
                # Controller's ProcessManager owns stdout/stderr; attach readers once.
                process = getattr(controller.process_manager, "_last_process", None)
                if process:
                    controller.process_manager.start_output_reader(lambda line: self._drain_line(line, "server"))
                self.log.info("Server %s: pid=%s", action, identity.pid)
                return {"ok": True, "status": "starting", "pid": identity.pid}
            if action == "stop":
                ok = controller.stop(float(self.settings["startup_timeout"]))
                self.log.info("Server stop: %s", ok)
                return {"ok": ok, "status": "stopped" if ok else "failed"}
            return {"ok": False, "message": f"Unknown action: {action}"}
        except Exception as exc:
            self.log.exception("Server action failed")
            return {"ok": False, "message": str(exc)}

    def health(self) -> dict[str, Any]:
        try:
            result = self._controller().status()
            result["repo"] = str(self.paths.repo_root)
            return result
        except Exception as exc:
            return {"ok": False, "status": "error", "error": str(exc), "repo": str(self.paths.repo_root)}

    def metrics(self) -> dict[str, Any]:
        data = self.health()
        usage = shutil.disk_usage(self.paths.repo_root)
        data["disk_free"] = usage.free
        data["disk_total"] = usage.total
        return data

    def recent_logs(self, limit: int = 500) -> list[str]:
        with self.output_lock:
            return self.output[-limit:]

    def create_backup(self, include_media: bool = False, destination: Path | None = None) -> dict[str, Any]:
        sources = [self.paths.database]
        if include_media: sources.append(self.paths.storage_dir)
        target = destination or (self.paths.backups_dir / f"20negar-backup-{time.strftime('%Y%m%d-%H%M%S')}.zip")
        path = BackupManager(self.paths.backups_dir).create(sources, target)
        self.log.info("Backup created: %s", path)
        return {"ok": True, "path": str(path), "size": path.stat().st_size}

    def restore_backup(self, archive: Path) -> dict[str, Any]:
        if not archive.exists(): return {"ok": False, "message": "Backup does not exist"}
        snapshot = self.create_backup(destination=self.paths.backups_dir / f"pre-restore-{time.strftime('%Y%m%d-%H%M%S')}.zip")
        BackupManager(self.paths.backups_dir).restore(archive, self.paths.repo_root)
        return {"ok": True, "recovery_snapshot": snapshot["path"]}

    def validate_database(self) -> dict[str, Any]:
        db = DatabaseManager(self.paths.database)
        return {"ok": db.validate(), "path": str(self.paths.database), "size": self.paths.database.stat().st_size if self.paths.database.exists() else 0}

    def storage_info(self) -> dict[str, Any]:
        root = self.paths.storage_dir
        size = sum(p.stat().st_size for p in root.rglob("*") if p.is_file()) if root.exists() else 0
        usage = shutil.disk_usage(root if root.exists() else root.parent)
        return {"path": str(root), "exists": root.exists(), "size": size, "free": usage.free, "total": usage.total}

    def set_storage_path(self, value: str) -> dict[str, Any]:
        target = Path(value).expanduser().resolve()
        if target == self.paths.database.resolve():
            raise ValueError("storage and database must be independent paths")
        target.mkdir(parents=True, exist_ok=True)
        if not os.access(target, os.W_OK): raise PermissionError(f"Storage is not writable: {target}")
        old = self.settings.get("storage_dir")
        self._write_server_env({"NEGAR_STORAGE_DIR": str(target)})
        try:
            self.settings = self.save_settings({"storage_dir": str(target)})
        except Exception:
            if old: self._write_server_env({"NEGAR_STORAGE_DIR": str(old)})
            raise
        self.paths = replace(self.paths, storage_dir=target)
        if self.controller is not None: self.controller.env["NEGAR_STORAGE_DIR"] = str(target)
        return {"ok": True, "path": str(target), "restart_required": True}

    def migrate_storage_path(self, value: str) -> dict[str, Any]:
        """Copy media to a new root, verify every byte, then switch config.

        The old root is intentionally retained until the administrator removes it.
        Relative storage layout is preserved and the operation is restart-safe.
        """
        target = Path(value).expanduser().resolve()
        source = self.paths.storage_dir.resolve()
        if target == source: return {"ok": True, "path": str(source), "migrated": False, "message": "Already using this location"}
        if target == self.paths.database.resolve(): raise ValueError("storage and database must be independent paths")
        target.mkdir(parents=True, exist_ok=True)
        files = [p for p in source.rglob("*") if p.is_file()] if source.exists() else []
        copied = 0
        import hashlib
        for source_file in files:
            relative = source_file.relative_to(source)
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, destination)
            if source_file.stat().st_size != destination.stat().st_size:
                raise IOError(f"copy verification failed: {relative}")
            def digest(path: Path) -> str:
                h = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""): h.update(chunk)
                return h.hexdigest()
            if digest(source_file) != digest(destination):
                raise IOError(f"checksum verification failed: {relative}")
            copied += 1
        result = self.set_storage_path(str(target))
        return {**result, "migrated": True, "copied_files": copied, "source_retained": str(source)}

    def set_database_path(self, value: str) -> dict[str, Any]:
        target = Path(value).expanduser().resolve()
        if target == self.paths.storage_dir.resolve():
            raise ValueError("database and storage must be independent paths")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not target.is_file(): raise ValueError(f"Database path is not a file: {target}")
        if not os.access(target.parent, os.W_OK): raise PermissionError(f"Database directory is not writable: {target.parent}")
        old = self.paths.database
        if old.exists() and target != old:
            BackupManager(self.paths.backups_dir).create([old])
            shutil.copy2(old, target)
            if target.stat().st_size != old.stat().st_size:
                target.unlink(missing_ok=True); raise IOError("database copy verification failed")
        self._write_server_env({"NEGAR_DB_FILE_PATH": str(target)})
        try:
            self.settings = self.save_settings({"database": str(target)})
        except Exception:
            if target != old: target.unlink(missing_ok=True)
            self._write_server_env({"NEGAR_DB_FILE_PATH": str(old)})
            raise
        self.paths = replace(self.paths, database=target)
        if self.controller is not None: self.controller.env["NEGAR_DB_FILE_PATH"] = str(target)
        return {"ok": True, "path": str(target), "restart_required": True, "backup_created": True}

    def _write_server_env(self, updates: dict[str, str]) -> None:
        env_path = self.paths.repo_root / ".env"
        lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
        for key, value in updates.items():
            found = False
            for index, line in enumerate(lines):
                if line.startswith(key + "="):
                    lines[index] = f'{key}="{value.replace(chr(34), chr(92)+chr(34))}"'; found = True; break
            if not found: lines.append(f'{key}="{value}"')
        temp = env_path.with_name(env_path.name + ".tmp")
        with temp.open("w", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, env_path)

    def startup_status(self) -> dict[str, Any]:
        startup_dir = StartupManager("20Negar-Manager", []).startup_dir
        manager = StartupManager("20Negar-Manager", [], startup_dir)
        server = StartupManager("20Negar-Server", [], startup_dir)
        return {"manager": manager.enabled(), "server": server.enabled(), "directory": str(startup_dir), "manager_path": str(manager.shortcut_path), "server_path": str(server.shortcut_path)}

    def startup(self, manager_enabled: bool, server_enabled: bool) -> dict[str, Any]:
        startup_dir = StartupManager("20Negar-Manager", []).startup_dir
        manager_command = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, str(self.paths.repo_root / "manager" / "main.py")]
        server_command = ServerController.command_for_repo(self.paths.repo_root, self.settings["mode"])
        manager = StartupManager("20Negar-Manager", manager_command, startup_dir)
        server = StartupManager("20Negar-Server", server_command, startup_dir)
        manager_path = manager.ensure() if manager_enabled else manager.disable() or manager.shortcut_path
        server_path = server.ensure() if server_enabled else server.disable() or server.shortcut_path
        self.save_settings({"start_gui_on_login": manager_enabled, "startup_server_enabled": server_enabled, "startup_enabled": server_enabled})
        return {"ok": True, "manager_enabled": manager_enabled, "server_enabled": server_enabled, "manager_path": str(manager_path), "server_path": str(server_path), "directory": str(startup_dir)}

    def diagnostics(self) -> dict[str, Any]:
        return Diagnostics().collect(self.paths, self.settings, self.health())

    def update_status(self) -> dict[str, Any]:
        return UpdateManager().repository_status(self.paths.repo_root)

    def export_diagnostics(self, target: Path) -> Path:
        target.write_text(json.dumps(self.diagnostics(), ensure_ascii=False, indent=2), encoding="utf-8")
        return target
