"""Closing PixelDex must end every PixelDex process quickly and leave the folder deletable.

Starts the built window (hidden), sends it WM_CLOSE (what the X button does) by its own PID, then watches the
process tree (pythonw + WebView2 helpers using this folder) and tries to rename the folder.
Usage: python test_close.py <PixelDex folder> [--twice]   (--twice also checks the single-instance guard)
"""
import ctypes
import os
import shutil
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path

import json
import urllib.request

import psutil
from websockets.sync.client import connect

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "H:/HomeDashboard/work/pixeldex2/out/PixelDex").resolve()
SETTINGS_DIR = Path("H:/HomeDashboard/work/pixeldex2/test-settings-close")
user32 = ctypes.WinDLL("user32", use_last_error=True)
WM_CLOSE = 0x0010


def windows_of(pid):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid:
            n = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if buf.value.startswith("PixelDex"):
                found.append((hwnd, buf.value))
        return True

    user32.EnumWindows(cb, 0)
    return found


def pixeldex_procs():
    """Every process that belongs to this PixelDex folder: its pythonw, and WebView2 helpers using its profile."""
    out = []
    key = str(OUT).lower()
    for p in psutil.process_iter(["name", "exe", "cmdline"]):
        try:
            exe = (p.info["exe"] or "").lower()
            cmd = " ".join(p.info["cmdline"] or []).lower()
            if exe.startswith(key) or (p.info["name"] or "").lower() == "msedgewebview2.exe" and (
                    key in cmd or "pixeldex" in cmd):
                out.append(p)
        except (psutil.Error, OSError):
            pass
    return out


PORT = 9557
WORLD = str(Path.home() / "curseforge/minecraft/Instances/After Pokopia/saves/pixeldex test")


def seed_world():
    """Pretend the player linked a world, so the window re-reads the save whenever it gets focus."""
    s = {"worldPath": json.dumps(WORLD), "v1Imported": "true"}
    for d in (SETTINGS_DIR, OUT / "userdata"):     # v2.3+ / v2.1-v2.2 location
        d.mkdir(parents=True, exist_ok=True)
        (d / "settings.json").write_text(json.dumps(s), encoding="utf-8")


def start():
    env = dict(os.environ, PIXELDEX_TEST_HIDDEN="1", PIXELDEX_SETTINGS_DIR=str(SETTINGS_DIR),
               WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={PORT}")
    return subprocess.Popen([str(OUT / "runtime" / "pythonw.exe"), str(OUT / "pixeldex.pyw")], cwd=OUT, env=env,
                            creationflags=subprocess.BELOW_NORMAL_PRIORITY_CLASS)


def wait_window(pid, secs=30):
    for _ in range(int(secs / 0.25)):
        w = windows_of(pid)
        if w:
            return w
        time.sleep(0.25)
    return []


def folder_free():
    tmp = OUT.with_name(OUT.name + "_renametest")
    try:
        os.rename(OUT, tmp)
        os.rename(tmp, OUT)
        return True
    except OSError:
        return False


def kill_all():
    for p in pixeldex_procs():
        try:
            p.kill()
        except psutil.Error:
            pass


shutil.rmtree(SETTINGS_DIR, ignore_errors=True)
kill_all()
if "--busy" in sys.argv:
    seed_world()
ok = True
p = start()
w = wait_window(p.pid)
print("window:", w[0][1] if w else None)
time.sleep(4)   # let the page load fully
print("processes while open:", len(pixeldex_procs()))
if "--twice" in sys.argv:
    p2 = start()
    time.sleep(6)
    second_alive = p2.poll() is None
    print("second start exited by itself (single instance):", not second_alive,
          "| windows now:", len(windows_of(p.pid)) + (len(windows_of(p2.pid)) if second_alive else 0))
    ok &= not second_alive
    if second_alive:
        p2.kill()
if "--busy" in sys.argv:   # close while the window is re-reading the save (clicking X first focuses the window)
    tab = next(t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json")) if t["type"] == "page")
    ws = connect(tab["webSocketDebuggerUrl"], max_size=50_000_000)
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression":
        "for (let i = 0; i < 20; i++) resync(false); window.dispatchEvent(new Event('focus')); 1"}}))
    time.sleep(0.05)
t0 = time.time()
user32.PostMessageW(w[0][0], WM_CLOSE, 0, 0)
host_gone = None
while time.time() - t0 < 15:
    if p.poll() is not None:
        host_gone = time.time() - t0
        break
    time.sleep(0.02)
print("PixelDex itself ended after:", f"{host_gone:.2f}s" if host_gone is not None else "NOT within 15s")
gone_at = None
while time.time() - t0 < 20:   # then its WebView2 helpers (a scan of all processes takes ~1-2 s by itself)
    left = pixeldex_procs()
    if not left:
        gone_at = time.time() - t0
        break
    print(f"  {time.time() - t0:4.1f}s still running: {sorted(x.name() for x in left)}")
print("helpers gone too, checked at:", f"{gone_at:.1f}s" if gone_at is not None else "NOT within 20s")
print("folder can be renamed/deleted:", folder_free())
ok &= host_gone is not None and host_gone <= 1.0 and gone_at is not None
kill_all()
shutil.rmtree(OUT / "userdata", ignore_errors=True)
shutil.rmtree(SETTINGS_DIR, ignore_errors=True)
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
