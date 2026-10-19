"""Reusable, custom-painted widgets that make up the manager design system."""
from __future__ import annotations

import time
from typing import Iterable

from PySide6.QtCore import QEasingCurve, QRectF, QSize, Qt, QTimer, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QFont, QFontMetrics, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (QAbstractButton, QFrame, QGraphicsOpacityEffect, QHBoxLayout,
    QLabel, QLineEdit, QMenu, QPlainTextEdit, QProgressBar, QPushButton, QSizePolicy,
    QVBoxLayout, QWidget)

from . import theme


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def label(text: str = "", role: str | None = None, *, wrap: bool = False) -> QLabel:
    widget = QLabel(text)
    if role:
        widget.setObjectName(role)
    widget.setWordWrap(wrap)
    return widget


def divider() -> QFrame:
    line = QFrame()
    line.setObjectName("Divider")
    line.setFrameShape(QFrame.NoFrame)
    line.setFixedHeight(1)
    return line


def repolish(widget: QWidget) -> None:
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    widget.update()


def button(text: str, variant: str = "default", *, compact: bool = False,
           tooltip: str | None = None) -> QPushButton:
    widget = QPushButton(text)
    widget.setProperty("variant", variant)
    if compact:
        widget.setProperty("compact", True)
    if tooltip:
        widget.setToolTip(tooltip)
    widget.setCursor(Qt.PointingHandCursor)
    return widget


def icon_button(glyph: str, tooltip: str) -> QPushButton:
    widget = QPushButton(glyph)
    widget.setObjectName("IconButton")
    widget.setProperty("variant", "ghost")
    widget.setCursor(Qt.PointingHandCursor)
    widget.setToolTip(tooltip)
    widget.setFixedSize(32, 32)
    return widget


def eyebrow(text: str) -> QLabel:
    widget = QLabel(text.upper())
    widget.setObjectName("Eyebrow")
    font = widget.font()
    font.setLetterSpacing(QFont.AbsoluteSpacing, 1.3)
    font.setPointSizeF(8.0)
    font.setWeight(QFont.DemiBold)
    widget.setFont(font)
    return widget


def _mix(color: str, alpha: float) -> QColor:
    value = QColor(color)
    value.setAlphaF(max(0.0, min(1.0, alpha)))
    return value


# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------
class NavItem(QWidget):
    clicked = Signal()

    def __init__(self, glyph: str, text: str, parent=None):
        super().__init__(parent)
        self._glyph, self._text = glyph, text
        self._active = False
        self._hover = 0.0
        self.setFixedHeight(40)
        self.setCursor(Qt.PointingHandCursor)
        self.setAttribute(Qt.WA_Hover, True)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self._animation = QVariantAnimation(self)
        self._animation.setDuration(130)
        self._animation.setEasingCurve(QEasingCurve.OutCubic)
        self._animation.valueChanged.connect(self._on_hover)

    def _on_hover(self, value) -> None:
        self._hover = float(value)
        self.update()

    def enterEvent(self, event) -> None:
        self._animate(1.0)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        self._animate(0.0)
        super().leaveEvent(event)

    def _animate(self, target: float) -> None:
        self._animation.stop()
        self._animation.setStartValue(self._hover)
        self._animation.setEndValue(target)
        self._animation.start()

    def set_active(self, active: bool) -> None:
        if self._active == active:
            return
        self._active = active
        self.update()

    def mouseReleaseEvent(self, event) -> None:
        if event.button() == Qt.LeftButton and self.rect().contains(event.position().toPoint()):
            self.clicked.emit()
        super().mouseReleaseEvent(event)

    def paintEvent(self, event) -> None:
        t = theme.current()
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        body = QRectF(self.rect()).adjusted(0.5, 1.5, -0.5, -1.5)

        if self._active:
            path = QPainterPath()
            path.addRoundedRect(body, 10, 10)
            painter.fillPath(path, QColor(t.surface_alt))
            painter.setPen(Qt.NoPen)
            painter.setBrush(QColor(t.accent))
            painter.drawRoundedRect(QRectF(body.left() + 1, body.center().y() - 9, 3, 18), 1.5, 1.5)
        elif self._hover > 0.01:
            path = QPainterPath()
            path.addRoundedRect(body, 10, 10)
            painter.fillPath(path, _mix(t.surface_alt, 0.55 * self._hover))

        glyph_font = QFont(self.font())
        glyph_font.setPointSizeF(10.5)
        glyph_font.setWeight(QFont.Medium)
        painter.setFont(glyph_font)
        painter.setPen(QColor(t.accent if self._active else t.muted))
        painter.drawText(QRectF(body.left() + 13, body.top(), 22, body.height()),
                         Qt.AlignCenter, self._glyph)

        text_font = QFont(self.font())
        text_font.setPointSizeF(9.75)
        text_font.setWeight(QFont.DemiBold if self._active else QFont.Normal)
        painter.setFont(text_font)
        painter.setPen(QColor(t.text if self._active else t.muted))
        painter.drawText(QRectF(body.left() + 41, body.top(), body.width() - 50, body.height()),
                         Qt.AlignVCenter | Qt.AlignLeft, self._text)
        painter.end()


