"""Git-based updates for the installation the manager owns.

The manager is the only component allowed to update a running installation:
it stops the server, takes a database snapshot, fast-forwards the checkout and
only then starts the server again. The checkout is never rewritten, never
force-reset and never cleaned, so local commits and uncommitted work are safe.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

DEFAULT_REMOTE = "https://github.com/intelp917-crypto/20negar.git"
DEFAULT_BRANCH = "main"
DEPENDENCY_FILES = ("package.json", "package-lock.json", "npm-shrinkwrap.json")
MAX_DIRTY_LISTING = 6


class UpdateError(RuntimeError):
    """A safe, user-facing reason why the update did not run."""


def _tail(text: str, limit: int = 600) -> str:
    text = (text or "").strip()
    return text[-limit:] if len(text) > limit else text


def _normalise_remote(url: str) -> str:
    value = (url or "").strip().rstrip("/")
    if value.lower().endswith(".git"):
        value = value[:-4]
    return value.lower()


class UpdateManager:
    def __init__(self, repo: Path | None = None, remote_url: str | None = None,
                 branch: str | None = None) -> None:
        self.repo = Path(repo) if repo is not None else Path.cwd()
        self.remote_url = (remote_url or os.environ.get("NEGAR_UPDATE_REMOTE")
                           or DEFAULT_REMOTE).strip()
        self.branch = (branch or os.environ.get("NEGAR_UPDATE_BRANCH")
                       or DEFAULT_BRANCH).strip()
        self.git = shutil.which("git") or shutil.which("git.exe")
        self.npm = (shutil.which("npm.cmd") if os.name == "nt" else None) \
            or shutil.which("npm") or ("npm.cmd" if os.name == "nt" else "npm")

    # -- process helpers ---------------------------------------------------
    @property
    def _flags(self) -> int:
        return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

    @property
    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        # Never block the GUI thread on an interactive credential prompt.
        env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo",
                    "GCM_INTERACTIVE": "never", "NO_UPDATE_NOTIFIER": "1"})
        return env

    def _run(self, command: list[str], timeout: float) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(
                command, cwd=str(self.repo), capture_output=True, text=True,
                timeout=timeout, check=False, env=self._env, errors="replace",
                creationflags=self._flags)
        except subprocess.TimeoutExpired as exc:
            raise UpdateError(f"{Path(command[0]).name} timed out after {int(timeout)}s") from exc
        except OSError as exc:
            raise UpdateError(f"Could not run {Path(command[0]).name}: {exc}") from exc

    def _git(self, args: list[str], timeout: float = 120.0,
             check: bool = True) -> subprocess.CompletedProcess:
        if not self.git:
            raise UpdateError("Git is not installed or is not on PATH. Install Git and try again.")
        result = self._run([self.git, *args], timeout)
        if check and result.returncode != 0:
            message = _tail(result.stderr or result.stdout) or f"git {args[0]} failed"
            raise UpdateError(message)
        return result

    # -- inspection --------------------------------------------------------
    def _branch(self) -> str:
        result = self._git(["rev-parse", "--abbrev-ref", "HEAD"], check=False)
        name = result.stdout.strip() if result.returncode == 0 else ""
        if not name or name == "HEAD":
            raise UpdateError("The checkout is not on a branch (detached HEAD). "
                              "Switch to a branch before updating.")
        return name

    def _dirty_files(self) -> list[str]:
        """Tracked/untracked changes, ignoring the live data directory."""
        result = self._git(["status", "--porcelain", "--", ".", ":!data"], check=False)
        files: list[str] = []
        for line in (result.stdout or "").splitlines():
            path = line[3:].strip()
            if not path or path.startswith("data/"):
                continue
            # Renames are reported as "old -> new"; keep the visible new name.
            files.append(path.split(" -> ")[-1])
        return files

    def _has_origin(self) -> bool:
        result = self._git(["remote", "get-url", "origin"], check=False)
        return result.returncode == 0 and bool(result.stdout.strip())

    def _origin_matches(self) -> bool:
        if not self._has_origin():
            return False
        url = self._git(["remote", "get-url", "origin"], check=False).stdout.strip()
        return _normalise_remote(url) == _normalise_remote(self.remote_url)

    def _fetch(self, branch: str) -> None:
        # Use origin only when it is the official repository; otherwise fetch
        # straight from the configured URL so a stale/forked remote cannot
        # silently feed the update.
        target = "origin" if self._origin_matches() else self.remote_url
        self._git(["fetch", "--prune", "--no-tags", target, branch], timeout=300)

    def _remote_commit(self) -> str:
        result = self._git(["rev-parse", "--verify", "FETCH_HEAD"], check=False)
        sha = result.stdout.strip()
        if result.returncode != 0 or not sha:
            raise UpdateError("Could not read the remote branch after fetching.")
        return sha

    def _subject(self, ref: str) -> str:
        result = self._git(["log", "-1", "--format=%s", ref], check=False)
        return result.stdout.strip() if result.returncode == 0 else ""

    def _changed_files(self, old: str, new: str) -> list[str]:
        result = self._git(["diff", "--name-only", old, new, "--", ".", ":!data"], check=False)
        return [line for line in (result.stdout or "").splitlines() if line.strip()]

    @staticmethod
    def verify_sha256(path: Path, expected: str) -> bool:
        digest = hashlib.sha256()
        with Path(path).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest().lower() == str(expected).lower()

    def repository_status(self, repo: Path | None = None) -> dict[str, Any]:
        """Compact view kept for older callers (branch/commit/worktree)."""
        checked = self.check()
        return {"branch": checked.get("branch") or "",
                "commit": checked.get("commit") or "",
                "working_tree": bool(checked.get("dirty")),
                "error": checked.get("error")}

    # -- public API --------------------------------------------------------
    def check(self) -> dict[str, Any]:
        """Fetch quietly and describe whether a fast-forward update is possible."""
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        data: dict[str, Any] = {
            "ok": False, "git_available": bool(self.git),
            "is_repo": (self.repo / ".git").exists(),
            "repo": str(self.repo), "remote": self.remote_url,
            "branch": "", "commit": "", "commit_subject": "",
            "remote_commit": "", "remote_subject": "",
            "behind": 0, "ahead": 0, "up_to_date": None, "dirty": False,
            "dirty_files": [], "files_changed": [], "dependencies_changed": False,
            "can_apply": False, "checked_at": now, "message": "", "error": None,
        }
        try:
            if not self.git:
                raise UpdateError("Git is not installed or is not on PATH. "
                                  "Install Git to enable updates from GitHub.")
            if not data["is_repo"]:
                raise UpdateError("This installation is not a Git checkout, so it cannot "
                                  "be updated in place. Reinstall from the repository.")
            branch = self._branch()
            data["branch"] = branch
            local = self._git(["rev-parse", "--verify", "HEAD"], check=False).stdout.strip()
            if not local:
                raise UpdateError("The checkout has no commits yet; nothing can be updated.")
            data["commit"] = local
            data["commit_subject"] = self._subject("HEAD")
            dirty_files = self._dirty_files()
            data["dirty"] = bool(dirty_files)
            data["dirty_files"] = dirty_files[:MAX_DIRTY_LISTING]

            self._fetch(branch)
            remote = self._remote_commit()
            data["remote_commit"] = remote
            data["remote_subject"] = self._subject(remote)

            if local == remote:
                data.update(ok=True, up_to_date=True,
                            message="This installation is up to date with GitHub.")
                return data

            counts = self._git(["rev-list", "--left-right", "--count",
                                f"HEAD...{remote}"], check=False).stdout.split()
            if len(counts) == 2:
                data["ahead"], data["behind"] = int(counts[0] or 0), int(counts[1] or 0)
            changed = self._changed_files(local, remote)
            data["files_changed"] = changed
            data["dependencies_changed"] = any(path in DEPENDENCY_FILES for path in changed)
            data["ok"] = True
            data["up_to_date"] = data["behind"] == 0

            if data["behind"] == 0:
                data["message"] = (f"Local branch is ahead of GitHub by {data['ahead']} "
                                   f"commit{'s' if data['ahead'] != 1 else ''}; nothing to pull.")
            elif data["ahead"]:
                data["message"] = (f"The branch has diverged: {data['ahead']} local commit(s) "
                                   f"and {data['behind']} new commit(s) on GitHub. "
                                   "Fast-forward update is not possible.")
            elif data["dirty"]:
                data["message"] = (f"{data['behind']} new commit(s) available, but the working "
                                   "tree has uncommitted changes. Commit or stash them first.")
            else:
                data["can_apply"] = True
                data["message"] = (f"{data['behind']} new commit"
                                   f"{'s' if data['behind'] != 1 else ''} available on GitHub.")
                if data["dependencies_changed"]:
                    data["message"] += " Dependencies will be installed after the pull."
            return data
        except UpdateError as exc:
            data.update(error=str(exc), message=str(exc))
            return data
        except Exception as exc:  # pragma: no cover - defensive
            data.update(error=f"Update check failed: {exc}", message=f"Update check failed: {exc}")
            return data

    def apply(self) -> dict[str, Any]:
        """Fast-forward the checkout (and install dependencies when needed)."""
        if not self.git:
            raise UpdateError("Git is not installed or is not on PATH.")
        if not (self.repo / ".git").exists():
            raise UpdateError("This installation is not a Git checkout.")
        branch = self._branch()
        local = self._git(["rev-parse", "--verify", "HEAD"]).stdout.strip()

        dirty = self._dirty_files()
        if dirty:
            preview = ", ".join(dirty[:3])
            more = f" (+{len(dirty) - 3} more)" if len(dirty) > 3 else ""
            raise UpdateError("Uncommitted changes would be overwritten: "
                              f"{preview}{more}. Commit or stash them, then try again.")

        self._fetch(branch)
        remote = self._remote_commit()
        if remote == local:
            return {"changed": False, "from_commit": local, "to_commit": local,
                    "files_changed": [], "npm_installed": False,
                    "message": "Already up to date."}

        counts = self._git(["rev-list", "--left-right", "--count",
                            f"HEAD...{remote}"]).stdout.split()
        ahead = int(counts[0] or 0) if len(counts) == 2 else 0
        if ahead:
            raise UpdateError("The branch has local commits that are not on GitHub. "
                              "A fast-forward update would rewrite them, so nothing was changed.")

        changed = self._changed_files(local, remote)
        merge = self._git(["merge", "--ff-only", remote], timeout=300, check=False)
        if merge.returncode != 0:
            raise UpdateError("Fast-forward failed: "
                              + (_tail(merge.stderr or merge.stdout) or "unknown git error"))

        new_commit = self._git(["rev-parse", "HEAD"]).stdout.strip()
        result: dict[str, Any] = {
            "changed": new_commit != local, "from_commit": local, "to_commit": new_commit,
            "branch": branch, "files_changed": changed, "npm_installed": False,
            "message": "Code updated.",
        }
        needs_npm = any(path in DEPENDENCY_FILES for path in changed)
        if needs_npm and self.npm:
            npm = self._run([self.npm, "install", "--no-audit", "--no-fund",
                             "--loglevel=error"], timeout=900)
            if npm.returncode != 0:
                raise UpdateError("Code was updated, but npm install failed: "
                                  + (_tail(npm.stderr or npm.stdout) or "unknown npm error"))
            result["npm_installed"] = True
            result["message"] = "Code updated and dependencies installed."
        return result
