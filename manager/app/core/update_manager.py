from pathlib import Path
import hashlib
import shutil
import subprocess

class UpdateManager:
    def repository_status(self, repo: Path) -> dict:
        def run(args):
            return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, timeout=10, check=False).stdout.strip()
        try:
            return {"branch": run(["branch", "--show-current"]), "commit": run(["rev-parse", "HEAD"]), "working_tree": bool(run(["status", "--porcelain"]))}
        except (OSError, subprocess.SubprocessError) as exc:
            return {"error": str(exc)}
    def verify_sha256(self, path: Path, expected: str) -> bool:
        digest = hashlib.sha256()
        with Path(path).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""): digest.update(chunk)
        return digest.hexdigest().lower() == expected.lower()
    def stage(self, source: Path, destination: Path) -> Path:
        destination = Path(destination); destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination); return destination
