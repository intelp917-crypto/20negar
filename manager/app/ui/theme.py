from PySide6.QtGui import QPalette, QColor


def apply_theme(app, dark: bool) -> None:
    palette = QPalette()
    if dark:
        palette.setColor(QPalette.Window, QColor("#111827")); palette.setColor(QPalette.WindowText, QColor("#e5e7eb"))
        palette.setColor(QPalette.Base, QColor("#1f2937")); palette.setColor(QPalette.AlternateBase, QColor("#273449"))
        palette.setColor(QPalette.Text, QColor("#f3f4f6")); palette.setColor(QPalette.Button, QColor("#263449"))
        palette.setColor(QPalette.ButtonText, QColor("#f3f4f6")); palette.setColor(QPalette.Highlight, QColor("#2563eb"))
        app.setStyleSheet("QWidget{font-size:13px} QGroupBox{font-weight:600;border:1px solid #374151;border-radius:8px;margin-top:10px;padding:12px} QPushButton{padding:7px 14px;border-radius:5px} QLineEdit,QTextEdit,QComboBox{padding:6px;border-radius:5px}")
    else:
        app.setStyleSheet("QWidget{font-size:13px} QGroupBox{font-weight:600;border:1px solid #d1d5db;border-radius:8px;margin-top:10px;padding:12px} QPushButton{padding:7px 14px;border-radius:5px} QLineEdit,QTextEdit,QComboBox{padding:6px;border-radius:5px}")
    app.setPalette(palette)
