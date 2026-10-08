"""Headless Chrome check of the built PixelDex folder (own temp profile, port 9555 - never the dashboard's 9333)."""
import base64
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from websockets.sync.client import connect

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "H:/HomeDashboard/work/pixeldex2/out/PixelDex")
SHOTS = Path("H:/HomeDashboard/work/pixeldex2/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
SAVE = Path.home() / "curseforge/minecraft/Instances/After Pokopia/saves/pixeldex test/playerdata/pokemon/1afb0b73-f95e-4b60-9b0b-f5a84ddf33df.pokedex"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9555

prof = Path("H:/HomeDashboard/work/pixeldex2/chrome-prof")
proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
                         "--window-size=1400,900", "--no-first-run", "--disable-gpu", "about:blank"],
                        creationflags=subprocess.BELOW_NORMAL_PRIORITY_CLASS)
try:
    for _ in range(50):
        try:
            ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version"))
            break
        except OSError:
            time.sleep(0.2)
    assert "HeadlessChrome" in ver["User-Agent"], ver
    tab = next(t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json")) if t["type"] == "page")
    ws = connect(tab["webSocketDebuggerUrl"], max_size=50_000_000)
    mid = [0]
    errors = []

    def cmd(method, **params):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
        while True:
            m = json.loads(ws.recv())
            if m.get("method") == "Runtime.exceptionThrown":
                errors.append(m["params"]["exceptionDetails"].get("exception", {}).get("description") or m["params"]["exceptionDetails"]["text"])
            if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] == "error":
                errors.append(str(m["params"]["args"]))
            if m.get("id") == mid[0]:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m["result"]

    def ev(js):
        r = cmd("Runtime.evaluate", expression=js, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")

    def shot(name):
        data = cmd("Page.captureScreenshot", format="png")["data"]
        (SHOTS / f"{name}.png").write_bytes(base64.b64decode(data))

    cmd("Runtime.enable")
    cmd("Page.enable")
    cmd("Page.navigate", url=(OUT / "PixelDex.html").as_uri())
    time.sleep(3)
    print("cards:", ev("document.querySelectorAll('#grid .card').length"))
    # every card picture must load
    ev("Promise.all([...document.querySelectorAll('#grid img')].map(i=>{i.loading='eager'; return i.complete?0:new Promise(r=>{i.onload=i.onerror=r})}))")
    time.sleep(1)
    print("cards without picture:", ev("[...document.querySelectorAll('#grid .card')].filter(c=>{const i=c.querySelector('img');return !i.getAttribute('src')||!i.naturalWidth}).map(c=>c.querySelector('.name').textContent)"))
    shot("1_pokedex")
    # bug checks
    for dex in (669, 671, 925, 982, 422, 666, 875):
        ev(f"openDetail({dex})")
        print(dex, "header picture ok:", ev("!!document.querySelector('.detail-header img').naturalWidth || new Promise(r=>setTimeout(()=>r(!!document.querySelector('.detail-header img').naturalWidth),300))"))
    ev("openDetail(490)")
    txt = ev("document.getElementById('detailContent').innerText")
    print("Manaphy mentions 'Evolves from':", "Evolves from" in txt)
    shot("2_manaphy")
    ev("openDetail(133)")
    time.sleep(0.5)
    shot("3_eevee_family")
    print("Eevee family chips:", ev("document.querySelectorAll('.fam-chip').length"))
    ev("openDetail(104)")
    time.sleep(0.5)
    print("Cubone sections:", ev("[...document.querySelectorAll('.section-title')].map(s=>s.textContent)"))
    shot("4_cubone")
    ev("document.querySelector('#detailOverlay .detail-card').scrollTop=99999")
    time.sleep(0.4)
    shot("4b_cubone_forms")
    ev("document.getElementById('closeDetail').click()")
    # load the real test save through the same code path as the folder picker
    b64 = base64.b64encode(SAVE.read_bytes()).decode()
    ev(f"(async()=>{{const b=Uint8Array.from(atob('{b64}'),c=>c.charCodeAt(0)); await applyPlayers('pixeldex test',[{{uuid:'x',file:new File([b],'x.pokedex'),modified:1}}]);}})()")
    print("counts after save:", ev("document.getElementById('counts').textContent"))
    print("caught cards:", ev("[...document.querySelectorAll('#grid .card:not(.uncaught) .name')].map(n=>n.textContent)"))
    ev("openDetail(63)")
    time.sleep(0.4)
    shot("5_abra_caught")
    print("Abra family:", ev("[...document.querySelectorAll('.fam-chip')].map(c=>c.innerText.replace(/\\n/g,' '))"))
    ev("document.querySelector('[data-pick*=\"shiny\"]').click()")
    ev("document.getElementById('closeDetail').click()")
    print("Abra card picture now:", ev("document.querySelector('#grid .card[data-dex=\"63\"] img').getAttribute('src')"))
    ev("showTab('forms')")
    time.sleep(0.5)
    print("forms:", ev("document.getElementById('formCount').textContent"))
    shot("6_forms")
    ev("showTab('palettes')")
    time.sleep(0.5)
    print("palettes:", ev("document.getElementById('palCount').textContent"))
    ev("document.getElementById('palName').value='christmas'; document.getElementById('palName').dispatchEvent(new Event('change'))")
    time.sleep(0.5)
    print("christmas:", ev("document.getElementById('palCount').textContent"))
    shot("7_palettes")
    ev("showTab('biome')")
    ev("document.getElementById('biomeSelect').value='Structure: Graveyard'; document.getElementById('biomeSelect').dispatchEvent(new Event('change'))")
    time.sleep(0.5)
    print("graveyard rows:", ev("document.querySelectorAll('.biome-row').length"))
    shot("8_graveyard")
    ev("document.getElementById('biomeSelect').value='Mystic Grove'; document.getElementById('biomeSelect').dispatchEvent(new Event('change'))")
    print("Mystic Grove rows:", ev("document.querySelectorAll('.biome-row').length"))
    ev("showTab('pokedex')")
    print("JS errors:", errors)
finally:
    proc.terminate()
