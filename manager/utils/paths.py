from pathlib import Path
import os, tempfile

def is_within(root: Path, path: Path) -> bool:
    root, path = Path(root).resolve(), Path(path).resolve()
    return root == path or root in path.parents

def atomic_write(path: Path, content: str) -> None:
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream: stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)
