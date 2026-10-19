"""Design tokens and the global stylesheet for the manager UI."""
from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtGui import QColor, QFont, QPalette
from PySide6.QtWidgets import QApplication, QWidget


@dataclass(frozen=True)
class Tokens:
    name: str
    window: str
    sidebar: str
    surface: str
    surface_alt: str
    raised: str
    border: str
    border_strong: str
    text: str
    muted: str
    faint: str
    accent: str
    accent_hover: str
    accent_soft: str
    success: str
    success_soft: str
    warning: str
    warning_soft: str
    danger: str
    danger_soft: str
    shadow: str


DARK = Tokens(
    name="dark", window="#080C14", sidebar="#0B111C", surface="#101827",
    surface_alt="#151F30", raised="#1B2739", border="#1E2B3E", border_strong="#2C3C54",
    text="#E9EFFA", muted="#8E9EB6", faint="#5D6C82", accent="#4E8CFF",
    accent_hover="#6BA0FF", accent_soft="rgba(78, 140, 255, 0.14)",
    success="#34D399", success_soft="rgba(52, 211, 153, 0.14)",
    warning="#FBBF24", warning_soft="rgba(251, 191, 36, 0.14)",
    danger="#F87171", danger_soft="rgba(248, 113, 113, 0.14)", shadow="rgba(0, 0, 0, 90)",
)

LIGHT = Tokens(
    name="light", window="#F4F6FB", sidebar="#FFFFFF", surface="#FFFFFF",
    surface_alt="#F4F7FC", raised="#EAF0F9", border="#E1E7F1", border_strong="#C7D2E3",
    text="#0F172A", muted="#63728A", faint="#8C9AB0", accent="#2F6BFF",
    accent_hover="#1F59E8", accent_soft="rgba(47, 107, 255, 0.10)",
    success="#059669", success_soft="rgba(5, 150, 105, 0.12)",
    warning="#D97706", warning_soft="rgba(217, 119, 6, 0.12)",
    danger="#DC2626", danger_soft="rgba(220, 38, 38, 0.12)", shadow="rgba(15, 23, 42, 26)",
)

CURRENT: Tokens = DARK


def current() -> Tokens:
    return CURRENT


def tokens(dark: bool) -> Tokens:
    return DARK if dark else LIGHT


