// PixelDex v2 — runs straight from the folder (file://), no server.
const D = window.PIXELDEX_DATA;
const S = D.strings;
const SPRITES = document.currentScript.src.replace(/app\.js([?#].*)?$/, '') + 'sprites/';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(4, '0');
const GENDER_MARK = ['', ' ♂', ' ♀'];
const REGION_NAMES = { 1: 'Kanto', 2: 'Johto', 3: 'Hoenn', 4: 'Sinnoh', 5: 'Unova', 6: 'Kalos', 7: 'Alola', 8: 'Galar', 9: 'Paldea' };
const RAID_CATS = new Set(['raid', 'megas']);
const isShinyPal = name => name.includes('shiny');
const palName = idx => D.palNames[S[idx]] || S[idx];

// ---------- storage (per-browser; wrapped so a blocked storage never breaks the page) ----------
const store = {
  get(k, dflt) { try { const v = localStorage.getItem('pixeldex.' + k); return v == null ? dflt : JSON.parse(v); } catch { return dflt; } },
  set(k, v) {
    try { localStorage.setItem('pixeldex.' + k, JSON.stringify(v)); } catch { /* ignore */ }
    if (window.pywebview && window.pywebview.api) window.pywebview.api.save_setting(k, JSON.stringify(v));   // desktop: also to userdata/settings.json
  },
};
let manual = new Set(store.get('manual', []).map(String));
let picks = store.get('picks', {});
let saveCache = store.get('save', null); // {world, player, at, rows: [[ndex, form, palette, caught, seen]]}

// ---------- species / forms indexes ----------
const species = D.species;
const byDex = new Map(species.map(s => [s.d, s]));
const byKey = new Map(species.map(s => [s.k, s]));
for (const sp of species) {
  sp.defForm = sp.f.find(f => f.n === sp.df) || sp.f[0];
  for (const f of sp.f) {
    f.wild = f.sp.filter(r => !RAID_CATS.has(S[r[0]]));
    f.raid = f.sp.filter(r => RAID_CATS.has(S[r[0]]));
  }
  sp.hasWild = sp.f.some(f => f.wild.length);
  sp.hasStruct = sp.f.some(f => f.st.length);
  sp.structOnly = !sp.hasWild && sp.hasStruct;
  const places = new Set();
  for (const f of sp.f) {
    for (const r of f.sp) if (S[r[1]] !== 'Any valid location') places.add(S[r[1]]);
    for (const r of f.st) places.add('Structure: ' + S[r[0]]);
  }
  sp.places = places;
}

// evolution graph (species level, with form + how-to text on each edge)
const evoOut = new Map(), evoIn = new Map();
for (const [a, af, b, bf, txt] of D.evo) {
  if (!byKey.has(a) || !byKey.has(b) || a === b) continue;
  (evoOut.get(a) || evoOut.set(a, []).get(a)).push({ to: b, fromForm: af, toForm: bf, txt });
  (evoIn.get(b) || evoIn.set(b, []).get(b)).push({ from: a, fromForm: af, toForm: bf, txt });
}

function family(key) {
  const seen = new Set([key]), q = [key];
  while (q.length) {
    const k = q.shift();
    for (const e of evoOut.get(k) || []) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    for (const e of evoIn.get(k) || []) if (!seen.has(e.from)) { seen.add(e.from); q.push(e.from); }
  }
  // stage = longest chain of pre-evolutions inside the family
  const stage = new Map();
  const depth = k => {
    if (stage.has(k)) return stage.get(k);
    stage.set(k, 0);
    const ins = (evoIn.get(k) || []).filter(e => seen.has(e.from));
    const d = ins.length ? 1 + Math.max(...ins.map(e => depth(e.from))) : 0;
    stage.set(k, d);
    return d;
  };
  [...seen].forEach(depth);
  const stages = [];
  for (const k of seen) (stages[stage.get(k)] ||= []).push(byKey.get(k));
  stages.forEach(col => col.sort((x, y) => x.d - y.d));
  return stages;
}

function ancestors(key) {               // nearest first -> base last, then reversed so the base comes first
  const out = [], seen = new Set([key]);
  let layer = [key];
  while (layer.length) {
    const next = [];
    for (const k of layer) for (const e of evoIn.get(k) || []) if (!seen.has(e.from)) { seen.add(e.from); next.push(e.from); }
    out.push(...next);
    layer = next;
  }
  return out.reverse().map(k => byKey.get(k));
}
function descendants(key) {             // next stage first, then the stages after it
  const out = [], seen = new Set([key]);
  let layer = [key];
  while (layer.length) {
    const next = [];
    for (const k of layer) for (const e of evoOut.get(k) || []) if (!seen.has(e.to)) { seen.add(e.to); next.push(e.to); }
    next.sort((a, b) => byKey.get(a).d - byKey.get(b).d);
    out.push(...next);
    layer = next;
  }
  return out.map(k => byKey.get(k));
}

// ---------- caught status ----------
let saveSets = { sp: new Set(), form: new Set(), pal: new Set(), seen: new Set() };
function rebuildSaveSets() {
  saveSets = { sp: new Set(), form: new Set(), pal: new Set(), seen: new Set() };
  for (const [n, form, pal, caught, seen] of (saveCache && saveCache.rows) || []) {
    if (seen || caught) saveSets.seen.add(n);
    if (!caught) continue;
    saveSets.sp.add(String(n));
    saveSets.form.add(`${n}|${form}`);
    saveSets.pal.add(`${n}|${form}|${pal}`);
  }
}
const manualPrefix = p => { for (const k of manual) if (k === p || k.startsWith(p + '|')) return true; return false; };
const caughtSpecies = dex => saveSets.sp.has(String(dex)) || manualPrefix(String(dex));
const caughtForm = (dex, form) => saveSets.form.has(`${dex}|${form}`) || manualPrefix(`${dex}|${form}`);
const caughtPal = (dex, form, pal) => saveSets.pal.has(`${dex}|${form}|${pal}`) || manual.has(`${dex}|${form}|${pal}`);
function toggleManual(key) {
  manual.has(key) ? manual.delete(key) : manual.add(key);
  store.set('manual', [...manual]);
  refreshAll();
}

// ---------- pictures ----------
function lookFor(sp) {
  const mode = $('lookMode').value;
  if (mode === 'picks' && picks[sp.d]) {
    const [fn, pal, g] = picks[sp.d].split('|');
    const f = sp.f.find(x => x.n === fn);
    const p = f && f.p.find(x => S[x[0]] === pal && String(x[1]) === g && x[2]);
    if (p) return { sprite: p[2], form: f, pal };
  }
  const f = sp.defForm;
  if (mode === 'shiny') {
    const p = f.p.find(x => S[x[0]] === 'shiny' && x[2]) || f.p.find(x => isShinyPal(S[x[0]]) && x[2]);
    if (p) return { sprite: p[2], form: f, pal: S[p[0]] };
  }
  const sprite = f.s || (sp.f.find(x => x.s) || {}).s;
  return { sprite, form: f, pal: 'none' };
}
const img = (file, cls = '') => `<img class="${cls}" src="${file ? SPRITES + file : ''}" loading="lazy" alt="" onerror="this.style.opacity=0">`;

// ---------- Pokédex tab ----------
let filtered = [];
function applyFilters() {
  const q = $('search').value.trim().toLowerCase();
  const place = $('biomeFilter').value, cf = $('caughtFilter').value;
  filtered = species.filter(sp => {
    if (q && !(sp.q.includes(q) || String(sp.d).includes(q))) return false;
    if (place && !sp.places.has(place)) return false;
    const c = caughtSpecies(sp.d);
    if (cf === 'caught' && !c) return false;
    if (cf === 'uncaught' && c) return false;
    return true;
  });
  renderGrid();
}
function renderGrid() {
  let html = '', lastGen = null;
  for (const sp of filtered) {
    if (sp.g !== lastGen) {
      html += `<div class="region-header">${REGION_NAMES[sp.g] || (sp.g ? 'Generation ' + sp.g : 'Other')}</div>`;
      lastGen = sp.g;
    }
    const c = caughtSpecies(sp.d);
    const look = lookFor(sp);
    html += `<div class="card ${c ? '' : 'uncaught'}" data-dex="${sp.d}">
      ${c ? '<span class="badge" title="Caught">●</span>' : ''}${sp.structOnly ? '<span class="tag-s" title="Only spawns in structures">S</span>' : ''}
      ${img(look.sprite)}
      <div class="dexnum">#${pad(sp.d)}</div><div class="name">${esc(sp.n)}</div></div>`;
  }
  $('grid').innerHTML = html || '<div class="hint pad">Nothing matches.</div>';
}

// ---------- Forms tab ----------
// Pokémon with a huge set of variants are left out of the Forms / Palettes tabs (too many to be useful there,
// e.g. Unown, Alcremie); their own page still shows every one.
const MAX_FORMS = 20, MAX_PALETTES = 30;
const SKIPPED_FORMS = species.filter(sp => sp.f.filter(f => f.s).length > MAX_FORMS);
const palCountOf = sp => sp.f.reduce((t, f) => t + f.p.filter(p => p[2] && S[p[0]] !== 'none' && !isShinyPal(S[p[0]])).length, 0);
const SKIPPED_PALS = species.filter(sp => palCountOf(sp) > MAX_PALETTES);
const FORM_ITEMS = [];
for (const sp of species) {
  if (sp.f.length < 2 || SKIPPED_FORMS.includes(sp)) continue;
  for (const f of sp.f) {
    if (!f.s || (f.n === 'base' && f.n === sp.df)) continue;
    const n = f.n;
    const kind = /alolan|galarian|hisuian|paldean/.test(n) ? 'regional'
      : (f.tags.includes('mega') || n.startsWith('mega')) ? 'mega'
      : (f.tags.includes('gmax') || n === 'gmax') ? 'gmax' : 'other';
    FORM_ITEMS.push({ sp, f, kind });
  }
}
function renderForms() {
  const q = $('formSearch').value.trim().toLowerCase(), kind = $('formKind').value, cf = $('formCaught').value;
  const items = FORM_ITEMS.filter(({ sp, f, kind: k }) => {
    if (q && !(sp.q.includes(q) || String(sp.d).includes(q) || f.dn.toLowerCase().includes(q))) return false;
    if (kind && k !== kind) return false;
    const c = caughtForm(sp.d, f.n);
    return !(cf === 'caught' && !c) && !(cf === 'uncaught' && c);
  });
  $('formCount').textContent = `${items.length} forms · ${items.filter(i => caughtForm(i.sp.d, i.f.n)).length} caught` +
    (SKIPPED_FORMS.length ? ` · left out (too many forms, see their own page): ${SKIPPED_FORMS.map(x => x.n).join(', ')}` : '');
  $('formGrid').innerHTML = items.map(({ sp, f }) => {
    const c = caughtForm(sp.d, f.n);
    return `<div class="card ${c ? '' : 'uncaught-soft'}" data-dex="${sp.d}">
      ${c ? '<span class="badge">●</span>' : ''}${img(f.s)}
      <div class="dexnum">#${pad(sp.d)}</div><div class="name">${esc(sp.n)}</div><div class="sub">${esc(f.dn)}</div></div>`;
  }).join('') || '<div class="hint pad">Nothing matches.</div>';
}

// ---------- Palettes tab ----------
const PAL_ITEMS = [];
const palCounts = new Map();
for (const sp of species) if (!SKIPPED_PALS.includes(sp)) for (const f of sp.f) for (const [pi, g, file] of f.p) {
  const name = S[pi];
  if (name === 'none' || !file) continue;
  PAL_ITEMS.push({ sp, f, pal: name, g, file });
  palCounts.set(name, (palCounts.get(name) || 0) + 1);
}
(function fillPalSelect() {
  const named = [...palCounts.keys()].filter(n => !isShinyPal(n))
    .sort((a, b) => (D.palNames[a] || a).localeCompare(D.palNames[b] || b));
  const shinyN = [...palCounts].filter(([n]) => isShinyPal(n)).reduce((t, [, c]) => t + c, 0);
  $('palName').innerHTML = `<option value="*special">All palettes except shiny (${PAL_ITEMS.length - shinyN})</option>
    <option value="*all">All palettes incl. shiny (${PAL_ITEMS.length})</option>
    <option value="*shiny">Shiny only (${shinyN})</option>
    <optgroup label="One palette">${named.map(n => `<option value="${esc(n)}">${esc(D.palNames[n] || n)} (${palCounts.get(n)})</option>`).join('')}</optgroup>`;
})();
function renderPalettes() {
  const q = $('palSearch').value.trim().toLowerCase(), which = $('palName').value, sort = $('palSort').value, cf = $('palCaught').value;
  let items = PAL_ITEMS.filter(it => {
    if (which === '*special' && isShinyPal(it.pal)) return false;
    if (which === '*shiny' && !isShinyPal(it.pal)) return false;
    if (!which.startsWith('*') && it.pal !== which) return false;
    if (q && !(it.sp.q.includes(q) || String(it.sp.d).includes(q) || (D.palNames[it.pal] || it.pal).toLowerCase().includes(q))) return false;
    const c = caughtPal(it.sp.d, it.f.n, it.pal);
    return !(cf === 'caught' && !c) && !(cf === 'uncaught' && c);
  });
  const pn = it => D.palNames[it.pal] || it.pal;
  if (sort === 'palette') items.sort((a, b) => pn(a).localeCompare(pn(b)) || a.sp.d - b.sp.d);
  else if (sort === 'name') items.sort((a, b) => a.sp.n.localeCompare(b.sp.n) || pn(a).localeCompare(pn(b)));
  else if (sort === 'uncaught') items.sort((a, b) => caughtPal(a.sp.d, a.f.n, a.pal) - caughtPal(b.sp.d, b.f.n, b.pal) || a.sp.d - b.sp.d);
  $('palCount').textContent = `${items.length} shown · ${items.filter(i => caughtPal(i.sp.d, i.f.n, i.pal)).length} caught` +
    (SKIPPED_PALS.length ? ` · left out (too many palettes, see their own page): ${SKIPPED_PALS.map(x => x.n).join(', ')}` : '');
  $('palGrid').innerHTML = items.map(it => {
    const c = caughtPal(it.sp.d, it.f.n, it.pal);
    const formTag = it.f.n !== it.sp.df ? ` · ${esc(it.f.dn)}` : '';
    return `<div class="card ${c ? '' : 'uncaught-soft'}" data-dex="${it.sp.d}">
      ${c ? '<span class="badge">●</span>' : ''}${img(it.file)}
      <div class="dexnum">#${pad(it.sp.d)}</div><div class="name">${esc(it.sp.n)}${GENDER_MARK[it.g]}</div>
      <div class="sub">${esc(pn(it))}${formTag}</div></div>`;
  }).join('') || '<div class="hint pad">Nothing matches.</div>';
}

// ---------- biome / structure browser ----------
const placeRows = new Map(); // place -> [{sp, f, row, kind}]
for (const sp of species) for (const f of sp.f) {
  for (const r of f.sp) {
    const k = S[r[1]];
    (placeRows.get(k) || placeRows.set(k, []).get(k)).push({ sp, f, cat: S[r[0]], time: S[r[2]], pct: r[3], reqs: S[r[4]] });
  }
  for (const r of f.st) {
    const k = 'Structure: ' + S[r[0]];
    (placeRows.get(k) || placeRows.set(k, []).get(k)).push({ sp, f, cat: S[r[1]], time: S[r[2]], pct: null, reqs: S[r[3]], structure: true });
  }
}
(function fillPlaceSelects() {
  const all = [...placeRows.keys()].filter(k => k !== 'Any valid location');
  const biomes = all.filter(k => !k.startsWith('Structure: ')).sort();
  const structs = all.filter(k => k.startsWith('Structure: ')).sort();
  const opts = list => list.map(b => `<option value="${esc(b)}">${esc(b.replace('Structure: ', ''))}</option>`).join('');
  const html = `<optgroup label="Biomes">${opts(biomes)}</optgroup><optgroup label="Structures">${opts(structs)}</optgroup>`;
  $('biomeFilter').insertAdjacentHTML('beforeend', html);
  $('biomeSelect').insertAdjacentHTML('beforeend', html);
})();
function renderBiomeTable() {
  const place = $('biomeSelect').value;
  if (!place) { $('biomeTable').innerHTML = '<div class="hint pad">Pick a biome or structure above to see everything that can spawn there.</div>'; return; }
  const t = $('timeFilter').value, q = $('biomeSearch').value.trim().toLowerCase(), method = $('methodFilter').value;
  let rows = placeRows.get(place) || [];
  if (t) rows = rows.filter(r => r.time === 'Any time' || r.time.split(' / ').includes(t) || r.time === t);
  if (q) rows = rows.filter(r => r.sp.q.includes(q) || String(r.sp.d).includes(q));
  if ($('hideCaught').checked) rows = rows.filter(r => !caughtSpecies(r.sp.d));
  if (method === 'wild') rows = rows.filter(r => !RAID_CATS.has(r.cat));
  if (method === 'raid') rows = rows.filter(r => RAID_CATS.has(r.cat));
  rows = [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  if (!rows.length) { $('biomeTable').innerHTML = '<div class="hint pad">No matching encounters.</div>'; return; }
  const isStruct = place.startsWith('Structure: ');
  const rowHtml = (r, i) => {
    const c = caughtSpecies(r.sp.d);
    return `<div class="biome-row ${c ? 'caught' : ''}" data-dex="${r.sp.d}">
      <div class="rank">#${i + 1}</div>${img(r.f.s || r.sp.defForm.s)}
      <div class="name">${esc(r.sp.n)}${r.f.n !== r.sp.df ? ` (${esc(r.f.dn)})` : ''} ${c ? '✓' : ''}</div>
      <div class="pct">${r.pct != null ? r.pct + '%' : (r.structure ? 'structure' : 'no % available')}</div>
      <div class="time">${esc(r.time)}</div>
      <div class="reqs">${esc(D.catLabels[r.cat] || r.cat)} · ${esc(r.reqs)}</div></div>`;
  };
  const leg = rows.filter(r => r.cat === 'legendaries'), rest = rows.filter(r => r.cat !== 'legendaries');
  let html = isStruct ? '<div class="hint">These spawn inside this structure (on top of whatever the surrounding biome spawns). Pixelmon gives no % for structure spawns.</div>' : '';
  if (leg.length) html += '<div class="biome-section-title">Legendary encounters</div>' + leg.map(rowHtml).join('') + '<div class="biome-section-title">Everything else</div>';
  html += rest.map(rowHtml).join('');
  $('biomeTable').innerHTML = html;
}

// ---------- detail popup ----------
let openDex = null;
function openDetail(dex) {
  const sp = byDex.get(Number(dex));
  if (!sp) return;
  openDex = sp.d;
  $('detailContent').innerHTML = renderDetail(sp);
  $('detailOverlay').classList.remove('hidden');
}
function spawnRow(r, f, sp, structure) {
  const formTag = f.n !== sp.df ? ` (${esc(f.dn)})` : '';
  if (structure) {
    return `<div class="spawn-row"><span class="pct meta">structure</span> <span class="cat">${esc(S[r[0]])}</span>${formTag}<br>
      <span class="meta">${esc(D.catLabels[S[r[1]]] || S[r[1]])} · ${esc(S[r[2]])} · ${esc(S[r[3]]) || 'No special requirements'}</span></div>`;
  }
  const pct = r[3] != null ? `<span class="pct">${r[3]}%</span>` : '<span class="pct meta">no % available</span>';
  return `<div class="spawn-row">${pct} <span class="cat">${esc(S[r[1]])}</span>${formTag}<br>
    <span class="meta">${esc(D.catLabels[S[r[0]]] || S[r[0]])} · ${esc(S[r[2]])} · ${esc(S[r[4]]) || 'No special requirements'}</span></div>`;
}
function renderFamily(sp) {
  const stages = family(sp.k);
  if (stages.flat().length < 2) return '<div class="spawn-row meta">Does not evolve.</div>';
  const chip = m => {
    const c = caughtSpecies(m.d);
    const how = [...new Set((evoIn.get(m.k) || []).map(e => (e.toForm !== 'base' && e.toForm !== m.df ? `${(m.f.find(f => f.n === e.toForm) || {}).dn || e.toForm}: ` : '') + e.txt))];
    return `<div class="fam-chip ${m.d === sp.d ? 'current' : ''} ${c ? 'caught' : 'not-caught'}" data-dex="${m.d}">
      ${img(lookFor(m).sprite)}<div class="fam-name">${esc(m.n)}</div>
      <div class="fam-status">${c ? '✓ Caught' : '✗ Not caught'}</div>
      ${how.length ? `<div class="fam-how">${how.map(esc).join('<br>or ')}</div>` : ''}</div>`;
  };
  const cols = n => (n > 3 ? Math.min(3, Math.ceil(n / 2)) : 1);
  return `<div class="family">${stages.map((col, i) => (i ? '<div class="fam-arrow">→</div>' : '') +
    `<div class="fam-col" style="grid-template-columns:repeat(${cols(col.length)},132px)">${col.map(chip).join('')}</div>`).join('')}</div>`;
}
function renderDetail(sp) {
  const look = lookFor(sp);
  const base = sp.defForm;
  const c = caughtSpecies(sp.d);
  const wild = [], raid = [], struct = [];
  for (const f of sp.f) {
    f.wild.forEach(r => wild.push([r, f]));
    f.raid.forEach(r => raid.push([r, f]));
    f.st.forEach(r => struct.push([r, f]));
  }
  wild.sort((a, b) => (b[0][3] ?? -1) - (a[0][3] ?? -1));
  raid.sort((a, b) => (b[0][3] ?? -1) - (a[0][3] ?? -1));
  // whole chain both ways: every earlier stage back to the base, every later stage incl. branches
  const chipList = list => list.map(p =>
    `<span class="prior-evo-chip clickable ${caughtSpecies(p.d) ? '' : 'not-caught'}" data-dex="${p.d}" title="${caughtSpecies(p.d) ? 'Caught' : 'Not caught'}">${img(lookFor(p).sprite, 'prior-evo-icon')}<span class="prior-evo-name">${esc(p.n)}</span></span>`).join('');
  const before = ancestors(sp.k), after = descendants(sp.k);
  const preHtml = (before.length || after.length) ? `<div class="prior-evo">
    ${before.length ? `<span class="prior-evo-label">Evolves from</span><div class="prior-evo-chips">${chipList(before)}</div>` : ''}
    ${after.length ? `<span class="prior-evo-label later">Evolves into</span><div class="prior-evo-chips">${chipList(after)}</div>` : ''}
  </div>` : '';
  const badges = [sp.leg ? '<span class="type-badge gold">Legendary / Mythical</span>' : '',
    sp.structOnly ? '<span class="type-badge struct">Only found in structures</span>' : ''].join('');

  const evoInto = [];
  for (const e of evoIn.get(sp.k) || []) {
    const f = byKey.get(e.from);
    const myForm = sp.f.find(x => x.n === e.toForm);
    evoInto.push(`<div class="spawn-row">${myForm && e.toForm !== sp.df ? `${esc(myForm.dn)} form: ` : ''}Evolves from <b class="link" data-dex="${f.d}">${esc(f.n)}</b> — ${esc(e.txt)}</div>`);
  }
  for (const e of evoOut.get(sp.k) || []) {
    const t = byKey.get(e.to);
    const tf = t.f.find(f => f.n === e.toForm);
    evoInto.push(`<div class="spawn-row">Evolves into <b class="link" data-dex="${t.d}">${esc(t.n)}${tf && e.toForm !== t.df ? ` (${esc(tf.dn)})` : ''}</b> — ${esc(e.txt)}</div>`);
  }
  if (base.eg.length && !base.eg.includes('Undiscovered')) evoInto.push(`<div class="spawn-row meta">Egg groups: ${base.eg.map(esc).join(', ')} — breedable at a Daycare</div>`);
  if (sp.k === 'Phione') evoInto.push('<div class="spawn-row meta">Phione does not evolve. It hatches from eggs bred from Manaphy (or Phione).</div>');
  if (sp.k === 'Manaphy') evoInto.push('<div class="spawn-row meta">Manaphy does not evolve. Its eggs hatch into Phione (Phione cannot evolve into Manaphy).</div>');

  const picked = picks[sp.d];
  const formsHtml = sp.f.filter(f => f.p.some(p => p[2])).map(f => {
    const fc = caughtForm(sp.d, f.n);
    const thumbs = f.p.filter(p => p[2]).map(([pi, g, file]) => {
      const key = `${f.n}|${S[pi]}|${g}`;
      const pc = caughtPal(sp.d, f.n, S[pi]);
      const manualKey = `${sp.d}|${f.n}|${S[pi]}`;
      return `<div class="thumb ${picked === key ? 'picked' : ''} ${pc ? 'caught' : ''}" data-pick="${esc(key)}" title="Click to show this picture in the Pokédex">
        ${img(file)}<div class="thumb-name">${esc(palName(pi))}${GENDER_MARK[g]}</div>
        <button class="mini-check ${pc ? 'on' : ''}" data-manual="${esc(manualKey)}" title="${saveSets.pal.has(manualKey) ? 'Caught (from your save)' : 'Mark this one as caught'}">${pc ? '✓' : '○'}</button></div>`;
    }).join('');
    return `<div class="form-block"><div class="form-title">${esc(f.dn)} ${fc ? '<span class="ok">✓ caught</span>' : '<span class="meta">not caught</span>'}</div><div class="thumbs">${thumbs}</div></div>`;
  }).join('');

  return `
    <div class="detail-header">
      ${img(look.sprite)}
      <div><h2>#${pad(sp.d)} ${esc(sp.n)}</h2>${base.t.map(t => `<span class="type-badge">${esc(t)}</span>`).join('')}${badges}</div>
      ${preHtml}
    </div>
    <button id="manualToggle" class="caught-toggle ${c ? 'on' : ''}" ${saveSets.sp.has(String(sp.d)) ? 'disabled title="Caught according to your save"' : ''}>${c ? '✓ Caught' : 'Mark as caught'}</button>
    ${saveSets.sp.has(String(sp.d)) ? '<div class="hint">Status auto-synced from your save file.</div>' : ''}
    <div class="section-title">Evolution family</div>
    ${renderFamily(sp)}
    <div class="section-title">Where to find</div>
    ${wild.map(([r, f]) => spawnRow(r, f, sp)).join('') || `<div class="spawn-row meta">No known wild spawn${struct.length ? ' outside structures' : ''} — see evolution/breeding info below.</div>`}
    ${struct.length ? `<div class="section-title">Structure spawns</div>${struct.map(([r, f]) => spawnRow(r, f, sp, true)).join('')}` : ''}
    ${raid.length ? `<div class="section-title">Raids &amp; boss encounters</div>${raid.map(([r, f]) => spawnRow(r, f, sp)).join('')}` : ''}
    <div class="section-title">Evolution &amp; breeding</div>
    ${evoInto.join('') || '<div class="spawn-row meta">No evolution data.</div>'}
    <div class="section-title">Forms &amp; palettes <span class="meta">— click one to use it as this Pokémon's picture in the Pokédex</span></div>
    ${formsHtml}
    ${picked ? '<button id="resetPick" class="small-btn">Use the default picture again</button>' : ''}`;
}
$('detailContent').addEventListener('click', e => {
  const t = e.target;
  const manualBtn = t.closest('[data-manual]');
  if (manualBtn) { e.stopPropagation(); if (!saveSets.pal.has(manualBtn.dataset.manual)) toggleManual(manualBtn.dataset.manual); return; }
  const pick = t.closest('[data-pick]');
  if (pick) {
    picks[openDex] = pick.dataset.pick; store.set('picks', picks);
    $('lookMode').value = 'picks'; store.set('look', 'picks');
    refreshAll(); return;
  }
  if (t.id === 'resetPick') { delete picks[openDex]; store.set('picks', picks); refreshAll(); return; }
  if (t.id === 'manualToggle') { toggleManual(String(openDex)); return; }
  const jump = t.closest('[data-dex]');
  if (jump && Number(jump.dataset.dex) !== openDex) openDetail(jump.dataset.dex);
});
const closeDetail = () => { $('detailOverlay').classList.add('hidden'); openDex = null; };
$('closeDetail').addEventListener('click', closeDetail);
$('detailOverlay').addEventListener('click', e => { if (e.target === $('detailOverlay')) closeDetail(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); $('settingsOverlay').classList.add('hidden'); } });
for (const id of ['grid', 'formGrid', 'palGrid', 'biomeTable']) {
  $(id).addEventListener('click', e => { const c = e.target.closest('[data-dex]'); if (c) openDetail(c.dataset.dex); });
}

// ---------- counts + refresh ----------
function updateCounts() {
  const n = species.filter(sp => caughtSpecies(sp.d)).length;
  let src = ' (manual)';
  if (saveCache) {
    const when = new Date(saveCache.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    src = ` (synced from "${saveCache.world}" · ${when})`;
  }
  $('counts').textContent = `${n} / ${species.length} caught${src}`;
}
function refreshAll() {
  rebuildSaveSets();
  updateCounts();
  const tab = document.querySelector('.tab-btn.active').dataset.tab;
  if (tab === 'pokedex') applyFilters();
  if (tab === 'forms') renderForms();
  if (tab === 'palettes') renderPalettes();
  if (tab === 'biome') renderBiomeTable();
  if (openDex != null) {
    const scroll = document.querySelector('#detailOverlay .detail-card').scrollTop;
    openDetail(openDex);
    document.querySelector('#detailOverlay .detail-card').scrollTop = scroll;
  }
}

// ---------- tabs ----------
function showTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + tab));
  store.set('tab', tab);
  refreshAll();
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('search').addEventListener('input', applyFilters);
$('biomeFilter').addEventListener('change', applyFilters);
$('caughtFilter').addEventListener('change', applyFilters);
$('lookMode').addEventListener('change', () => { store.set('look', $('lookMode').value); refreshAll(); });
['formSearch', 'formKind', 'formCaught'].forEach(id => $(id).addEventListener(id === 'formSearch' ? 'input' : 'change', renderForms));
['palSearch', 'palName', 'palSort', 'palCaught'].forEach(id => $(id).addEventListener(id === 'palSearch' ? 'input' : 'change', renderPalettes));
['biomeSelect', 'timeFilter', 'methodFilter', 'hideCaught'].forEach(id => $(id).addEventListener('change', renderBiomeTable));
$('biomeSearch').addEventListener('input', renderBiomeTable);

// ---------- world save connection ----------
const idb = (() => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('pixeldex', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async get(k) { try { const db = await open(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } },
    async set(k, v) { try { const db = await open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { /* ignore */ } },
    async del(k) { try { const db = await open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch { /* ignore */ } },
  };
})();
let status_last = '';
const status = msg => { status_last = msg; $('settingsStatus').textContent = msg; };

// players: [{uuid, file (File), modified}]
async function applyPlayers(world, players) {
  if (!players.length) {
    status('No Pixelmon Pokédex found in that folder. Pick the world folder itself (the one that contains "playerdata").');
    return false;
  }
  players.sort((a, b) => b.modified - a.modified);
  let chosen = players.find(p => p.uuid === store.get('player', null)) || players[0];
  if (players.length > 1) {
    $('playerPicker').innerHTML = 'Several players in this world — which one is you?<br><select id="playerSelect">' +
      players.map(p => `<option value="${p.uuid}" ${p === chosen ? 'selected' : ''}>${p.uuid}${p === players[0] ? ' (played most recently)' : ''}</option>`).join('') + '</select>';
    $('playerSelect').addEventListener('change', async e => { store.set('player', e.target.value); await applyPlayers(world, players); });
  } else {
    $('playerPicker').innerHTML = '';
  }
  try {
    const rows = await PixelNBT.readPokedex(await chosen.file.arrayBuffer());
    saveCache = { world, player: chosen.uuid, at: Date.now(), rows: rows.filter(r => r.caught || r.seen).map(r => [r.ndex, r.form, r.palette, r.caught ? 1 : 0, r.seen ? 1 : 0]) };
    store.set('save', saveCache);
    store.set('player', chosen.uuid);
    status(`Connected to "${world}" — ${rows.filter(r => r.caught).length} caught entries read.`);
    $('resyncBtn').classList.remove('hidden');
    refreshAll();
    return true;
  } catch (err) {
    status('Could not read the Pokédex file: ' + err.message);
    return false;
  }
}
async function readFromHandle(handle) {
  try {
    const pd = await handle.getDirectoryHandle('playerdata');
    const pk = await pd.getDirectoryHandle('pokemon');
    const players = [];
    for await (const [name, h] of pk.entries()) {
      if (h.kind === 'file' && name.endsWith('.pokedex')) {
        const file = await h.getFile();
        players.push({ uuid: name.replace(/\.pokedex$/, ''), file, modified: file.lastModified });
      }
    }
    return applyPlayers(handle.name, players);
  } catch {
    return applyPlayers(handle.name, []);
  }
}
// ---- desktop window (pywebview): Python picks the folder and reads the files, like v1 ----
const native = () => window.pywebview && window.pywebview.api;
async function nativeApply(r) {
  if (!r) return false;
  const players = r.players.map(p => ({ uuid: p.uuid, modified: p.modified,
    file: new Blob([Uint8Array.from(atob(p.data), c => c.charCodeAt(0))]) }));
  const ok = await applyPlayers(r.world, players);
  if (ok) store.set('worldPath', r.path);
  return ok;
}
window.addEventListener('pywebviewready', async () => {
  // settings saved by the desktop app win over the window's own storage
  const saved = await native().load_settings();
  for (const [k, v] of Object.entries(saved || {})) { try { localStorage.setItem('pixeldex.' + k, v); } catch { /* ignore */ } }
  manual = new Set(store.get('manual', []).map(String));
  picks = store.get('picks', {});
  saveCache = store.get('save', null);
  $('lookMode').value = store.get('look', 'picks');
  const v1 = await native().v1_config();            // carry over v1's world folder + "Mark as caught" marks
  if (v1 && !store.get('v1Imported', false)) {
    for (const d of v1.manual_caught || []) manual.add(String(d));
    store.set('manual', [...manual]);
    if (v1.save_dir && !store.get('worldPath', null)) store.set('worldPath', v1.save_dir);
    if (v1.player_uuid && !store.get('player', null)) store.set('player', v1.player_uuid);
    store.set('v1Imported', true);
  }
  $('resyncBtn').classList.toggle('hidden', !store.get('worldPath', null));
  await resync(false);
  refreshAll();
});

$('pickWorldBtn').addEventListener('click', async () => {
  if (native()) { status('Waiting for folder selection…'); if (!(await nativeApply(await native().pick_world()))) status(status_last || 'No folder selected.'); return; }
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ id: 'pixeldex-world', mode: 'read' });
      status('Reading…');
      if (await readFromHandle(handle)) await idb.set('world', handle);
    } catch (err) {
      if (err.name !== 'AbortError') { status('Folder picker unavailable here, using the basic picker instead.'); $('worldInput').click(); }
    }
  } else {
    $('worldInput').click();
  }
});
$('worldInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  if (!files.length) return;
  const world = (files[0].webkitRelativePath || '').split('/')[0] || 'world';
  const players = files.filter(f => /(^|\/)playerdata\/pokemon\/[^/]+\.pokedex$/.test(f.webkitRelativePath))
    .map(f => ({ uuid: f.name.replace(/\.pokedex$/, ''), file: f, modified: f.lastModified }));
  await applyPlayers(world, players);
  e.target.value = '';
});
async function resync(interactive) {
  if (native()) {
    const path = store.get('worldPath', null);
    if (path) await nativeApply(await native().read_world(path));
    else if (interactive) $('settingsOverlay').classList.remove('hidden');
    return;
  }
  const handle = await idb.get('world');
  if (!handle) { if (interactive) { $('settingsOverlay').classList.remove('hidden'); status('Choose your world folder again to sync.'); } return; }
  let perm = await handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted' && interactive) perm = await handle.requestPermission({ mode: 'read' });
  if (perm === 'granted') await readFromHandle(handle);
}
$('resyncBtn').addEventListener('click', () => resync(true));
window.addEventListener('focus', () => resync(false));
$('disconnectBtn').addEventListener('click', async () => {
  store.set('worldPath', null);
  await idb.del('world'); saveCache = null; store.set('save', null);
  $('resyncBtn').classList.add('hidden'); $('playerPicker').innerHTML = ''; status('Disconnected.');
  refreshAll();
});
$('clearManualBtn').addEventListener('click', () => {
  if (!confirm('Remove every "caught" mark you set by hand? (Save-file data is not affected.)')) return;
  manual = new Set(); store.set('manual', []); refreshAll();
});
$('settingsBtn').addEventListener('click', () => $('settingsOverlay').classList.remove('hidden'));
$('closeSettings').addEventListener('click', () => $('settingsOverlay').classList.add('hidden'));
$('settingsOverlay').addEventListener('click', e => { if (e.target === $('settingsOverlay')) $('settingsOverlay').classList.add('hidden'); });
$('aboutLine').textContent = `PixelDex v${D.version} · Pokémon data from Pixelmon ${D.pixelmon}`;

// ---------- start ----------
$('lookMode').value = store.get('look', 'picks');
if (saveCache) { $('resyncBtn').classList.remove('hidden'); status(`Last synced from "${saveCache.world}".`); }
showTab(store.get('tab', 'pokedex'));
resync(false);