class SectionLabel(QLabel):
    def __init__(self, text: str, parent=None):
        super().__init__(text.upper(), parent)
        self.setObjectName("SectionLabel")
        font = self.font()
        font.setPointSizeF(7.5)
        font.setWeight(QFont.DemiBold)
        font.setLetterSpacing(QFont.AbsoluteSpacing, 1.4)
        self.setFont(font)
        self.setContentsMargins(13, 0, 0, 0)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
PHASE_LABELS = {
    "running": "Running", "starting": "Starting", "stopping": "Stopping",
    "stopped": "Stopped", "unhealthy": "Unhealthy", "external": "Running (external)",
}
PHASE_TONES = {
    "running": "success", "starting": "warning", "stopping": "warning",
    "stopped": "muted", "unhealthy": "danger", "external": "accent",
}


def tone_color(tone: str) -> str:
    t = theme.current()
    return {"success": t.success, "warning": t.warning, "danger": t.danger,
            "accent": t.accent, "muted": t.faint}.get(tone, t.muted)


def tone_soft(tone: str) -> str:
    t = theme.current()
    return {"success": t.success_soft, "warning": t.warning_soft, "danger": t.danger_soft,
            "accent": t.accent_soft, "muted": t.surface_alt}.get(tone, t.surface_alt)


class StatusPill(QWidget):
    """Rounded status badge with a live dot; pulses while a phase is changing."""

    def __init__(self, phase: str = "stopped", parent=None):
        super().__init__(parent)
        self._phase = phase
        self._pulse = 0.0
        self._timer = QTimer(self)
        self._timer.setInterval(45)
        self._timer.timeout.connect(self._tick)
        self.setFixedHeight(30)
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)

    def _tick(self) -> None:
        self._pulse = (self._pulse + 0.06) % 1.0
        self.update()

    def set_phase(self, phase: str) -> None:
        self._phase = phase if phase in PHASE_LABELS else "stopped"
        if self._phase in {"starting", "stopping"}:
            if not self._timer.isActive():
                self._timer.start()
        else:
            self._timer.stop()
            self._pulse = 0.0
        self.updateGeometry()
        self.update()

    def phase(self) -> str:
        return self._phase

    def sizeHint(self) -> QSize:
        metrics = QFontMetrics(self.font())
        return QSize(metrics.horizontalAdvance(PHASE_LABELS[self._phase]) + 38, 30)

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        tone = PHASE_TONES[self._phase]
        color = QColor(tone_color(tone))
        body = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        painter.setPen(QPen(_mix(color.name(), 0.30), 1))
        painter.setBrush(QColor(tone_soft(tone)) if tone != "muted" else QColor(theme.current().surface_alt))
        painter.drawRoundedRect(body, body.height() / 2, body.height() / 2)

        center = body.center()
        dot_center = QRectF(body.left() + 12, center.y() - 3.5, 7, 7)
        if self._phase in {"starting", "stopping"}:
            ring = 7 + 9 * self._pulse
            ring_color = QColor(color)
            ring_color.setAlphaF(0.5 * (1 - self._pulse))
            painter.setPen(Qt.NoPen)
            painter.setBrush(ring_color)
            painter.drawEllipse(QRectF(dot_center.center().x() - ring / 2,
                                       dot_center.center().y() - ring / 2, ring, ring))
        painter.setPen(Qt.NoPen)
        painter.setBrush(color)
        painter.drawEllipse(dot_center)

        font = QFont(self.font())
        font.setPointSizeF(8.5)
        font.setWeight(QFont.DemiBold)
        painter.setFont(font)
        painter.setPen(QColor(tone_color(tone) if tone != "muted" else theme.current().muted))
        painter.drawText(QRectF(body.left() + 24, body.top(), body.width() - 32, body.height()),
                         Qt.AlignVCenter | Qt.AlignLeft, PHASE_LABELS[self._phase])
        painter.end()