def _stylesheet(t: Tokens) -> str:
    return f"""
    QWidget {{ color: {t.text}; background: transparent; }}
    QMainWindow, QDialog, QWidget#Root {{ background: {t.window}; }}
    QToolTip {{ background: {t.raised}; color: {t.text}; border: 1px solid {t.border_strong};
        border-radius: 8px; padding: 6px 9px; }}

    QLabel#PageTitle {{ font-size: 26px; font-weight: 700; }}
    QLabel#PageSubtitle {{ color: {t.muted}; font-size: 13px; }}
    QLabel#Eyebrow {{ color: {t.accent}; font-size: 11px; font-weight: 700; }}
    QLabel#CardTitle {{ font-size: 15px; font-weight: 600; }}
    QLabel#CardSubtitle {{ color: {t.muted}; font-size: 12px; }}
    QLabel#Muted {{ color: {t.muted}; }}
    QLabel#Faint {{ color: {t.faint}; font-size: 12px; }}
    QLabel#Value {{ font-size: 24px; font-weight: 700; }}
    QLabel#ValueSmall {{ font-size: 17px; font-weight: 600; }}
    QLabel#PathValue {{ font-family: 'Cascadia Mono', 'Consolas', monospace; font-size: 12px;
        color: {t.text}; }}

    QFrame#Card {{ background: {t.surface}; border: 1px solid {t.border}; border-radius: 16px; }}
    QFrame#Card[variant="raised"] {{ background: {t.surface_alt}; }}
    QFrame#Hero {{ background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
        stop:0 {t.surface}, stop:0.65 {t.surface}, stop:1 {t.accent_soft});
        border: 1px solid {t.border}; border-radius: 18px; }}
    QFrame#Divider {{ background: {t.border}; border: none; max-height: 1px; min-height: 1px; }}
    QWidget#Sidebar {{ background: {t.sidebar}; border-right: 1px solid {t.border}; }}
    QWidget#TopBar {{ background: {t.window}; border-bottom: 1px solid {t.border}; }}
    QFrame#SidebarFooter {{ background: {t.surface_alt}; border: 1px solid {t.border};
        border-radius: 14px; }}
    QLabel#BrandName {{ font-size: 15px; font-weight: 700; }}
    QLabel#BrandSub {{ color: {t.faint}; font-size: 9px; font-weight: 600; }}
    QLabel#SectionLabel {{ color: {t.faint}; font-size: 9px; font-weight: 700; }}
    QLabel#Breadcrumb {{ color: {t.faint}; font-size: 11px; font-weight: 600; }}
    QLabel#Headline {{ font-size: 24px; font-weight: 700; }}
    QLabel#HeroValue {{ font-size: 30px; font-weight: 700; }}
    QLabel#EmptyGlyph {{ color: {t.faint}; font-size: 26px; }}

    QPushButton {{ background: {t.surface_alt}; border: 1px solid {t.border};
        border-radius: 10px; padding: 9px 16px; font-weight: 600; color: {t.text};
        min-height: 20px; }}
    QPushButton:hover {{ background: {t.raised}; border-color: {t.border_strong}; }}
    QPushButton:pressed {{ background: {t.surface}; }}
    QPushButton:disabled {{ color: {t.faint}; background: {t.surface}; border-color: {t.border}; }}
    QPushButton[variant="primary"] {{ background: {t.accent}; border: 1px solid {t.accent};
        color: #FFFFFF; }}
    QPushButton[variant="primary"]:hover {{ background: {t.accent_hover};
        border-color: {t.accent_hover}; }}
    QPushButton[variant="primary"]:pressed {{ background: {t.accent}; }}
    QPushButton[variant="primary"]:disabled {{ background: {t.accent_soft};
        border-color: transparent; color: {t.muted}; }}
    QPushButton[variant="danger"] {{ background: {t.danger_soft}; border: 1px solid {t.danger};
        color: {t.danger}; }}
    QPushButton[variant="danger"]:hover {{ background: {t.danger}; color: #FFFFFF; }}
    QPushButton[variant="danger"]:disabled {{ background: {t.surface_alt};
        border-color: {t.border}; color: {t.faint}; }}
    QPushButton[variant="ghost"] {{ background: transparent; border: 1px solid transparent;
        color: {t.muted}; }}
    QPushButton[variant="ghost"]:hover {{ background: {t.surface_alt}; color: {t.text}; }}
    QPushButton[variant="ghost"]:pressed {{ background: {t.raised}; }}
    QPushButton[compact="true"] {{ padding: 6px 11px; border-radius: 8px; font-size: 12px; }}
    QPushButton#IconButton {{ padding: 6px; min-width: 18px; min-height: 18px;
        border-radius: 9px; font-size: 16px; color: {t.muted}; }}
    QPushButton#IconButton:hover {{ color: {t.text}; background: {t.surface_alt}; }}

    QLineEdit, QComboBox, QSpinBox, QPlainTextEdit, QTableWidget {{
        background: {t.surface_alt}; border: 1px solid {t.border}; border-radius: 10px;
        padding: 8px 11px; selection-background-color: {t.accent}; selection-color: #FFFFFF; }}
    QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QPlainTextEdit:focus {{
        border: 1px solid {t.accent}; background: {t.surface}; }}
    QLineEdit:read-only {{ color: {t.muted}; }}
    QLineEdit#PathField {{ font-family: 'Cascadia Mono', 'Consolas', monospace; font-size: 12px;
        color: {t.text}; padding: 10px 12px; }}
    QComboBox {{ padding-right: 26px; }}
    QComboBox::drop-down {{ border: none; width: 24px; }}
    QPushButton#Select {{ background: {t.surface_alt}; border: 1px solid {t.border};
        border-radius: 10px; padding: 8px 30px 8px 12px; text-align: left; font-weight: 500;
        color: {t.text}; }}
    QPushButton#Select:hover {{ border-color: {t.border_strong}; background: {t.raised}; }}
    QPushButton#Select::menu-indicator {{ subcontrol-position: center right;
        subcontrol-origin: padding; right: 10px; width: 10px; }}
    QComboBox QAbstractItemView {{ background: {t.raised}; border: 1px solid {t.border_strong};
        border-radius: 10px; padding: 4px; selection-background-color: {t.accent_soft};
        selection-color: {t.text}; outline: none; }}
    QSpinBox::up-button, QSpinBox::down-button {{ width: 18px; border: none;
        background: transparent; }}
    QPlainTextEdit#Console {{ background: {t.window}; border: 1px solid {t.border};
        border-radius: 12px; padding: 10px 12px;
        font-family: 'Cascadia Mono', 'Consolas', monospace; font-size: 12px;
        color: {t.muted}; }}

    QScrollArea {{ border: none; background: transparent; }}
    QScrollArea > QWidget > QWidget {{ background: transparent; }}
    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 4px 2px; }}
    QScrollBar::handle:vertical {{ background: {t.border_strong}; border-radius: 4px;
        min-height: 28px; }}
    QScrollBar::handle:vertical:hover {{ background: {t.muted}; }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
    QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{ background: transparent; }}
    QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 2px 4px; }}
    QScrollBar::handle:horizontal {{ background: {t.border_strong}; border-radius: 4px;
        min-width: 28px; }}
    QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; }}

    QTableWidget {{ background: transparent; border: none; gridline-color: {t.border}; }}
    QTableWidget::item {{ padding: 9px 8px; border-bottom: 1px solid {t.border}; }}
    QTableWidget::item:selected {{ background: {t.accent_soft}; color: {t.text}; }}
    QHeaderView::section {{ background: transparent; color: {t.muted}; font-size: 11px;
        font-weight: 700; padding: 8px; border: none; border-bottom: 1px solid {t.border}; }}
    QTableCornerButton::section {{ background: transparent; border: none; }}

    QProgressBar {{ background: {t.surface_alt}; border: none; border-radius: 4px;
        height: 7px; text-align: center; color: transparent; }}
    QProgressBar::chunk {{ background: {t.accent}; border-radius: 4px; }}
    QProgressBar[tone="success"]::chunk {{ background: {t.success}; }}
    QProgressBar[tone="warning"]::chunk {{ background: {t.warning}; }}
    QProgressBar[tone="danger"]::chunk {{ background: {t.danger}; }}

    QMenu {{ background: {t.raised}; border: 1px solid {t.border_strong};
        border-radius: 12px; padding: 6px; }}
    QMenu::item {{ padding: 8px 22px 8px 14px; border-radius: 8px; }}
    QMenu::item:selected {{ background: {t.accent_soft}; color: {t.text}; }}
    QMenu::item:disabled {{ color: {t.faint}; }}
    QMenu::separator {{ height: 1px; background: {t.border}; margin: 5px 8px; }}

    QMessageBox {{ background: {t.surface}; }}
    QMessageBox QLabel {{ color: {t.text}; min-width: 320px; }}
    QProgressDialog {{ background: {t.surface}; }}
    """


