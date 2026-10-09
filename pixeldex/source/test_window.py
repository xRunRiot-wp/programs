"""Starts the built PixelDex window (hidden) with WebView2 debugging on port 9556 and checks it over CDP, twice
(second run checks that marks were kept). Closes it by PID afterwards."""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from websockets.sync.client import connect

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "H:/HomeDashboard/work/pixeldex2/out/PixelDex")
PORT = 9556
SETTINGS_DIR = Path("H:/HomeDashboard/work/pixeldex2/test-settings")
import shutil
shutil.rmtree(SETTINGS_DIR, ignore_errors=True)

def run_once(check):
    env = dict(os.environ, PIXELDEX_TEST_HIDDEN="1", WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={PORT}",
               PIXELDEX_SETTINGS_DIR=str(SETTINGS_DIR))   # never the real %APPDATA% settings
    p = subprocess.Popen([str(OUT / "runtime" / "python.exe"), str(OUT / "pixeldex.pyw")], cwd=OUT, env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=subprocess.BELOW_NORMAL_PRIORITY_CLASS)
    try:
        tab = None
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                tab = next((t for t in tabs if t["type"] == "page" and "index.html" in t["url"]), None)
                if tab: break
            except OSError: pass
            if p.poll() is not None: print(p.stdout.read().decode(errors="replace")); raise SystemExit("window process exited")
            time.sleep(0.3)
        print("page:", tab["url"])
        with connect(tab["webSocketDebuggerUrl"], max_size=50_000_000) as ws:
            n = [0]
            def ev(js):
                n[0] += 1
                ws.send(json.dumps({"id": n[0], "method": "Runtime.evaluate", "params": {"expression": js, "awaitPromise": True, "returnByValue": True}}))
                while True:
                    m = json.loads(ws.recv())
                    if m.get("id") == n[0]:
                        r = m["result"]
                        if "exceptionDetails" in r: raise RuntimeError(r["exceptionDetails"])
                        return r["result"].get("value")
            time.sleep(4)
            check(ev)
    finally:
        subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
        time.sleep(1)

def first(ev):
    print("cards:", ev("document.querySelectorAll('#grid .card').length"))
    print("sprite fetch:", ev("Promise.all([...document.querySelectorAll('#grid img')].slice(0,1028).map(i=>fetch(i.src).then(r=>r.ok))).then(a=>a.filter(Boolean).length)"), "of 1028 card pictures served")
    print("pywebview api:", ev("!!(window.pywebview && window.pywebview.api)"))
    print("counts (v1 world carried over?):", ev("document.getElementById('counts').textContent"))
    save = str(Path.home() / "curseforge/minecraft/Instances/After Pokopia/saves/pixeldex test").replace("\\\\", "/")
    print("read_world:", ev(f"window.pywebview.api.read_world({json.dumps(save)}).then(r=>r.world+' players='+r.players.length)"))
    ev("toggleManual('4')")   # mark Charmander by hand
    time.sleep(1)
    print("counts with test mark:", ev("document.getElementById('counts').textContent"))
    print("page title:", ev("document.title"), "| footer:", ev("document.getElementById('versionFooter').textContent"))
    ev("openDetail(385)")
    time.sleep(0.5)
    print("Jirachi in the real window:", ev("[...document.querySelectorAll('.spawn-table th')].map(h=>h.textContent).join(',')"),
          "| first row:", ev("[...document.querySelector('.spawn-table tbody tr').children].map(td=>td.innerText.split(String.fromCharCode(10))[0]).join(' | ')"),
          "| old card rows:", ev("document.querySelectorAll('#detailContent .spawn-row .pct').length"))
    import base64
    ws_png = ev("1")
    ev("openDetail(2)")
    print("Ivysaur header:", ev("document.querySelector('.detail-header').innerText.split(String.fromCharCode(10)).filter(Boolean).join(' | ')"))

def second(ev):
    import base64
    ev("closeDetail()")
    ws_shot = ev("1")
    print("after restart counts:", ev("document.getElementById('counts').textContent"))
    print("manual mark kept:", ev("manual.has('4')"))
    ev("toggleManual('4')")   # undo the test mark
    time.sleep(1)

pyw = (OUT / "pixeldex.pyw").read_text(encoding="utf-8")
print("window title in pixeldex.pyw:", next(l.strip() for l in pyw.splitlines() if l.startswith("VERSION =")))
run_once(first)
shutil.rmtree(OUT / "userdata", ignore_errors=True)   # like deleting the old folder and unzipping a new one
run_once(second)
shutil.rmtree(OUT / "userdata", ignore_errors=True)   # leave the built folder clean for zipping
print("settings file outside the folder:", (SETTINGS_DIR / "settings.json").is_file())
