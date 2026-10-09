"""PixelDex - opens the PixelDex window (same window as v1, no .exe).

Started by "PixelDex.vbs" with the portable Python in the runtime folder; nothing is installed.
The page lives in app/; Python only picks/reads the world save folder (read-only).
"""
import base64
import ctypes
import json
import os
import threading
from pathlib import Path

import webview

VERSION = "dev"   # build.py writes the real version here (shown in the title bar)
HERE = Path(__file__).resolve().parent
# Settings live outside the folder, so deleting the old folder and unzipping a new version keeps them.
SETTINGS_DIR = Path(os.environ.get("PIXELDEX_SETTINGS_DIR") or Path(os.environ.get("APPDATA", Path.home())) / "PixelDex" / "v2")
SETTINGS = SETTINGS_DIR / "settings.json"
LOCAL_SETTINGS = HERE / "userdata" / "settings.json"   # where v2.1/v2.2 kept them
# The window's browser profile also lives outside the folder, so nothing inside the folder is held open.
WEBVIEW_DIR = (SETTINGS_DIR / "webview") if os.environ.get("PIXELDEX_SETTINGS_DIR") else \
    Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PixelDex" / "webview"
TESTING = bool(os.environ.get("PIXELDEX_TEST_HIDDEN"))
_settings_lock = threading.Lock()   # the window calls in from several threads at once


class Api:
    def pick_world(self):
        picked = window.create_file_dialog(getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG)
        if not picked:
            return None
        return self.read_world(picked[0] if isinstance(picked, (list, tuple)) else picked)

    def read_world(self, path):
        world = Path(path)
        players = []
        folder = world / "playerdata" / "pokemon"
        if folder.is_dir():
            for f in folder.glob("*.pokedex"):
                try:
                    players.append({"uuid": f.stem, "modified": f.stat().st_mtime * 1000,
                                    "data": base64.b64encode(f.read_bytes()).decode()})
                except OSError:
                    pass
        return {"world": world.name, "path": str(world), "players": players}

    # settings ("caught" marks, picture picks, world folder) live in userdata/settings.json next to the app
    def load_settings(self):
        try:
            return json.loads(SETTINGS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        old = _find_old_settings()   # first run of this version: bring over v2.1/v2.2 settings if we can find them
        if old:
            try:
                SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
                SETTINGS.write_text(old.read_text(encoding="utf-8"), encoding="utf-8")
                return json.loads(SETTINGS.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        return {}

    def save_setting(self, key, value_json):
        with _settings_lock:
            data = self.load_settings()
            data[key] = value_json
            SETTINGS.parent.mkdir(parents=True, exist_ok=True)
            tmp = SETTINGS.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, SETTINGS)
        return True

    def v1_config(self):
        """v1 kept its settings in %APPDATA%\\PixelDex\\config.json - reuse its world folder and manual marks."""
        cfg = Path(os.environ.get("APPDATA", Path.home())) / "PixelDex" / "config.json"
        try:
            return json.loads(cfg.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None


def _find_old_settings():
    """An older PixelDex folder's userdata/settings.json: this folder, its neighbours, Desktop/Downloads/Documents."""
    if os.environ.get("PIXELDEX_SETTINGS_DIR"):   # tests: only this folder
        return LOCAL_SETTINGS if LOCAL_SETTINGS.is_file() else None
    if LOCAL_SETTINGS.is_file():
        return LOCAL_SETTINGS
    found = []
    places = {HERE.parent} | {Path.home() / d for d in ("Desktop", "Downloads", "Documents", "OneDrive/Desktop", "OneDrive/Documents")}
    for base in places:
        try:
            for pattern in ("*/userdata/settings.json", "*/*/userdata/settings.json"):
                found += [f for f in base.glob(pattern) if (f.parent.parent / "pixeldex.pyw").is_file()]
        except OSError:
            pass
    return max(found, key=lambda f: f.stat().st_mtime) if found else None


def _already_running():
    """Only one PixelDex at a time: if one is open, bring it to the front and let this second start quit."""
    k32, user32 = ctypes.windll.kernel32, ctypes.windll.user32
    global _mutex   # keep the handle for the life of the process
    _mutex = k32.CreateMutexW(None, False, "Local\\PixelDex.v2.window")
    if k32.GetLastError() != 183:   # ERROR_ALREADY_EXISTS
        return False
    hits = []
    proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def cb(hwnd, _):
        buf = ctypes.create_unicode_buffer(64)
        user32.GetWindowTextW(hwnd, buf, 64)
        if buf.value.startswith("PixelDex v"):
            hits.append(hwnd)
        return True

    user32.EnumWindows(proc(cb), None)
    for hwnd in hits:
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)   # SW_RESTORE
        if user32.IsWindowVisible(hwnd):
            user32.SetForegroundWindow(hwnd)
    return True


def _quit():
    """Closing the window ends PixelDex right away, even if a save read is still running in the background.
    (A normal exit waits for the window library to shut down, which can take seconds and keeps the folder in use.)"""
    k32 = ctypes.windll.kernel32
    k32.TerminateProcess(ctypes.c_void_p(k32.GetCurrentProcess()), 0)
    os._exit(0)


if _already_running():
    _quit()
api = Api()
window = webview.create_window(f"PixelDex v{VERSION}", str(HERE / "app" / "index.html"), js_api=api,
                               width=1200, height=800, min_size=(900, 600),
                               hidden=TESTING)   # hidden only for automated tests
window.events.closed += _quit
# private_mode off + a storage folder = the window's own storage is kept between runs (settings.json is the main copy)
webview.start(private_mode=False, storage_path=str(WEBVIEW_DIR))
_quit()
