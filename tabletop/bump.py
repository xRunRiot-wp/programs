"""Raise the version number everywhere before publishing, so browsers load the new files
instead of an old copy (GitHub Pages lets browsers keep files for 10 minutes)."""
import json
import re
from pathlib import Path

here = Path(__file__).parent
vfile = here / 'version.json'
v = json.loads(vfile.read_text())['v'] + 1 if vfile.exists() else 1
vfile.write_text(json.dumps({'v': v}) + '\n')

html = here / 'index.html'
html.write_text(re.sub(r'src="tabletop\.js(\?v=\d+)?"', f'src="tabletop.js?v={v}"', html.read_text(encoding='utf-8')), encoding='utf-8')

js = here / 'tabletop.js'
s = js.read_text(encoding='utf-8')
s = re.sub(r"from '\./(dice|rules)\.js(\?v=\d+)?'", lambda m: f"from './{m.group(1)}.js?v={v}'", s)
s = re.sub(r'^const VERSION = \d+;', f'const VERSION = {v};', s, flags=re.M)
js.write_text(s, encoding='utf-8')
print('version', v)
