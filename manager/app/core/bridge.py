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
                    for stream, label in ((process.stdout, "stdout"), (process.stderr, "stderr")):
                        threading.Thread(target=self._drain, args=(stream, label), daemon=True).start()
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
        target.mkdir(parents=True, exist_ok=True)
        if not os.access(target, os.W_OK): raise PermissionError(f"Storage is not writable: {target}")
        self.settings = self.save_settings({"storage_dir": str(target)})
        self._write_server_env({"NEGAR_STORAGE_DIR": str(target)})
        if self.controller is not None: self.controller.env["NEGAR_STORAGE_DIR"] = str(target)
        return {"ok": True, "path": str(target), "restart_required": True}

    def set_database_path(self, value: str) -> dict[str, Any]:
        target = Path(value).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not target.is_file(): raise ValueError(f"Database path is not a file: {target}")
        if not os.access(target.parent, os.W_OK): raise PermissionError(f"Database directory is not writable: {target.parent}")
        if self.paths.database.exists() and target != self.paths.database:
            BackupManager(self.paths.backups_dir).create([self.paths.database])
            shutil.copy2(self.paths.database, target)
        self.settings = self.save_settings({"database": str(target)})
        self._write_server_env({"NEGAR_DB_FILE_PATH": str(target)})
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
        temp = env_path.with_suffix(".tmp")
        temp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.replace(temp, env_path)

    def startup(self, enabled: bool) -> dict[str, Any]:
        command = [os.environ.get("PYTHON", "python"), str(self.paths.repo_root / "manager" / "main.py")]
        manager = StartupManager("20Negar-Manager", command)
        if enabled: path = manager.enable()
        else: manager.disable(); path = manager.shortcut_path
        self.save_settings({"startup_enabled": enabled})
        return {"ok": True, "enabled": enabled, "path": str(path)}

    def diagnostics(self) -> dict[str, Any]:
        return Diagnostics().collect(self.paths, self.settings, self.health())

    def update_status(self) -> dict[str, Any]:
        return UpdateManager().repository_status(self.paths.repo_root)

    def export_diagnostics(self, target: Path) -> Path:
        target.write_text(json.dumps(self.diagnostics(), ensure_ascii=False, indent=2), encoding="utf-8")
        return target
