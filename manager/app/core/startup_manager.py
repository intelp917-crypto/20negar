from pathlib import Path
import os
import subprocess

class StartupManager:
    def __init__(self, app_name: str, command: list[str], startup_dir: Path | None = None):
        self.app_name, self.command = app_name, command
        self.startup_dir = Path(startup_dir) if startup_dir else Path(os.environ.get("APPDATA", Path.home())) / "Microsoft/Windows/Start Menu/Programs/Startup"
    @property
    def shortcut_path(self) -> Path: return self.startup_dir / f"{self.app_name}.cmd"
    def enable(self) -> Path:
        self.startup_dir.mkdir(parents=True, exist_ok=True)
        # A per-user .cmd is portable and does not require elevation.
        self.shortcut_path.write_text("@echo off\ncd /d " + subprocess.list2cmdline([str(Path(self.command[-1]).parent.parent)]) + "\n" + subprocess.list2cmdline([str(x) for x in self.command]) + "\n", encoding="utf-8")
        return self.shortcut_path
    def disable(self) -> None: self.shortcut_path.unlink(missing_ok=True)
    def enabled(self) -> bool: return self.shortcut_path.exists()
