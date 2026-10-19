# PyInstaller build definition for the standalone manager.
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules('app')
a = Analysis(
    ['main.py'],
    pathex=['.'],
    hiddenimports=hiddenimports,
    # The window and tray icon is read at runtime from the bundled asset.
    datas=[('scripts/icon-512.png', 'assets')],
    binaries=[],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='20negar-manager',
    console=False,
    icon='scripts/20negar.ico',
)