def apply_theme(app: QApplication, dark: bool) -> None:
    global CURRENT
    t = tokens(dark)
    CURRENT = t

    font = QFont()
    font.setFamilies(["Segoe UI Variable Text", "Segoe UI", "Inter", "Noto Sans", "Arial"])
    font.setPointSizeF(9.75)
    app.setFont(font)

    palette = QPalette()
    for role, value in ((QPalette.Window, t.window), (QPalette.WindowText, t.text),
                        (QPalette.Base, t.surface_alt), (QPalette.AlternateBase, t.surface),
                        (QPalette.Text, t.text), (QPalette.Button, t.surface_alt),
                        (QPalette.ButtonText, t.text), (QPalette.Highlight, t.accent),
                        (QPalette.HighlightedText, "#FFFFFF"), (QPalette.PlaceholderText, t.faint),
                        (QPalette.ToolTipBase, t.raised), (QPalette.ToolTipText, t.text),
                        (QPalette.Link, t.accent), (QPalette.Mid, t.border)):
        palette.setColor(role, QColor(value))
    app.setPalette(palette)
    app.setStyleSheet(_stylesheet(t))
    for widget in app.allWidgets():
        _repolish(widget)


def _repolish(widget: QWidget) -> None:
    style = widget.style()
    style.unpolish(widget)
    style.polish(widget)
    widget.update()


def repolish(*widgets: QWidget) -> None:
    for widget in widgets:
        _repolish(widget)
