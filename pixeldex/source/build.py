"""Build the portable PixelDex folder (no .exe; PixelDex.vbs opens it in its own window with the bundled Python).

Reads Pixelmon's own data files from the mod jar (species, palettes, sprites,
evolutions, structure spawns) plus the v1 spawn tables (baseline/v1_spawns.json.gz,
which hold the per-biome % numbers PixelDex v1 shipped with), and writes:

    <out>/PixelDex/PixelDex.vbs    <- double-click this
    <out>/PixelDex/pixeldex.pyw     the window (pywebview, like v1)
    <out>/PixelDex/app/...          index.html, data.js, app.js, style.css, sprites/
    <out>/PixelDex/runtime/         portable Python (see --runtime)

Usage: python build.py [--jar PATH] [--out DIR] [--version 2]
"""
import argparse
import gzip
import json
import re
import shutil
import unicodedata
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_JAR = Path.home() / "curseforge/minecraft/Instances/After Pokopia/mods/Pixelmon-1.21.1-9.4.1-universal.jar"

CATEGORY_LABELS = {
    "standard": "Wild encounter", "grass": "Wild in tall grass", "headbutt": "Headbutt trees",
    "curry": "Curry camping site", "sweetscent": "Sweet Scent lure", "fishing": "Fishing",
    "legendaries": "Legendary encounter", "megas": "Mega Raid", "raid": "Raid Den",
    "caverock": "Rock Smash near caves", "rocksmash": "Rock Smash", "forage": "Foraging",
}
TIME_NAMES = {"DAWN": "Dawn", "MORNING": "Morning", "DAY": "Day", "MIDDAY": "Midday",
              "AFTERNOON": "Afternoon", "DUSK": "Dusk", "NIGHT": "Night", "MIDNIGHT": "Midnight"}

FORM_NAMES = {"base": "Normal", "mega": "Mega", "megax": "Mega X", "megay": "Mega Y", "gmax": "Gigantamax",
              "primal": "Primal", "phd": "Ph.D."}

# Pixelmon lists these pre-evolutions without a matching "evolves into" entry; they are real.
SPECIAL_EDGES = [("Nincada", "base", "Shedinja", "base", "appears when Nincada evolves with a spare party slot and a Poké Ball")]


def title(s):
    return " ".join(w.capitalize() for w in re.split(r"[_\s]+", s) if w)


