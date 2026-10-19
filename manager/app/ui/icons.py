"""Application icon: the bundled artwork, with a painted fallback."""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QIcon, QLinearGradient, QPainter, QPainterPath, QPixmap


def _asset(name: str = "icon-512.png") -> Path | None:
    """The icon ships as a PyInstaller data file; source checkouts read scripts/."""
    if getattr(sys, "frozen", False):
        bases = [Path(getattr(sys, "_MEIPASS", ""))]
    else:
        bases = [Path(__file__).resolve().parents[2]]
    for base in bases:
        for candidate in (base / "assets" / name, base / "scripts" / name):
            if candidate.is_file():
                return candidate
    return None


def _pixmap(size: int) -> QPixmap:
    ratio = max(1.0, size / 16.0)
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing, True)
    inset = 1.0 * ratio
    body = QRectF(inset, inset, size - inset * 2, size - inset * 2)
    gradient = QLinearGradient(body.topLeft(), body.bottomRight())
    gradient.setColorAt(0.0, QColor("#7AAEFF"))
    gradient.setColorAt(1.0, QColor("#2F6BFF"))
    painter.setPen(Qt.NoPen)
    painter.setBrush(gradient)
    painter.drawRoundedRect(body, size * 0.27, size * 0.27)

    play = QPainterPath()
    play.moveTo(size * 0.40, size * 0.29)
    play.lineTo(size * 0.40, size * 0.71)
    play.lineTo(size * 0.73, size * 0.50)
    play.closeSubpath()
    painter.setBrush(QColor("#FFFFFF"))
    painter.drawPath(play)
    painter.end()
    return pixmap


def brand_pixmap(size: int = 34) -> QPixmap:
    source = _asset()
    if source is not None:
        pixmap = QPixmap(str(source))
        if not pixmap.isNull():
            return pixmap.scaled(size, size, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    return _pixmap(size)


def app_icon() -> QIcon:
    source = _asset()
    if source is not None:
        pixmap = QPixmap(str(source))
        if not pixmap.isNull():
            icon = QIcon()
            for size in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256):
                icon.addPixmap(pixmap.scaled(size, size, Qt.KeepAspectRatio,
                                             Qt.SmoothTransformation))
            return icon
    icon = QIcon()
    for size in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256):
        icon.addPixmap(_pixmap(size))
    return icon
