from pathlib import Path
import os
import subprocess

class StartupManager:
    def __init__(self, app_name: str, command: list[str], startup_dir: Path | None = None):
        self.app_name, self.command = app_name, command
        self.startup_dir = Path(startup_dir) if startup_dir else Path(os.environ.get("APPDATA", Path.home())) / "Microsoft/Windows/Start Menu/Programs/Startup"
    @property
    def shortcut_path(self) -> Path: return self.startup_dir / f"{self.app_name}.cmd"
    def enable(self, overwrite: bool = False) -> Path:
        self.startup_dir.mkdir(parents=True, exist_ok=True)
        if self.shortcut_path.exists() and not overwrite:
            return self.shortcut_path
        # A per-user .cmd is portable and does not require elevation.
        cwd = Path(self.command[0]).resolve().parent if Path(self.command[0]).is_absolute() else Path.cwd()
        content = "@echo off\ncd /d " + subprocess.list2cmdline([str(cwd)]) + "\n" + subprocess.list2cmdline([str(x) for x in self.command]) + "\n"
        temp = self.shortcut_path.with_suffix(".tmp")
        temp.write_text(content, encoding="utf-8")
        os.replace(temp, self.shortcut_path)
        return self.shortcut_path
    def disable(self) -> None: self.shortcut_path.unlink(missing_ok=True)
    def enabled(self) -> bool: return self.shortcut_path.exists()

    def ensure(self) -> Path:
        """Create the app-owned entry only when it does not already exist."""
        return self.enable(overwrite=False)
