"""PixelDex - opens the PixelDex window (same window as v1, no .exe).

Started by "PixelDex.vbs" with the portable Python in the runtime folder; nothing is installed.
The page lives in app/; Python only picks/reads the world save folder (read-only).
"""
import base64
import json
import os
import threading
from pathlib import Path

import webview

HERE = Path(__file__).resolve().parent
SETTINGS = HERE / "userdata" / "settings.json"
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
            return {}

    def save_setting(self, key, value_json):
        with _settings_lock:
            data = self.load_settings()
            data[key] = value_json
            SETTINGS.parent.mkdir(exist_ok=True)
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


api = Api()
window = webview.create_window("PixelDex", str(HERE / "app" / "index.html"), js_api=api,
                               width=1200, height=800, min_size=(900, 600),
                               hidden=bool(os.environ.get("PIXELDEX_TEST_HIDDEN")))   # only for automated tests
# private_mode off + storage in this folder = your "caught" marks and picture picks are kept between runs
webview.start(private_mode=False, storage_path=str(HERE / "userdata"))
