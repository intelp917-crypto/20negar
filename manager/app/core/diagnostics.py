from pathlib import Path
import json
import os
import platform
import shutil
import subprocess
import sys
from typing import Any


class Diagnostics:
    def collect(self, paths=None, settings: dict[str, Any] | None = None, health: dict[str, Any] | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {
            "platform": platform.platform(), "windows": platform.version(),
            "architecture": platform.machine(), "python": sys.version,
            "executable": sys.executable, "settings": {k: v for k, v in (settings or {}).items() if "secret" not in k.lower() and "token" not in k.lower()},
            "health": health or {},
        }
        if paths:
            result["paths"] = {key: str(value) for key, value in vars(paths).items()}
            result["access"] = {key: Path(value).exists() for key, value in vars(paths).items() if isinstance(value, Path)}
            usage = shutil.disk_usage(paths.repo_root)
            result["disk"] = {"free": usage.free, "total": usage.total}
        commands = {}
        for name in ("node", "npm", "git"):
            exe = shutil.which(name) or shutil.which(name + ".cmd")
            commands[name] = {"available": bool(exe), "path": exe}
            if exe:
                try:
                    commands[name]["version"] = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=5, check=False).stdout.strip()
                except (OSError, subprocess.SubprocessError): pass
        result["dependencies"] = commands
        return result
