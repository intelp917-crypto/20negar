import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

class LogManager:
    def __init__(self, directory: Path, name: str = "manager"):
        self.directory, self.name = Path(directory), name
    def logger(self) -> logging.Logger:
        self.directory.mkdir(parents=True, exist_ok=True)
        log = logging.getLogger(self.name)
        if not log.handlers:
            handler = RotatingFileHandler(self.directory / f"{self.name}.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
            handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
            log.addHandler(handler); log.setLevel(logging.INFO)
        return log
