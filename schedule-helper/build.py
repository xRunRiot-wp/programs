"""Builds the release: dist/INSTRUCTIONS.html (pictures inside), dist/INSTRUCTIONS.pdf, dist/schedule-helper.zip.
The zip holds only the extension, the instructions and the README -- never a real roster."""
import base64, re, shutil, subprocess, tempfile, zipfile
from pathlib import Path

HERE = Path(__file__).parent
DIST = HERE / "dist"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
DIST.mkdir(exist_ok=True)

src = (HERE / "instructions" / "INSTRUCTIONS.src.html").read_text(encoding="utf-8")
def embed(m):
    data = base64.b64encode((HERE / "instructions" / m.group(1)).read_bytes()).decode()
    return f'src="data:image/jpeg;base64,{data}"'
html = re.sub(r'src="(img/[^"]+)"', embed, src)
(DIST / "INSTRUCTIONS.html").write_text(html, encoding="utf-8")

# PDF with a throwaway headless Chrome profile (never the everyday Chrome)
with tempfile.TemporaryDirectory() as prof:
    subprocess.run([CHROME, "--headless=new", f"--user-data-dir={prof}", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={DIST / 'INSTRUCTIONS.pdf'}", (DIST / "INSTRUCTIONS.html").as_uri()],
                   check=True, timeout=120, creationflags=subprocess.BELOW_NORMAL_PRIORITY_CLASS)

zp = DIST / "schedule-helper.zip"
zp.unlink(missing_ok=True)
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted((HERE / "extension").rglob("*")):
        if f.is_file():
            z.write(f, f"ScheduleHelper/extension/{f.relative_to(HERE / 'extension').as_posix()}")
    for name in ("INSTRUCTIONS.html", "INSTRUCTIONS.pdf"):
        z.write(DIST / name, f"ScheduleHelper/{name}")
    z.write(HERE / "README.md", "ScheduleHelper/README.md")
    bad = [n for n in z.namelist() if re.search(r"weekly_roster|\.csv$|\.xlsx$", n, re.I)]
    assert not bad, bad
print("built", zp, zp.stat().st_size, "bytes")
