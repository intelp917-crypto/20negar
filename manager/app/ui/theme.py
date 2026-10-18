from PySide6.QtGui import QColor, QPalette


def apply_theme(app, dark: bool) -> None:
    """Apply the console palette and a compact design system to the whole window."""
    colors = {
        "window": "#0b1220", "surface": "#111b2e", "surface2": "#17243a",
        "border": "#263754", "text": "#e8eef7", "muted": "#91a0b7",
        "accent": "#4f8cff", "accent2": "#326ee8", "success": "#31c48d",
    } if dark else {
        "window": "#f4f7fb", "surface": "#ffffff", "surface2": "#edf3fb",
        "border": "#d9e2ef", "text": "#152238", "muted": "#64748b",
        "accent": "#2563eb", "accent2": "#1d4ed8", "success": "#0f9f70",
    }
    palette = QPalette()
    for role, value in ((QPalette.Window, colors["window"]), (QPalette.WindowText, colors["text"]),
                        (QPalette.Base, colors["surface"]), (QPalette.AlternateBase, colors["surface2"]),
                        (QPalette.Text, colors["text"]), (QPalette.Button, colors["surface2"]),
                        (QPalette.ButtonText, colors["text"]), (QPalette.Highlight, colors["accent"]),
                        (QPalette.HighlightedText, "#ffffff")):
        palette.setColor(role, QColor(value))
    app.setPalette(palette)
    app.setStyleSheet(f"""
        QWidget {{ font-family: 'Segoe UI'; font-size: 13px; color: {colors['text']}; }}
        QMainWindow, QDialog {{ background: {colors['window']}; }}
        QLabel#pageTitle {{ font-size: 25px; font-weight: 700; margin-bottom: 2px; }}
        QLabel#pageSubtitle, QLabel#muted {{ color: {colors['muted']}; }}
        QLabel#sectionTitle {{ font-size: 15px; font-weight: 700; }}
        QFrame#card, QGroupBox {{ background: {colors['surface']}; border: 1px solid {colors['border']};
            border-radius: 12px; }}
        QGroupBox {{ margin-top: 12px; padding: 18px 14px 12px; font-weight: 700; }}
        QGroupBox::title {{ subcontrol-origin: margin; left: 14px; padding: 0 6px; }}
        QPushButton {{ background: {colors['surface2']}; border: 1px solid {colors['border']};
            border-radius: 7px; padding: 9px 15px; min-height: 18px; }}
        QPushButton:hover {{ border-color: {colors['accent']}; background: {colors['accent']}22; }}
        QPushButton#primary {{ background: {colors['accent']}; color: #ffffff; border: none; font-weight: 700; }}
        QPushButton#primary:hover {{ background: {colors['accent2']}; }}
        QPushButton#danger {{ color: #f87171; }}
        QLineEdit, QComboBox, QSpinBox, QPlainTextEdit, QTableWidget {{ background: {colors['surface']};
            border: 1px solid {colors['border']}; border-radius: 7px; padding: 8px; }}
        QLineEdit:focus, QComboBox:focus, QSpinBox:focus {{ border: 1px solid {colors['accent']}; }}
        QListWidget#sidebar {{ background: {colors['surface']}; border: none; padding: 12px 8px; }}
        QListWidget#sidebar::item {{ padding: 11px 13px; margin: 2px 0; border-radius: 7px; color: {colors['muted']}; }}
        QListWidget#sidebar::item:selected {{ background: {colors['accent']}22; color: {colors['accent']}; font-weight: 700; }}
        QHeaderView::section {{ background: {colors['surface2']}; color: {colors['muted']}; padding: 9px; border: none; }}
        QStatusBar {{ background: {colors['surface']}; color: {colors['muted']}; }}
        QProgressBar {{ border: none; border-radius: 5px; background: {colors['surface2']}; text-align: center; }}
        QProgressBar::chunk {{ background: {colors['accent']}; border-radius: 5px; }}
    """)
