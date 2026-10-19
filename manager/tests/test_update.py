import subprocess
from pathlib import Path

import pytest

from app.core.update_manager import UpdateError, UpdateManager


def git(cwd: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", check=False)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def commit(cwd: Path, message: str) -> str:
    git(cwd, "add", "-A")
    git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com",
        "commit", "-m", message)
    return git(cwd, "rev-parse", "HEAD")


def make_remote(tmp_path: Path) -> tuple[Path, Path]:
    """A bare 'GitHub' plus a seed clone that publishes commits to it."""
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "--bare", "-b", "main", str(remote))
    seed = tmp_path / "seed"
    git(tmp_path, "init", "-b", "main", str(seed))
    (seed / "README.md").write_text("first\n", encoding="utf-8")
    (seed / "package.json").write_text('{"name": "demo"}\n', encoding="utf-8")
    commit(seed, "first")
    git(seed, "remote", "add", "origin", str(remote))
    git(seed, "push", "-u", "origin", "main")
    return remote, seed


def clone(remote: Path, target: Path) -> Path:
    git(target.parent, "clone", str(remote), str(target))
    git(target, "-c", "user.name=Test", "-c", "user.email=test@example.com",
        "config", "user.name", "Test")
    git(target, "config", "user.email", "test@example.com")
    return target


def publish(seed: Path, name: str, content: str, message: str) -> str:
    (seed / name).write_text(content, encoding="utf-8")
    sha = commit(seed, message)
    git(seed, "push", "origin", "main")
    return sha


def test_check_reports_new_commit_and_apply_fast_forwards(tmp_path):
    remote, seed = make_remote(tmp_path)
    work = clone(remote, tmp_path / "work")
    manager = UpdateManager(work, remote_url=str(remote))

    before = manager.check()
    assert before["ok"] and before["up_to_date"] and not before["can_apply"]

    new_sha = publish(seed, "feature.txt", "hello\n", "add feature")
    checked = manager.check()

    assert checked["ok"] and not checked["up_to_date"]
    assert checked["behind"] == 1 and checked["ahead"] == 0
    assert checked["remote_commit"] == new_sha
    assert checked["can_apply"] and "feature.txt" in checked["files_changed"]
    # A clean checkout is required, and this one is clean.
    assert checked["dirty"] is False

    result = manager.apply()

    assert result["changed"] and result["to_commit"] == new_sha
    assert (work / "feature.txt").read_text(encoding="utf-8") == "hello\n"
    assert not result["npm_installed"]  # package files did not change
    assert manager.check()["up_to_date"]


def test_dependency_change_is_flagged(tmp_path):
    remote, seed = make_remote(tmp_path)
    work = clone(remote, tmp_path / "work")
    publish(seed, "package-lock.json", '{"lockfileVersion": 3}\n', "lockfile")

    checked = UpdateManager(work, remote_url=str(remote)).check()

    assert checked["can_apply"] and checked["dependencies_changed"]


def test_dirty_working_tree_blocks_the_update(tmp_path):
    remote, seed = make_remote(tmp_path)
    work = clone(remote, tmp_path / "work")
    publish(seed, "feature.txt", "hello\n", "add feature")
    (work / "README.md").write_text("local edit\n", encoding="utf-8")

    manager = UpdateManager(work, remote_url=str(remote))
    checked = manager.check()

    assert checked["ok"] and checked["dirty"]
    assert checked["can_apply"] is False
    assert "uncommitted" in checked["message"].lower()

    with pytest.raises(UpdateError):
        manager.apply()
    # The local file is untouched and the new commit was not applied.
    assert (work / "README.md").read_text(encoding="utf-8") == "local edit\n"
    assert not (work / "feature.txt").exists()


def test_non_repository_is_reported(tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()

    checked = UpdateManager(plain, remote_url="https://example.invalid/repo.git").check()

    assert checked["ok"] is False
    assert "not a git checkout" in checked["message"].lower()