class StateButton(QPushButton):
    """The single play/stop control. Its label always reflects the lifecycle phase."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setCursor(Qt.PointingHandCursor)
        self.setMinimumHeight(42)
        self.setMinimumWidth(158)
        font = self.font()
        font.setWeight(QFont.DemiBold)
        self.setFont(font)
        self.action = "start"
        self.set_phase("stopped")

    def set_phase(self, phase: str) -> None:
        mapping = {
            "stopped": ("▶   Start server", "primary", True, "start"),
            "unhealthy": ("■   Stop server", "danger", True, "stop"),
            "running": ("■   Stop server", "danger", True, "stop"),
            "external": ("■   Stop server", "danger", True, "stop"),
            "starting": ("Starting…", "primary", False, "start"),
            "stopping": ("Stopping…", "danger", False, "stop"),
        }
        text, variant, enabled, action = mapping.get(phase, mapping["stopped"])
        self.action = action
        self.setText(text)
        self.setEnabled(enabled)
        self.setProperty("variant", variant)
        repolish(self)


class Chip(QLabel):
    def __init__(self, text: str = "", tone: str = "muted", parent=None):
        super().__init__(text, parent)
        self._tone = tone
        self.setAlignment(Qt.AlignCenter)
        self.refresh()

    def set_tone(self, tone: str) -> None:
        self._tone = tone
        self.refresh()

    def set_state(self, text: str, tone: str) -> None:
        self.setText(text)
        self._tone = tone
        self.refresh()

    def refresh(self) -> None:
        color = tone_color(self._tone)
        soft = tone_soft(self._tone)
        self.setStyleSheet(
            f"background: {soft}; color: {color}; border-radius: 8px;"
            f"padding: 3px 9px; font-size: 11px; font-weight: 600;")


# ---------------------------------------------------------------------------
# Cards and layout primitives
# ---------------------------------------------------------------------------
class Card(QFrame):
    def __init__(self, title: str | None = None, subtitle: str | None = None, parent=None):
        super().__init__(parent)
        self.setObjectName("Card")
        self.body = QVBoxLayout(self)
        self.body.setContentsMargins(20, 18, 20, 18)
        self.body.setSpacing(12)
        self._header_bar = QWidget()
        self._header_bar.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Fixed)
        self.header = QHBoxLayout(self._header_bar)
        self.header.setContentsMargins(0, 0, 0, 0)
        self.header.setSpacing(10)
        titles = QVBoxLayout()
        titles.setSpacing(2)
        if title:
            self.title_label = QLabel(title)
            self.title_label.setObjectName("CardTitle")
            titles.addWidget(self.title_label)
        else:
            self.title_label = None
        if subtitle:
            self.subtitle_label = QLabel(subtitle)
            self.subtitle_label.setObjectName("CardSubtitle")
            self.subtitle_label.setWordWrap(True)
            titles.addWidget(self.subtitle_label)
        else:
            self.subtitle_label = None
        if title or subtitle:
            self.header.addLayout(titles, 1)
        self.actions = QHBoxLayout()
        self.actions.setSpacing(8)
        self.header.addLayout(self.actions)
        if title or subtitle:
            self.body.addWidget(self._header_bar)

    def add(self, widget: QWidget, stretch: int = 0) -> QWidget:
        self.body.addWidget(widget, stretch)
        return widget

    def add_layout(self, layout, stretch: int = 0):
        self.body.addLayout(layout, stretch)
        return layout

    def add_action(self, widget: QWidget) -> QWidget:
        self.actions.addWidget(widget)
        return widget


class StatCard(Card):
    def __init__(self, caption: str, value: str = "—", hint: str = "",
                 parent=None):
        super().__init__(parent)
        self.body.setContentsMargins(18, 16, 18, 16)
        self.body.setSpacing(6)
        self.caption = eyebrow(caption)
        self.value = QLabel(value)
        self.value.setObjectName("Value")
        self.hint = QLabel(hint)
        self.hint.setObjectName("CardSubtitle")
        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setValue(0)
        self.bar.setFixedHeight(6)
        self.bar.setTextVisible(False)
        self.bar.setVisible(False)
        self.body.addWidget(self.caption)
        self.body.addWidget(self.value)
        self.body.addWidget(self.hint)
        self.body.addWidget(self.bar)

    def set(self, value: str, hint: str | None = None) -> None:
        self.value.setText(value)
        if hint is not None:
            self.hint.setText(hint)

    def set_progress(self, percent: float | None, tone: str = "accent") -> None:
        if percent is None:
            self.bar.setVisible(False)
            return
        self.bar.setVisible(True)
        self.bar.setValue(max(0, min(100, int(percent))))
        self.bar.setProperty("tone", tone)
        repolish(self.bar)


class Meter(QWidget):
    """Caption + value + thin progress bar, used for live resource readings."""

    def __init__(self, caption: str, parent=None):
        super().__init__(parent)
        body = QVBoxLayout(self)
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(6)
        head = QHBoxLayout()
        head.setSpacing(8)
        self.caption = eyebrow(caption)
        self.hint = QLabel("")
        self.hint.setObjectName("CardSubtitle")
        head.addWidget(self.caption)
        head.addStretch(1)
        head.addWidget(self.hint)
        self.value = QLabel("—")
        self.value.setObjectName("ValueSmall")
        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setFixedHeight(6)
        self.bar.setTextVisible(False)
        body.addLayout(head)
        body.addWidget(self.value)
        body.addWidget(self.bar)

    def set(self, value: str, percent: float | None = None, hint: str = "",
            tone: str = "accent") -> None:
        self.value.setText(value)
        self.hint.setText(hint)
        self.bar.setVisible(percent is not None)
        if percent is not None:
            self.bar.setValue(max(0, min(100, int(percent))))
        self.bar.setProperty("tone", tone)
        repolish(self.bar)


class PageHeader(QWidget):
    def __init__(self, section: str, title: str, subtitle: str, parent=None):
        super().__init__(parent)
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(18)
        text = QVBoxLayout()
        text.setSpacing(4)
        self.section = eyebrow(section)
        self.title = QLabel(title)
        self.title.setObjectName("PageTitle")
        self.subtitle = QLabel(subtitle)
        self.subtitle.setObjectName("PageSubtitle")
        self.subtitle.setWordWrap(True)
        text.addWidget(self.section)
        text.addWidget(self.title)
        text.addWidget(self.subtitle)
        row.addLayout(text, 1)
        self.actions = QHBoxLayout()
        self.actions.setSpacing(8)
        self.actions.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        row.addLayout(self.actions)

    def add(self, widget: QWidget) -> QWidget:
        self.actions.addWidget(widget)
        return widget


class KeyValue(QWidget):
    def __init__(self, key: str, value: str = "—", parent=None):
        super().__init__(parent)
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(14)
        self.key = QLabel(key)
        self.key.setObjectName("Muted")
        self.value = QLabel(value)
        self.value.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.value.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.value.setWordWrap(True)
        row.addWidget(self.key)
        row.addStretch(1)
        row.addWidget(self.value, 2)

    def set(self, value: str) -> None:
        self.value.setText(value)


class EmptyState(QWidget):
    def __init__(self, glyph: str, title: str, text: str, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 26, 16, 26)
        layout.setSpacing(6)
        layout.setAlignment(Qt.AlignCenter)
        mark = QLabel(glyph)
        mark.setObjectName("EmptyGlyph")
        mark.setAlignment(Qt.AlignCenter)
        heading = QLabel(title)
        heading.setAlignment(Qt.AlignCenter)
        font = heading.font()
        font.setWeight(QFont.DemiBold)
        heading.setFont(font)
        detail = QLabel(text)
        detail.setObjectName("CardSubtitle")
        detail.setAlignment(Qt.AlignCenter)
        detail.setWordWrap(True)
        layout.addWidget(mark)
        layout.addWidget(heading)
        layout.addWidget(detail)


class PathField(QWidget):
    """Read-only monospace path with a one-click copy action."""

    def __init__(self, path: str = "", parent=None):
        super().__init__(parent)
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(8)
        self.edit = QLineEdit(path)
        self.edit.setObjectName("PathField")
        self.edit.setReadOnly(True)
        self.edit.setCursorPosition(0)
        self.copy = button("Copy", "ghost", compact=True)
        self.copy.setToolTip("Copy this path")
        row.addWidget(self.edit, 1)
        row.addWidget(self.copy)

    def set_path(self, path: str) -> None:
        self.edit.setText(path)
        self.edit.setCursorPosition(0)

    def text(self) -> str:
        return self.edit.text()


class Select(QPushButton):
    """A compact, fully themed dropdown with a visible indicator."""

    changed = Signal(str)

    def __init__(self, items: list[str], current: str | None = None, parent=None):
        super().__init__(parent)
        self._items = list(items)
        self._current = current if current in self._items else self._items[0]
        self.setObjectName("Select")
        self.setCursor(Qt.PointingHandCursor)
        self.setMinimumHeight(34)
        self.setText(self._current)
        menu = QMenu(self)
        for item in self._items:
            action = menu.addAction(item)
            action.triggered.connect(lambda _checked=False, value=item: self.set_current(value))
        self.setMenu(menu)

    def current(self) -> str:
        return self._current

    def index(self) -> int:
        return self._items.index(self._current)

    def set_current(self, value: str) -> None:
        if value not in self._items or value == self._current:
            return
        self._current = value
        self.setText(value)
        self.changed.emit(value)

    def set_items(self, items: list[str]) -> None:
        self._items = list(items)


class Switch(QAbstractButton):
    def __init__(self, text: str = "", parent=None):
        super().__init__(parent)
        self.setText(text)
        self.setCheckable(True)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedHeight(26)
        self._offset = 0.0
        self._animation = QVariantAnimation(self)
        self._animation.setDuration(140)
        self._animation.setEasingCurve(QEasingCurve.OutCubic)
        self._animation.valueChanged.connect(self._animate)
        self.toggled.connect(self._start)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

    def _animate(self, value) -> None:
        self._offset = float(value)
        self.update()

    def _start(self, checked: bool) -> None:
        self._animation.stop()
        self._animation.setStartValue(self._offset)
        self._animation.setEndValue(1.0 if checked else 0.0)
        self._animation.start()

    def sizeHint(self) -> QSize:
        metrics = QFontMetrics(self.font())
        return QSize(46 + 12 + metrics.horizontalAdvance(self.text()), 26)

    def paintEvent(self, event) -> None:
        t = theme.current()
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        track = QRectF(1, 2.5, 42, 21)
        painter.setPen(QPen(QColor(t.border_strong) if not self.isChecked() else QColor(t.accent), 1))
        painter.setBrush(QColor(t.accent) if self.isChecked() else QColor(t.surface_alt))
        painter.drawRoundedRect(track, 10.5, 10.5)
        knob_x = track.left() + 3 + self._offset * 20
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor("#FFFFFF") if self.isChecked() else QColor(t.muted))
        painter.drawEllipse(QRectF(knob_x, track.top() + 3, 15, 15))
        font = QFont(self.font())
        font.setPointSizeF(9.5)
        painter.setFont(font)
        painter.setPen(QColor(t.text if self.isEnabled() else t.faint))
        painter.drawText(QRectF(53, 0, self.width() - 53, self.height()),
                         Qt.AlignVCenter | Qt.AlignLeft, self.text())
        painter.end()


class Console(QPlainTextEdit):
    def __init__(self, placeholder: str = "", parent=None):
        super().__init__(parent)
        self.setObjectName("Console")
        self.setReadOnly(True)
        self.setPlaceholderText(placeholder)
        self.setMaximumBlockCount(2000)
        self.setLineWrapMode(QPlainTextEdit.NoWrap)
        self.setMinimumHeight(180)

    def set_lines(self, lines: Iterable[str]) -> None:
        self.setPlainText("\n".join(lines))


# ---------------------------------------------------------------------------
# Toasts
# ---------------------------------------------------------------------------
TOAST_GLYPHS = {"info": "◆", "success": "✓", "error": "!", "warning": "!"}


class Toast(QFrame):
    dismissed = Signal()

    def __init__(self, message: str, tone: str = "info", parent=None):
        super().__init__(parent)
        t = theme.current()
        accent = tone_color(tone)
        self.setStyleSheet(
            f"QFrame {{ background: {t.raised}; border: 1px solid {t.border_strong};"
            f" border-left: 3px solid {accent}; border-radius: 12px; }}"
            f" QLabel {{ background: transparent; border: none; }}")
        self.setFixedWidth(370)
        row = QHBoxLayout(self)
        row.setContentsMargins(13, 11, 13, 11)
        row.setSpacing(10)
        mark = QLabel(TOAST_GLYPHS.get(tone, "◆"))
        mark.setStyleSheet(f"color: {accent}; font-size: 13px; font-weight: 800;")
        text = QLabel(message)
        text.setWordWrap(True)
        text.setStyleSheet(f"color: {t.text}; font-size: 12px;")
        row.addWidget(mark, 0, Qt.AlignTop)
        row.addWidget(text, 1)
        self._effect = QGraphicsOpacityEffect(self)
        self._effect.setOpacity(0.0)
        self.setGraphicsEffect(self._effect)

    def fade(self, start: float, end: float, duration: int, on_done=None) -> None:
        animation = QVariantAnimation(self)
        animation.setDuration(duration)
        animation.setStartValue(start)
        animation.setEndValue(end)
        animation.valueChanged.connect(lambda value: self._effect.setOpacity(float(value)))
        if on_done:
            animation.finished.connect(on_done)
        animation.start(QVariantAnimation.DeleteWhenStopped)
        self._fade = animation


class ToastStack(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        outer = QHBoxLayout(self)
        outer.setContentsMargins(0, 16, 22, 16)
        outer.addStretch(1)
        self.column = QVBoxLayout()
        self.column.setSpacing(8)
        self.column.setAlignment(Qt.AlignTop)
        outer.addLayout(self.column)
        self._history: list[tuple[str, float]] = []

    def show_toast(self, message: str, tone: str = "info", timeout: int = 4200) -> None:
        now = time.monotonic()
        self._history = [(text, stamp) for text, stamp in self._history if now - stamp < 4]
        if any(text == message for text, _ in self._history[-2:]):
            return
        self._history.append((message, now))
        toast = Toast(message, tone, self)
        self.column.addWidget(toast, 0, Qt.AlignRight)
        toast.fade(0.0, 1.0, 160)
        QTimer.singleShot(timeout, lambda: self._dismiss(toast))

    def _dismiss(self, toast: Toast) -> None:
        if not toast.isVisible():
            toast.deleteLater()
            return
        toast.fade(1.0, 0.0, 200, toast.deleteLater)
