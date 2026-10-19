import json
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest

from app.config.defaults import default_paths
from app.core.bridge import CoreBridge


def make_bridge(tmp_path: Path) -> tuple[CoreBridge, Path]:
    repo = tmp_path / "repo"
    (repo / "manager").mkdir(parents=True)
    (repo / "package.json").write_text("{}", encoding="utf-8")
    paths = replace(default_paths(repo), config_dir=tmp_path / "config")
    return CoreBridge(paths), repo


def write_clip(bridge: CoreBridge, name: str = "clip.mp4") -> Path:
    folder = bridge.paths.storage_dir / "videos"
    folder.mkdir(parents=True, exist_ok=True)
    clip = folder / name
    clip.write_bytes(b"original-video")
    return clip


def test_videos_switch_migrates_and_writes_env(tmp_path):
    bridge, repo = make_bridge(tmp_path)
    clip = write_clip(bridge)
    target = tmp_path / "D drive" / "20negar-videos"

    result = bridge.migrate_videos_path(str(target))

    assert result["ok"] and result["changed"] and result["migrated"]
    assert result["copied_files"] == 1
    assert (target / "clip.mp4").read_bytes() == b"original-video"
    assert clip.exists()  # the previous folder is kept
    assert bridge.videos_dir == target.resolve()
    assert bridge.settings["videos_dir"] == str(target.resolve())
    assert bridge.videos_size(0) == len(b"original-video")

    env = (repo / ".env").read_text(encoding="utf-8")
    assert f"NEGAR_VIDEOS_DIR={target.resolve()}" in env
    assert bridge.server_env()["NEGAR_VIDEOS_DIR"] == str(target.resolve())
    settings = json.loads(bridge.store.path.read_text(encoding="utf-8"))
    assert settings["videos_dir"] == str(target.resolve())


def test_videos_folder_must_be_outside_the_storage_root(tmp_path):
    bridge, _repo = make_bridge(tmp_path)

    with pytest.raises(ValueError):
        bridge.apply_videos_path(str(bridge.paths.storage_dir / "elsewhere"))
    with pytest.raises(ValueError):
        bridge.apply_videos_path(str(bridge.paths.storage_dir))
    with pytest.raises(ValueError):
        bridge.apply_videos_path(str(tmp_path))


def test_storage_move_is_blocked_when_it_would_swallow_videos(tmp_path):
    bridge, _repo = make_bridge(tmp_path)
    target = tmp_path / "media" / "videos"
    bridge.apply_videos_path(str(target))

    with pytest.raises(ValueError):
        bridge.apply_storage_path(str(tmp_path / "media"))


def test_videos_reset_returns_to_storage_default(tmp_path):
    bridge, repo = make_bridge(tmp_path)
    write_clip(bridge)
    target = tmp_path / "external" / "videos"
    bridge.apply_videos_path(str(target), migrate=True)

    result = bridge.reset_videos_path()

    assert result["ok"] and result["changed"]
    assert bridge.settings["videos_dir"] == ""
    assert bridge.videos_dir == (bridge.paths.storage_dir / "videos").resolve()
    env = (repo / ".env").read_text(encoding="utf-8")
    assert "NEGAR_VIDEOS_DIR=" not in env
    assert "NEGAR_VIDEOS_DIR" not in bridge.server_env()


def test_runtime_config_reads_the_videos_root_line(tmp_path):
    bridge, _repo = make_bridge(tmp_path)
    bridge.output = [
        "[server] [Config] Data directory: C:\\data",
        "[server] [Config] Storage root: C:\\data\\storage",
        "[server] [Config] Videos root: D:\\media\\videos",
        "[server] [Config] Database file: C:\\data\\cineflow.sqlite",
    ]

    runtime = bridge.runtime_config()

    assert runtime["videos"] == "D:\\media\\videos"
    assert runtime["storage"] == "C:\\data\\storage"


def test_backup_includes_relocated_videos(tmp_path):
    bridge, _repo = make_bridge(tmp_path)
    write_clip(bridge)
    target = tmp_path / "external" / "videos"
    bridge.apply_videos_path(str(target), migrate=True)

    archive = Path(bridge.create_backup(include_media=True)["path"])

    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
    assert "videos/clip.mp4" in names
    # The retained old folder must not be archived a second time.
    assert "storage/videos/clip.mp4" not in names
