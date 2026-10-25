"""Download and cache the official lego Windows binary when needed.

The manager must work without Docker, Go, or a preinstalled ACME client. The
binary is downloaded only when the user requests a certificate and the release
archive is verified against lego's published SHA-256 checksums.
"""
from __future__ import annotations

import hashlib
import os
import platform
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


LEGO_VERSION = "v5.5.2"
LEGO_RELEASE_BASE = f"https://github.com/go-acme/lego/releases/download/{LEGO_VERSION}"


class LegoError(RuntimeError):
    """A user-facing lego bootstrap or execution error."""


def _asset_arch() -> str:
    machine = platform.machine().lower()
    if machine in {"amd64", "x86_64", "x64"}:
        return "amd64"
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    if machine in {"x86", "i386", "i686"}:
        return "386"
    raise LegoError(f"Unsupported Windows architecture for lego: {platform.machine()}")


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "20negar-manager/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as stream:
            shutil.copyfileobj(response, stream)
    except Exception as exc:  # pragma: no cover - network failures vary by machine
        raise LegoError(f"Could not download lego from {url}: {exc}") from exc


def _published_checksum(asset_name: str, directory: Path) -> str:
    checksum_file = directory / "checksums.txt"
    _download(f"{LEGO_RELEASE_BASE}/lego_5.5.2_checksums.txt", checksum_file)
    for line in checksum_file.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and Path(parts[-1]).name == asset_name:
            return parts[0].lower()
    raise LegoError(f"The lego release checksum did not list {asset_name}.")


def _find_in_path() -> Path | None:
    configured = os.environ.get("LEGO_BINARY", "").strip()
    if configured and Path(configured).is_file():
        return Path(configured).resolve()
    found = shutil.which("lego.exe") or shutil.which("lego")
    return Path(found).resolve() if found else None


def ensure_lego_binary(cache_dir: Path) -> Path:
    """Return a verified lego executable, downloading it if necessary."""
    existing = _find_in_path()
    if existing:
        return existing

    cache_dir = Path(cache_dir).expanduser().resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / "lego.exe"
    if target.exists():
        return target

    asset_name = f"lego_{LEGO_VERSION}_windows_{_asset_arch()}.zip"
    with tempfile.TemporaryDirectory(prefix="20negar-lego-") as directory_name:
        directory = Path(directory_name)
        expected = _published_checksum(asset_name, directory)
        archive = directory / asset_name
        _download(f"{LEGO_RELEASE_BASE}/{asset_name}", archive)
        actual = hashlib.sha256(archive.read_bytes()).hexdigest().lower()
        if actual != expected:
            raise LegoError("The downloaded lego archive failed SHA-256 verification.")

        with zipfile.ZipFile(archive) as zipped:
            executable = next(
                (name for name in zipped.namelist()
                 if Path(name).name.lower() == "lego.exe"),
                None,
            )
            if not executable:
                raise LegoError("The lego archive did not contain lego.exe.")
            temporary = target.with_suffix(".download")
            with zipped.open(executable) as source, temporary.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            os.replace(temporary, target)
    return target
