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


def lc_key(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def y_text(lo, hi):
    """Joseph's wiki style: 'Min Y 100' / 'Max Y 70' / both."""
    bits = []
    if lo is not None:
        bits.append(f"Min Y {int(lo)}")
    if hi is not None:
        bits.append(f"Max Y {int(hi)}")
    return " · ".join(bits)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jar", default=str(DEFAULT_JAR))
    ap.add_argument("--out", default=str(Path("H:/HomeDashboard/work/pixeldex2/out")))
    ap.add_argument("--version", default="2.3.1")
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

    # --- every spawn entry, for the "Where to find" table (Y limits etc. straight from Pixelmon's own data) ---
    def biome_tag_members(tag, seen=None):
        """'#pixelmon:spawning/mountainous' -> {'minecraft:jagged_peaks', 'terralith:alpine_highlands', ...}"""
        seen = seen if seen is not None else set()
        if tag in seen:
            return set()
        seen.add(tag)
        ns, _, path = tag[1:].partition(":")
        fn = f"data/{ns}/tags/worldgen/biome/{path}.json"
        if fn not in names:
            return set()
        found = set()
        for v in json.loads(z.read(fn).decode("utf-8")).get("values", []):
            v = v["id"] if isinstance(v, dict) else v
            found |= biome_tag_members(v, seen) if v.startswith("#") else {v}
        return found

    def biome_label(b):
        if b.startswith("#"):
            return title(b.split("/")[-1].split(":")[-1])
        ns, _, path = b.partition(":")
        return lang.get(f"biome.{ns}.{path}") or title(path)

    def block_name(b):
        ns, _, path = b.partition(":")
        return lang.get(f"block.{ns}.{path}") or title(path)

    moon = ["Full moon", "Waning gibbous", "Last quarter", "Waning crescent", "New moon", "Waxing crescent", "First quarter", "Waxing gibbous"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    times_of = lambda ts: "/".join(TIME_NAMES.get(x, title(x)) for x in ts)

    def conditions_of(info, cond, anti, spec):
        """Everything besides biome/time/weather/location that limits where it spawns -> short phrases."""
        bits = []
        lo, hi = cond.get("minY", info.get("minY")), cond.get("maxY", info.get("maxY"))
        if lo is not None or hi is not None:
            bits.append(y_text(lo, hi))
        if anti.get("minY") is not None:     # anticondition = must NOT be in that range
            bits.append(f"Below Y {int(anti['minY'])}")
        if anti.get("maxY") is not None:
            bits.append(f"Above Y {int(anti['maxY'])}")
        if cond.get("maxLightLevel") is not None:
            bits.append(f"Light level {int(cond['maxLightLevel'])} or less")
        if cond.get("structures"):
            bits.append("Inside " + ", ".join(struct_name(s) for s in cond["structures"]))
        if cond.get("neededNearbyBlocks"):
            bits.append("Near " + " / ".join(block_name(b) for b in cond["neededNearbyBlocks"]))
        if cond.get("baseBlock"):
            bits.append("On " + " / ".join(block_name(b) for b in cond["baseBlock"][:2]))
        if cond.get("moonPhase") is not None:
            mp = cond["moonPhase"]
            bits.append(moon[mp] if isinstance(mp, int) and 0 <= mp < 8 else f"Moon phase {mp}")
        if cond.get("variant"):
            bits.append("Trees: " + ", ".join(title(v) for v in cond["variant"]))
        if cond.get("partyHeadSpecies"):
            bits.append(" / ".join(cond["partyHeadSpecies"]) + " leading your party")
        if cond.get("realWorldSpawnTimes"):
            ms = sorted({m.get("monthOfYear") for m in cond["realWorldSpawnTimes"] if m.get("monthOfYear")})
            bits.append("Real-world date: " + ", ".join(months[m - 1] for m in ms))
        dims = [d for d in cond.get("dimensions") or [] if d != "minecraft:overworld"]
        if dims:
            bits.append("Dimension: " + ", ".join(title(d.split(":")[-1]) for d in dims))
        not_in = (anti.get("biomes") or []) + (anti.get("stringBiomes") or [])
        if not_in:
            bits.append("Not in " + ", ".join(biome_label(b) for b in not_in[:3]) + (f" +{len(not_in) - 3}" if len(not_in) > 3 else ""))
        if anti.get("times"):
            bits.append("Not at " + times_of(anti["times"]))
        if spec.get("palette") and spec["palette"] != "none":
            bits.append(f"{lang.get('pixelmon.palette.' + spec['palette']) or title(spec['palette'])} palette")
        if spec.get("gender"):
            bits.append(title(spec["gender"]) + " only")
        for m in info.get("rarityMultipliers") or []:
            c = m.get("condition") or {}
            what = []
            if c.get("times"):
                what.append(times_of(c["times"]))
            if c.get("weathers"):
                what.append("/".join(title(x) for x in c["weathers"]) + " weather")
            if c.get("neededNearbyBlocks"):
                what.append("near " + " / ".join(block_name(b) for b in c["neededNearbyBlocks"]))
            if c.get("minY") is not None or c.get("maxY") is not None:
                what.append(y_text(c.get("minY"), c.get("maxY")))
            if what and m.get("multiplier"):
                bits.append(f"x{m['multiplier']:g} more often: " + ", ".join(what))
        return bits

    by_sp_entries = {}   # (species, form) -> [entry]
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
            if info.get("typeID", "pokemon") != "pokemon":
                continue
            spec = parse_spec(info.get("spec", ""))
            sp = by_lower.get(spec.get("species", "").lower())
            if not sp:
                continue
            form = spec.get("form", "base").lower()
            if form not in {f["name"] for f in species[sp]["forms"]}:   # e.g. Unown/Burmy entries without a form -> default form
                form = (species[sp].get("defaultForms") or [species[sp]["forms"][0]["name"]])[0]
            cond, anti = info.get("condition") or {}, info.get("anticondition") or {}
            biomes = (cond.get("biomes") or []) + (cond.get("stringBiomes") or [])
            members = set()
            for b in biomes:
                members |= biome_tag_members(b) if b.startswith("#") else {b}
            tags_ = info.get("tags") or []
            held = [f"{lang_item(h.get('itemID', ''))} ({h['percentChance']:g}%)" if h.get("percentChance") is not None
                    else lang_item(h.get("itemID", "")) for h in info.get("heldItems") or []]
            by_sp_entries.setdefault((sp, form), []).append({
                "cat": cat, "rarity": info.get("rarity"),
                "groups": [biome_label(b) for b in biomes],
                "members": {lc_key(m.split(":")[-1]) for m in members},
                "times": [TIME_NAMES.get(x, title(x)) for x in cond.get("times", [])],
                "weather": [title(x) for x in cond.get("weathers", [])],
                "loc": ", ".join(info.get("stringLocationTypes", [])),
                "lv": f"Lv {info['minLevel']}-{info.get('maxLevel', info['minLevel'])}" if info.get("minLevel") else "",
                "held": held, "cond": conditions_of(info, cond, anti, spec),
                "tag": "Mythical" if "mythical" in tags_ else "Legendary" if ("legendary" in tags_ or cat == "legendaries")
                       else "Mega Raid" if cat == "megas" else "Boss" if spec.get("boss") else "",
            })

    def attach_v1(entries, rows):
        """Give each Pixelmon spawn entry the v1 per-biome % rows that belong to it; returns the rows left over."""
        left = []
        for r in rows:
            reqs = r["requirements"]
            lv = next((q for q in reqs if q.startswith("Lv ")), "")
            loc = reqs[0] if reqs and not reqs[0].startswith(("Lv ", "Tier ")) else ""
            cands = [e for e in entries if e["cat"] == r["category"] and e["loc"] == loc and e["lv"] == lv and e["rarity"] == r["rarity"]]
            if not cands or r["category"] == "raid":
                left.append(r)
                continue
            fit = [e for e in cands if (not e["times"] if r["time"] == "Any time" else (not e["times"] or r["time"] in e["times"]))] or cands
            if len(fit) > 1:
                fit = [e for e in fit if lc_key(r["biome"]) in e["members"]] or fit
            fit[0]["v1"].append(r)
        return left

    def biome_detail(rows):
        best = {}
        for r in rows:
            if r.get("percent") is not None:
                best[r["biome"]] = max(best.get(r["biome"], 0), r["percent"])
        return best, ";".join(f"{b}|{p:g}" for b, p in sorted(best.items(), key=lambda kv: (-kv[1], kv[0])))

    # table row: [category, biome groups, "biome|%;...", time, location, weather, conditions, % low, % high, tag, level, held item]
    def table_row(e):
        pcts = [r["percent"] for r in e["v1"] if r.get("percent") is not None]
        _, detail = biome_detail(e["v1"])
        groups = e["groups"] or ([] if any(c.startswith("Inside ") for c in e["cond"]) else ["Any biome"])
        return [S(e["cat"]), S(", ".join(groups)), S(detail), S("/".join(e["times"]) or "Any"), S(e["loc"]),
                S("/".join(e["weather"])), S(" · ".join(e["cond"])), min(pcts) if pcts else None,
                max(pcts) if pcts else None, S(e["tag"]), S(e["lv"]), S(", ".join(e["held"]))]

    def v1_table_rows(rows):
        """Rows with no matching Pixelmon entry (mostly raid dens): one table row per kind, the biomes listed inside."""
        g = {}
        for r in rows:
            reqs = r["requirements"]
            lv = next((q for q in reqs if q.startswith("Lv ")), "")
            tier = next((q for q in reqs if q.startswith("Tier ")), "")
            g.setdefault((r["category"], tier, lv, tuple(q for q in reqs if q not in (lv, tier))), []).append(r)
        found = []
        for (cat, tier, lv, rest), rs in g.items():
            best, detail = biome_detail(rs)
            times = {r["time"] for r in rs}
            pcts = [r["percent"] for r in rs if r["percent"] is not None]
            loc = "Raid Den" if cat == "raid" else (rest[0] if rest else "")
            cond = [x for x in (tier,) + (rest if cat == "raid" else rest[1:]) if x]
            found.append([S(cat), S(f"{len(best)} biomes" if len(best) > 1 else next(iter(best), "")), S(detail),
                          S("Any" if "Any time" in times or not times else "/".join(sorted(times))), S(loc), S(""),
                          S(" · ".join(cond)), min(pcts) if pcts else None, max(pcts) if pcts else None,
                          S("Raid" if cat == "raid" else ""), S(lv), S("")])
        return found

    # --- "How to summon": Pokemon that come from shrines/altars/items, built from the jar's recipes, structures and drops ---
    def item_name(i):
        ns, _, path = i.partition(":")
        return lang.get(f"item.{ns}.{path}") or lang.get(f"block.{ns}.{path}") or title(path)

    def recipe_text(name):
        fn = f"data/pixelmon/recipe/summon/{name}.json"
        if fn not in names:
            fn = f"data/pixelmon/recipe/{name}.json"
        if fn not in names:
            return ""
        r = json.loads(z.read(fn).decode("utf-8"))
        if r.get("type", "").endswith("shapeless"):
            return " + ".join(item_name(x["item"]) for x in r["ingredients"])
        counts = {}
        for row in r["pattern"]:
            for ch in row:
                if ch.strip():
                    counts[ch] = counts.get(ch, 0) + 1
        return " + ".join(f"{n_}x {item_name(r['key'][ch]['item'])}" for ch, n_ in counts.items())

    def structure_where(path):
        fn = f"data/pixelmon/worldgen/structure/{path}.json"
        sname = lang.get(f"structure.pixelmon.{path}") or title(path.split("/")[-1])
        if fn not in names:
            return sname
        b = json.loads(z.read(fn).decode("utf-8")).get("biomes")
        b = b if isinstance(b, str) else (b[0] if b else "")
        where = title(b.split(":")[-1].replace("has_structure/", "").replace("is_", "").replace("mineshaft_", "")) if b else ""
        return f"{sname} ({where} biomes)" if where else sname

    pokedrops = json.loads(z.read("data/pixelmon/drops/pokedrops.json").decode("utf-8"))

    def dropped_by(item, limit=6):
        who = []
        for e in pokedrops if isinstance(pokedrops, list) else pokedrops.get("drops", []):
            for it in e.get("items", []):
                if it.get("item") == item:
                    who.append((e["pokemon"].split(" ")[0], it.get("chance", 0)))
        seen_, out_ = set(), []
        for w, c in who:
            if w not in seen_:
                seen_.add(w)
                out_.append(f"{w} ({c * 100:g}%)" if c else w)
        more = f" and {len(out_) - limit} more" if len(out_) > limit else ""
        return ", ".join(out_[:limit]) + more

    raid_tiers = sorted({int(k) for k, v in json.loads(z.read("data/pixelmon/drops/raiddrops.json").decode("utf-8")).items()
                         if "pixelmon:orb" in json.dumps(v)})
    orb_from = (f"Plain Orb: dropped by {dropped_by('pixelmon:orb', 5)}; also from {raid_tiers[0]}-{raid_tiers[-1]}★ raid rewards and Poké Loot"
                if raid_tiers else f"Plain Orb: dropped by {dropped_by('pixelmon:orb', 5)}")
    once = "Each shrine/altar can be used once per real-life day (Pixelmon's \"shrine-encounter-mode\" setting, default)."

    def bird(name, orb, stone_type, shrine):
        return {"title": f"Summoned at the {lang.get('block.pixelmon.' + shrine[1]) or title(shrine[1])}", "steps": [
            f"Find the {structure_where(shrine[0])}.",
            f"Craft the {item_name('pixelmon:' + orb)}: {recipe_text(orb)}.",
            orb_from + ".",
            f"Fill the orb by defeating {stone_type}-type Pokémon with it in your inventory (it shows how many KOs are left).",
            f"Use the full orb on the shrine and {name} appears. {once}",
            f"This is for the normal {name}; Galarian {name} only comes from raids."]}

    timespace = structure_where("temples/spear_pillar")
    chain = (f"Bind the altar with a Red Chain: {recipe_text('red_chain')}. Each Ruby is infused by your own Azelf / Mesprit / Uxie "
             "(it must trust you, be friendly enough and a high enough level; each one can only infuse a few).")
    SUMMON = {
        "Articuno": bird("Articuno", "uno_orb", "Ice", ("shrines/articuno", "shrineuno")),
        "Zapdos": bird("Zapdos", "dos_orb", "Electric", ("shrines/zapdos", "shrinedos")),
        "Moltres": bird("Moltres", "tres_orb", "Fire", ("shrines/moltres", "shrinetres")),
    }
    for nm, orb in (("Dialga", "adamant_orb"), ("Palkia", "lustrous_orb"), ("Giratina", "griseous_orb")):
        SUMMON[nm] = {"title": "Summoned at the Timespace Altar", "steps": [
            f"Find the Timespace Altar at the {timespace}.", chain,
            f"Place the {item_name('pixelmon:' + orb)} on the altar and {nm} appears. "
            f"The orb drops from {dropped_by('pixelmon:' + orb)} and is an Ultimate boss reward.", once]}
    SUMMON["Arceus"] = {"title": "Summoned with the Azure Flute", "steps": [
        f"Find an Arc Chalice in the {structure_where('temples/land_chalice')} or the {structure_where('temples/water_chalice')}.",
        "Add every type Plate to the Arc Chalice (it tells you how many are left; Plates come from Poké Loot) — it creates the Azure Flute.",
        f"Bind the Timespace Altar at the {timespace} with a Red Chain ({recipe_text('red_chain')}).",
        f"Play the Azure Flute at the altar and Arceus appears. Arceus drops the {item_name('pixelmon:legend_plate')}.", once]}
    SUMMON["Celebi"] = {"title": "Summoned at the Ilex Shrine", "steps": [
        f"Find the {structure_where('shrines/ilex')}.",
        "Use a GS Ball on the Ilex Shrine and Celebi appears (the GS Ball has no recipe in Pixelmon's data files).", once]}
    for nm, bell in (("Lugia", "tidal_bell"), ("Ho-Oh", "clear_bell")):
        SUMMON[nm] = {"title": f"Called by the {item_name('pixelmon:' + bell)}", "steps": [
            f"Place a {item_name('pixelmon:' + bell)}.",
            f"At dawn the bell has a small chance to start ringing (Pixelmon's default: 1%) and call {nm}; "
            "other bells within 10 blocks join in.",
            "How to get the bell isn't listed in Pixelmon's data files (no recipe there)."]}
    SUMMON["Zygarde"] = {"title": "Assembled from Zygarde Cells", "steps": [
        f"Craft a Zygarde Cube: {recipe_text('zygarde_cube')}.",
        "Collect Zygarde Cells and Cores, which appear in the world on their own; the cube holds 100 cells and 5 cores.",
        "Use the cube on a Reassembly Unit (needs at least one Core): 10 cells = Zygarde 10%, 50 cells = Zygarde 50%, "
        "100 cells = Zygarde 50% with Power Construct."]}
    SUMMON["Meltan"] = {"title": "From a Mystery Box", "steps": [
        f"Craft a Mystery Box: {recipe_text('mystery_box') or 'Ruby + Sapphire + Nether Star + 6 Netherite Scrap'}.",
        "Open it (it needs scraps, more each time); each opening has a 1 in 300 chance (Pixelmon default) to make a Meltan "
        "appear within 15 blocks. The box then cools down for about 50 minutes."]}
    SUMMON["Mewtwo"] = {"title": "Made in the Cloning Machine", "steps": [
        "Build a Cloning Machine (one of its parts is the Cloner Cord).",
        "Insert a Mew and a catalyst, then start it — the clone is Mewtwo."]}

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
            # the "Where to find" table: one row per Pixelmon spawn entry (+ v1 rows Pixelmon has no entry for)
            mine = by_sp_entries.get((name, fname), [])
            for e in mine:
                e["v1"] = []
            left = attach_v1(mine, v1forms.get(fname, []))
            tb = [table_row(e) for e in mine] + v1_table_rows(left)
            fdisp = lang.get(f"pixelmon.{lk}.form.{fname}") or FORM_NAMES.get(fname) or title(fname)
            forms_out.append({
                "n": fname, "dn": fdisp, "t": [title(t) for t in fm.get("types") or []],
                "eg": [title(x) for x in fm.get("eggGroups") or []], "s": main[2] if main else None,
                "p": pals, "sp": spawns, "st": st, "tb": tb, "tags": [t for t in tags if t in ("mega", "gmax", "temp")],
            })
        out_species.append({"d": dex, "n": display, "k": name, "q": norm(display + " " + name),
                             "g": d.get("generation"), "df": (d.get("defaultForms") or [d["forms"][0]["name"]])[0],
                             "leg": is_leg, "f": forms_out, **({"sm": SUMMON[name]} if name in SUMMON else {})})

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
    html = (HERE / "web" / "PixelDex.html").read_text(encoding="utf-8").replace('"app/', '"') \
        .replace("<title>PixelDex</title>", f"<title>PixelDex v{a.version}</title>")
    (out / "app" / "index.html").write_text(html, encoding="utf-8")
    (out / "pixeldex.pyw").write_text((HERE / "web" / "pixeldex.pyw").read_text(encoding="utf-8")
                                      .replace('VERSION = "dev"', f'VERSION = "{a.version}"'), encoding="utf-8")
    for f in ("PixelDex.vbs", "Start PixelDex (backup).bat", "README.txt"):   # Windows line endings for these
        text = (HERE / "web" / f).read_text(encoding="utf-8").replace(chr(13) + chr(10), chr(10)).replace("{VERSION}", a.version)
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