def norm(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


class Strings:
    def __init__(self):
        self.list, self.idx = [], {}

    def __call__(self, s):
        if s not in self.idx:
            self.idx[s] = len(self.list)
            self.list.append(s)
        return self.idx[s]


def parse_spec(spec):
    out = {}
    for tok in spec.split():
        if ":" in tok:
            k, v = tok.split(":", 1)
            out[k.lower()] = v
        else:
            out.setdefault("species", tok)
    return out


def evo_text(e, lang_item):
    bits = []
    if e.get("level"):
        bits.append(f"Level {e['level']}")
    if e.get("item"):
        bits.append("use " + lang_item(e["item"].get("itemID", "")))
    if e.get("evoType") == "trade":
        bits.append("trade" + (f" with {e['with']}" if e.get("with") else ""))
    for c in e.get("conditions") or []:
        t = c.get("evoConditionType")
        if t == "time":
            bits.append(f"at {c['time'].lower()}")
        elif t == "friendship":
            bits.append("high friendship")
        elif t == "heldItem":
            bits.append("holding " + lang_item(c["item"].get("itemID", "")))
        elif t == "biome":
            bits.append("in " + ", ".join(title(b.split(":")[-1].split("/")[-1]) for b in c["biomes"][:3]))
        elif t == "move":
            bits.append(f"knowing {c['attackName']}")
        elif t == "moveType":
            bits.append(f"knowing a {title(c['type'])} move")
        elif t == "moveUses":
            bits.append(f"use {c['move']} {c['uses']} times")
        elif t == "gender":
            bits.append(" / ".join(g.lower() for g in c["genders"]) + " only")
        elif t == "weather":
            bits.append(f"in {c['weather'].lower()} weather")
        elif t == "party":
            w = (c.get("withPokemon") or []) + [title(x) for x in (c.get("withTypes") or [])]
            if w:
                bits.append("with " + ", ".join(w) + " in party")
            for fm in c.get("withForms") or []:
                bits.append(f"with an {title(fm)} Pokémon in party")
        elif t == "evolutionRock":
            bits.append("near a " + title(c["evolutionRock"]))
        elif t == "evolutionScroll":
            bits.append(f"at the Scroll of {title(c['evolutionScroll'])}")
        elif t == "statRatio":
            bits.append(f"{title(c['stat1'])} vs {title(c['stat2'])}")
        elif t == "chance":
            bits.append(f"{round(c['chance'] * 100)}% chance")
        elif t == "highAltitude":
            bits.append(f"above Y={int(c['minAltitude'])}")
        elif t == "nuggets":
            bits.append(f"{c['nuggets']} nuggets")
        elif t == "gimmighoulCoins":
            bits.append(f"{c['amount']} Gimmighoul coins")
        elif t == "blocksWalkedOutsideBall":
            bits.append(f"walk {c['blocksToWalk']} blocks with it out")
        elif t == "recoil":
            bits.append(f"take {c['recoil']} recoil damage")
        elif t == "healthAbsence":
            bits.append(f"lose {c['health']} HP")
        elif t == "critical":
            bits.append(f"land {c['critical']} critical hits in one battle")
        elif t == "status":
            bits.append(f"while {c['type'].lower()}ed")
        elif t == "nature":
            bits.append("certain natures")
        elif t == "insideBattle":
            bits.append("after a battle")
        elif t == "hasPalette":
            bits.append(" / ".join(title(p) for p in c["possiblePalettes"]) + " palette")
    if not bits:
        bits.append({"leveling": "level up", "interact": "use an item", "ticking": "over time"}.get(e.get("evoType"), e.get("evoType", "")))
    return ", ".join(bits)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jar", default=str(DEFAULT_JAR))
    ap.add_argument("--out", default=str(Path("H:/HomeDashboard/work/pixeldex2/out")))
    ap.add_argument("--version", default="2.1")
    ap.add_argument("--runtime", default="H:/HomeDashboard/work/pixeldex2/runtime",
                    help="portable Python (embeddable 3.12 + pywebview) copied in as runtime/")
    a = ap.parse_args()

    z = zipfile.ZipFile(a.jar)
    names = set(z.namelist())
    lang = json.loads(z.read("assets/pixelmon/lang/en_us.json").decode("utf-8"))
    pixelmon_version = re.search(r"Pixelmon-[\d.]+-([\d.]+)", Path(a.jar).name)
    pixelmon_version = pixelmon_version.group(1) if pixelmon_version else "?"

    def lang_item(item_id):
        ns, _, path = item_id.partition(":")
        return lang.get(f"item.{ns}.{path}") or title(path)

    def struct_name(sid):
        ns, _, path = sid.partition(":")
        return lang.get(f"structure.{ns}.{path}") or lang.get(f"structure.{ns}.{path.replace('/', '.')}") or title(path.split("/")[-1])

    out = Path(a.out) / "PixelDex"
    if out.exists():
        shutil.rmtree(out)
    (out / "app" / "sprites").mkdir(parents=True)

    species = {}
    for n in sorted(names):
        if n.startswith("data/pixelmon/species/") and n.endswith(".json"):
            d = json.loads(z.read(n).decode("utf-8"))
            if d["dex"] > 0:
                species[d["name"]] = d
    by_lower = {k.lower(): k for k in species}

    v1 = json.loads(gzip.open(HERE / "baseline" / "v1_spawns.json.gz", "rt", encoding="utf-8").read())

    # --- structure spawns straight from Pixelmon's spawn sets ---
    struct_spawns = {}  # (species, form) -> rows
    for n in sorted(names):
        if not (n.startswith("data/pixelmon/spawning/") and n.endswith(".json")):
            continue
        cat = n.split("/")[3]
        if cat == "npcs":
            continue
        try:
            d = json.loads(z.read(n).decode("utf-8"))
        except ValueError:
            continue
        for info in d.get("spawnInfos", []):
            cond = info.get("condition") or {}
            if not cond.get("structures") or info.get("typeID", "pokemon") != "pokemon":
                continue
            spec = parse_spec(info.get("spec", ""))
            sp = by_lower.get(spec.get("species", "").lower())
            if not sp:
                continue
            form = spec.get("form", "base").lower()
            reqs = [", ".join(title(x) for x in info.get("stringLocationTypes", []))]
            if info.get("minLevel"):
                reqs.append(f"Lv {info['minLevel']}-{info.get('maxLevel', info['minLevel'])}")
            if cond.get("biomes"):
                reqs.append("only in some biomes")
            times = [TIME_NAMES.get(t, title(t)) for t in cond.get("times", [])] or ["Any time"]
            for sid in cond["structures"]:
                struct_spawns.setdefault((sp, form), []).append({
                    "structure": struct_name(sid), "category": cat,
                    "time": " / ".join(times), "requirements": [r for r in reqs if r], "rarity": info.get("rarity"),
                })

    S = Strings()
    sprite_cache = {}
    missing_sprites = []

    def sprite(path):
        if not path:
            return None
        if path in sprite_cache:
            return sprite_cache[path]
        ns, _, p = path.partition(":")
        src = f"assets/{ns}/textures/{p}"
        if src not in names:
            missing_sprites.append(path)
            sprite_cache[path] = None
            return None
        parts = p.split("/")[1:]  # drop "pokemon"
        if parts[-1] == "sprite.png":
            parts = parts[:-1]
        fn = "-".join(parts) + ".png"
        (out / "app" / "sprites" / fn).write_bytes(z.read(src))
        sprite_cache[path] = fn
        return fn

    edges = []  # (from species, from form, to species, to form, text)
    out_species = []
    for name, d in sorted(species.items(), key=lambda kv: kv[1]["dex"]):
        dex = d["dex"]
        lk = name.lower().replace(" ", "").replace("-", "").replace(".", "").replace("'", "").replace(":", "")
        display = lang.get(f"pixelmon.{lk}") or name
        forms_out = []
        v1forms = v1.get(str(dex), {})
        is_leg = False
        for fm in d["forms"]:
            fname = fm["name"]
            tags = fm.get("tags") or []
            if "legendary" in tags or "mythical" in tags:
                is_leg = True
            pals = []
            for gp in fm.get("genderProperties") or []:
                g = gp["gender"]
                for p in gp["palettes"]:
                    pals.append([S(p["name"]), {"ALL": 0, "MALE": 1, "FEMALE": 2}.get(g, 0), sprite(p.get("sprite"))])
            # default picture for this form: "none" palette, else first non-shiny one with a sprite
            pals_ok = [p for p in pals if p[2]]
            main = next((p for p in pals_ok if S.list[p[0]] == "none"), None) \
                or next((p for p in pals_ok if "shiny" not in S.list[p[0]]), None) \
                or (pals_ok[0] if pals_ok else None)
            for e in fm.get("evolutions") or []:
                to = parse_spec(e.get("to", ""))
                tsp = by_lower.get(to.get("species", e.get("to", "").split(" ")[0]).lower())
                if tsp:
                    edges.append((name, fname, tsp, to.get("form", "base").lower(), evo_text(e, lang_item)))
            spawns = []
            for r in v1forms.get(fname, []):
                spawns.append([S(r["category"]), S(r["biome"]), S(r["time"]), r["percent"],
                               S(" · ".join(r["requirements"]))])
            st = [[S(r["structure"]), S(r["category"]), S(r["time"]), S(" · ".join(r["requirements"]))]
                  for r in struct_spawns.get((name, fname), [])]
            fdisp = lang.get(f"pixelmon.{lk}.form.{fname}") or FORM_NAMES.get(fname) or title(fname)
            forms_out.append({
                "n": fname, "dn": fdisp, "t": [title(t) for t in fm.get("types") or []],
                "eg": [title(x) for x in fm.get("eggGroups") or []], "s": main[2] if main else None,
                "p": pals, "sp": spawns, "st": st, "tags": [t for t in tags if t in ("mega", "gmax", "temp")],
            })
        out_species.append({"d": dex, "n": display, "k": name, "q": norm(display + " " + name),
                             "g": d.get("generation"), "df": (d.get("defaultForms") or [d["forms"][0]["name"]])[0],
                             "leg": is_leg, "f": forms_out})

    for a_, af, b, bf, txt in SPECIAL_EDGES:
        edges.append((a_, af, b, bf, txt))
    # collapse duplicate edges (Pixelmon lists one per palette/condition variant)
    seen, ev = set(), []
    for e in edges:
        key = (e[0], e[2], e[3])
        if key in seen:
            continue
        seen.add(key)
        ev.append([e[0], e[1], e[2], e[3], e[4]])

    pal_names = {s: ("Normal" if s == "none" else lang.get(f"pixelmon.palette.{s}") or title(s))
                 for s in S.list}
    data = {"version": a.version, "pixelmon": pixelmon_version, "strings": S.list, "palNames": pal_names,
            "catLabels": CATEGORY_LABELS, "species": out_species, "evo": ev}
    (out / "app" / "data.js").write_text("window.PIXELDEX_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    for f in ("app.js", "style.css", "nbt.js"):
        shutil.copy(HERE / "web" / f, out / "app" / f)
    # the page lives in app/ and is opened in its own window by pixeldex.pyw (started from PixelDex.vbs)
    html = (HERE / "web" / "PixelDex.html").read_text(encoding="utf-8").replace('"app/', '"')
    (out / "app" / "index.html").write_text(html, encoding="utf-8")
    shutil.copy(HERE / "web" / "pixeldex.pyw", out / "pixeldex.pyw")
    for f in ("PixelDex.vbs", "Start PixelDex (backup).bat", "README.txt"):   # Windows line endings for these
        text = (HERE / "web" / f).read_text(encoding="utf-8").replace(chr(13) + chr(10), chr(10))
        (out / f).write_bytes(text.replace(chr(10), chr(13) + chr(10)).encode("utf-8"))
    if Path(a.runtime).is_dir():
        shutil.copytree(a.runtime, out / "runtime", ignore=shutil.ignore_patterns("__pycache__", "bin"))
    else:
        print("WARNING: no portable Python runtime at", a.runtime)
    print(f"species {len(out_species)}  sprites {sum(1 for v in sprite_cache.values() if v)}  "
          f"missing {len(missing_sprites)}  structure rows {sum(len(v) for v in struct_spawns.values())}  edges {len(ev)}")
    for m in missing_sprites[:20]:
        print("  missing sprite:", m)


if __name__ == "__main__":
    main()
