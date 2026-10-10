// Runs on the Kronos (UKG) pages. Two jobs:
//  * in EVERY frame: watch Zack's clicks/typing while "Show me once" is on, and
//    repeat a single step when the panel asks (find the field, type into it
//    at a normal pace, or click it). Kronos puts its screens inside frames, so
//    frames talk to the top page with window.postMessage.
//  * in the TOP page only: the Schedule Helper panel (Copy / Auto-fill / Show me once).
// Nothing here logs in or calls Kronos behind the screen: it only uses the same
// buttons and boxes Zack does, one shift at a time. It sends nothing anywhere
// unless Zack turns on "Live help" (the Live button, with a code from Joseph):
// then what the helper does (steps, stuck messages, the screen description from
// the debug file) goes to Joseph's private Discord channel, with every
// "Last, First" name shortened to initials. Live help turns itself off after 2 hours.
(function () {
  if (window.__scheduleHelper) return;
  window.__scheduleHelper = true;

  const R = globalThis.SHRoster, S = globalThis.SHStore;
  const IS_TOP = window === window.top;
  const FRAME_KEY = location.origin + location.pathname;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  let panelHost = null;

  // ---------------- Live help (off unless Zack turns it on) ----------------
  // Names are shortened before anything leaves the page: "Avery, Jamie" -> "A., J."
  const maskNames = (s) => String(s ?? "").replace(/([A-Z][A-Za-z'\-]+(?: [A-Z][A-Za-z'\-]+)*),\s*([A-Z][A-Za-z'\-]+(?: [A-Z][A-Za-z'\-]+)*)/g,
    (m, a, b) => `${a[0]}., ${b[0]}.`);
  let liveOn = false;
  const LIVE_HOURS = 2;
  function liveCheck() {
    try {
      chrome.storage.local.get("sh_live", (v) => {
        const l = v && v.sh_live;
        liveOn = !!(l && l.on && l.code && Date.now() - (l.since || 0) < LIVE_HOURS * 3600e3);
        if (l && l.on && !liveOn) chrome.storage.local.set({ sh_live: { ...l, on: false } });
        if (typeof window.__shLiveShown === "function") window.__shLiveShown(liveOn);
      });
    } catch (e) { liveOn = false; }
  }
  liveCheck();
  try { chrome.storage.onChanged.addListener((c) => { if (c.sh_live) liveCheck(); }); } catch (e) { /* ignore */ }
  // kind: step | ok | stuck | asked | answer | note | error | info; file: an object sent as a JSON attachment
  function live(kind, text, file) {
    if (!liveOn) return;
    try {
      chrome.runtime.sendMessage({ type: "live", kind, text: maskNames(text).slice(0, 600),
        file: file ? maskNames(JSON.stringify(file, null, 1)) : null, frame: IS_TOP ? "top" : location.pathname.slice(0, 60) });
    } catch (e) { /* extension reloaded: ignore */ }
  }
  const plain = (html) => String(html).replace(/<br\s*\/?>/gi, " | ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  // only the helper's own errors (Kronos' errors are none of our business)
  window.addEventListener("error", (e) => { if (/^chrome-extension:/.test(e.filename || "")) live("error", `${e.message} @ ${e.filename.split("/").pop()}:${e.lineno}`); });
  window.addEventListener("unhandledrejection", (e) => { const t = String(e.reason && (e.reason.stack || e.reason)); if (/chrome-extension:/.test(t)) live("error", `promise: ${t.slice(0, 300)}`); });

  // ---------------- messaging between frames ----------------
  function post(win, msg) { try { win.postMessage({ __sh: 1, ...msg }, "*"); } catch (e) { /* frame gone */ } }
  function allFrames(w = window.top, out = []) {
    out.push(w);
    try { for (let i = 0; i < w.frames.length; i++) allFrames(w.frames[i], out); } catch (e) { /* ignore */ }
    return out;
  }
  const broadcast = (msg) => allFrames().forEach((w) => post(w, msg));

  // ---------------- looking at the page ----------------
  const UNSTABLE_ID = /\d{3,}|[0-9a-f]{8}-|^(mat-|cdk-|ng-|ember|react|ext-gen|x-auto|ui-id)/i;
  const ATTRS = ["name", "type", "role", "aria-label", "placeholder", "title", "data-testid", "data-automation-id", "automation-id", "formcontrolname"];

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0;
  }
  function ownText(el) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return "";
    return String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  function labelOf(el) {
    try {
      if (el.labels && el.labels[0]) {
        // only the label's own words, not the options of a list inside it
        const c = el.labels[0].cloneNode(true);
        c.querySelectorAll("input,select,textarea,option").forEach((x) => x.remove());
        return c.textContent.replace(/\s+/g, " ").trim();
      }
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
    } catch (e) { /* ignore */ }
    return "";
  }
  // The words printed next to a box ("Start time" in front of it), never a whole
  // container's text: walk up a few levels and take the closest short text before the box.
  const FORM = "input,select,textarea";
  function nearLabel(el) {
    let prev = null;
    for (let a = el.parentElement, n = 0; a && n < 4; a = a.parentElement, n++) {
      const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) break; // past the box
        if (t.parentElement.closest("option,script,style") || !visible(t.parentElement)) continue;
        const v = t.textContent.replace(/\s+/g, " ").trim();
        if (v && v.length <= 30 && !/^\[|^\d/.test(v)) prev = v;
      }
      if (prev) return prev.replace(/[:*]\s*$/, "");
    }
    return "";
  }
  function fieldLabel(el) {
    return labelOf(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || (el.matches && el.matches(FORM) ? nearLabel(el) : "");
  }
  function cssPath(el) {
    const parts = [];
    for (let e = el, n = 0; e && e.nodeType === 1 && n < 6; e = e.parentElement, n++) {
      let p = e.tagName.toLowerCase();
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
      parts.unshift(p);
    }
    return parts.join(" > ");
  }
  function describe(el) {
    const d = { tag: el.tagName.toLowerCase() };
    if (el.id && !UNSTABLE_ID.test(el.id)) d.id = el.id;
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v) d[a] = v; }
    const t = ownText(el); if (t && t.length <= 60) d.text = t; // a long text is a container, not a name
    const l = labelOf(el) || (el.matches(FORM) && !d["aria-label"] && !d.placeholder ? nearLabel(el) : ""); if (l) d.label = l;
    d.path = cssPath(el);
    // extra clues so replay has fallbacks (Kronos changes ids, case and layout)
    try {
      if (el.matches(BOXES)) {
        const nl = nearLabel(el); if (nl) d.near = nl;
        if (el.type) d.itype = el.type;
        if (isTimey(el)) d.tidx = timeBoxes(el.ownerDocument).indexOf(el);
      }
      const c = container(el);
      if (c) {
        d.pcls = String(c.className || "").trim().split(/\s+/)[0] || c.tagName.toLowerCase();
        const same = el.matches(BOXES) ? [...c.querySelectorAll(BOXES)].filter(visible) : [...c.querySelectorAll(el.tagName)].filter(visible);
        d.pidx = same.indexOf(el);
        const cr = c.getBoundingClientRect(), r = el.getBoundingClientRect();
        if (cr.width && cr.height) d.rel = [+((r.left + r.width / 2 - cr.left) / cr.width).toFixed(3), +((r.top + r.height / 2 - cr.top) / cr.height).toFixed(3)];
      }
    } catch (e) { /* clues are optional */ }
    return d;
  }
  // the open panel/dialog something sits in (or null)
  const PANELISH = "[role=dialog],[aria-modal=true],aside,[class*=panel],[class*=Panel],[class*=slider],[class*=drawer],[class*=flyout],[class*=modal]";
  function container(el) { const c = el.closest(PANELISH); return c && c !== document.body ? c : null; }
  const fuzzy = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  function isTimey(e) {
    return e.type === "time" || /time|hh|:mm/i.test(`${e.getAttribute("placeholder") || ""} ${e.getAttribute("aria-label") || ""} ${e.name || ""} ${e.id || ""} ${typeof e.className === "string" ? e.className : ""}`) ||
      /\d{1,2}:\d\d/.test(e.value || "") || /\btime\b/i.test(nearLabel(e));
  }
  function timeBoxes(doc = document) { return deepAll(BOXES, doc).filter((e) => visible(e) && isTimey(e)); }
  // querySelectorAll that also looks inside open shadow roots
  function deepAll(sel, root = document) {
    const out = [...root.querySelectorAll(sel)];
    for (const h of root.querySelectorAll("*")) if (h.shadowRoot) out.push(...deepAll(sel, h.shadowRoot));
    return out;
  }
  function score(el, d, wantText) {
    let s = el.tagName.toLowerCase() === d.tag ? 1 : -3;
    if (d.id && el.id === d.id) s += 10;
    for (const a of ATTRS) if (d[a] && el.getAttribute(a) === d[a]) s += a === "type" || a === "role" ? 1 : 6;
    if (d.label && fuzzy(labelOf(el) || (el.matches(FORM) ? nearLabel(el) : "")) === fuzzy(d.label)) s += 6;
    const t = ownText(el);
    if (wantText != null) {
      if (norm(t) === norm(wantText)) s += 8;
      else if (norm(t).startsWith(norm(wantText))) s += 4;
      else if (norm(t).split(/\s*[/>]\s*/).pop() === norm(wantText) && /[/>]/.test(t)) s += 4; // "Restaurant/Bar"
      else return -99;
    } else if (d.text) {
      s += t === d.text ? 6 : -4;
    }
    try { if (d.path && el.matches(d.path.split(" > ").pop()) && el.getRootNode().querySelector(d.path) === el) s += 3; } catch (e) { /* bad selector */ }
    return s;
  }
  function find(d, wantText, loose) {
    const exact = findExact(d, wantText);
    return exact || (loose ? findLoose(d, wantText) : null);
  }
  // the many-ways search: words, aria, placeholder, title, nearby text, box type, place in the panel
  function findLoose(d, wantText) {
    const ok = (e) => visible(e) && notPanel(e);
    if (wantText != null) {
      const w = fuzzy(wantText);
      const pool = deepAll("[role=option],[role=menuitem],[role=gridcell],li,button,a,td,span,div,label").filter(ok);
      const hits = pool.filter((e) => { const t = fuzzy(ownText(e)); return t && (t === w || t.endsWith(w) && /[/>]/.test(ownText(e))); });
      return hits.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0] || null;
    }
    const isBox = /^(input|select|textarea)$/.test(d.tag) || d.near || d.itype;
    const pool = isBox ? deepAll(BOXES).filter(ok) : deepAll(`${d.tag},button,a,[role=button],[role=menuitem],[role=option],[role=tab],span,div,li,label`).filter(ok);
    const words = [d.label, d.near, d["aria-label"], d.placeholder, d.title].filter(Boolean).map(fuzzy);
    const openC = [...new Set(pool.map(container).filter(Boolean))];
    const tb = isBox && d.tidx != null && d.tidx >= 0 ? timeBoxes() : null;
    let best = null, bestS = 7;
    for (const e of pool) {
      let sc = 0;
      if (d.id && e.id === d.id) sc += 10;
      for (const a of ["name", "formcontrolname", "data-automation-id", "data-testid", "automation-id"]) if (d[a] && e.getAttribute(a) === d[a]) sc += 8;
      if (isBox) {
        const mine = [fieldLabel(e), nearLabel(e), e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title")].filter(Boolean).map(fuzzy);
        if (words.some((w) => mine.includes(w))) sc += 7;
        else if (words.some((w) => w.length > 3 && mine.some((m) => m.length > 3 && (m.includes(w) || w.includes(m))))) sc += 4;
        if (d.itype && e.type === d.itype && d.itype !== "text") sc += 2;
        if (tb && tb.indexOf(e) === d.tidx) sc += 4;
      } else {
        const t = fuzzy(ownText(e));
        if (d.text && t && t === fuzzy(d.text)) sc += 8;
        else if (d.text && t && fuzzy(d.text).length > 3 && t.includes(fuzzy(d.text)) && t.length < fuzzy(d.text).length + 6) sc += 4;
        if (words.some((w) => [e.getAttribute("aria-label"), e.getAttribute("title")].filter(Boolean).map(fuzzy).includes(w))) sc += 6;
        if (e.tagName.toLowerCase() === d.tag) sc += 1;
      }
      // same place inside the open panel
      const c = container(e);
      if (c && d.pcls && (String(c.className || "").includes(d.pcls) || c.tagName.toLowerCase() === d.pcls)) {
        sc += 1;
        if (d.pidx != null) { const same = isBox ? [...c.querySelectorAll(BOXES)].filter(visible) : [...c.querySelectorAll(e.tagName)].filter(visible); if (same.indexOf(e) === d.pidx) sc += 3; }
      } else if (c && openC.length === 1 && d.pidx != null && isBox) {
        if ([...c.querySelectorAll(BOXES)].filter(visible).indexOf(e) === d.pidx) sc += 3;
      }
      if (sc > bestS || (sc === bestS && best && best.contains(e))) { best = e; bestS = sc; }
    }
    return best;
  }
  function findExact(d, wantText) {
    let pool = deepAll(d.tag);
    if (wantText != null) pool = pool.concat(deepAll("[role=option],[role=menuitem],[role=gridcell],li,button,a,td,span,div"));
    let best = null, bestS = wantText != null ? 8 : 6;
    for (const el of new Set(pool)) {
      if (panelHost && panelHost.contains(el)) continue;
      const s = score(el, d, wantText);
      if (s >= bestS && visible(el)) {
        // with the same score prefer the smallest (innermost) element
        if (s > bestS || !best || best.contains(el)) { best = el; bestS = s; }
      }
    }
    return best;
  }
  // When the recorded box can't be found exactly (Kronos changes ids, case, layout):
  // any visible box whose own words match, then for Start/End time the 1st/2nd time-like box.
  const BOXES = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea,[contenteditable=true],[role=textbox],[role=combobox],[role=spinbutton]";
  function findBox(d) {
    if (!/^(input|select|textarea)$/.test(d.tag)) return null;
    const want = norm(d.label || d["aria-label"] || d.placeholder || d.name || "");
    if (!want) return null;
    const boxes = deepAll(BOXES).filter((e) => visible(e) && notPanel(e));
    const words = (e) => norm(fieldLabel(e) || nearLabel(e));
    const hit = boxes.find((e) => words(e) === want) || boxes.find((e) => words(e).includes(want) || (words(e) && want.includes(words(e)) && words(e).length > 3));
    if (hit) return hit;
    const which = /start|from|begin|in\b/.test(want) ? 0 : /end|to\b|until|out\b/.test(want) ? 1 : -1;
    if (which < 0 || !/time/.test(want)) return null;
    const timey = boxes.filter((e) => e.type === "time" || /time|hh|:mm/i.test(`${e.getAttribute("placeholder") || ""} ${e.getAttribute("aria-label") || ""} ${e.name || ""} ${e.id || ""} ${e.className || ""}`) || TIME_RE.test(e.value || ""));
    return timey[which] || null;
  }
  async function waitFind(d, wantText, ms, looseNow) {
    const until = Date.now() + ms;
    for (;;) {
      const late = looseNow || Date.now() > until - ms + 2500; // Kronos is slow: give the exact match a moment first
      const el = find(d, wantText, late) || (wantText == null && late ? findBox(d) : null);
      if (el || Date.now() > until) return el;
      await sleep(250);
    }
  }
  // "Save debug file" on a stuck card: what's on the screen right now (open panels, every box
  // with its labels), no page text, no typed values except times/dates, never passwords.
  function snapshot() {
    const box = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
    const attrs = (e) => { const a = {}; for (const at of e.attributes) if (/^(id|class|role|type|name|placeholder|title|for|tabindex)$/.test(at.name) || /^(aria-|data-)/.test(at.name)) a[at.name] = at.value.slice(0, 100); return a; };
    const panels = [...document.querySelectorAll("[role=dialog],[aria-modal=true],aside,[class*=panel],[class*=slider],[class*=drawer],[class*=flyout]")]
      .filter((e) => visible(e) && notPanel(e) && e.querySelector(BOXES)).slice(0, 6)
      .map((e) => ({ tag: e.tagName.toLowerCase(), attrs: attrs(e), box: box(e), heading: ((e.querySelector("h1,h2,h3,h4,[role=heading],header") || {}).textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) }));
    const boxes = [...document.querySelectorAll(BOXES)].filter((e) => visible(e) && notPanel(e)).slice(0, 60).map((e) => {
      const v = e.type === "password" ? "" : String(e.value || "");
      return { tag: e.tagName.toLowerCase(), attrs: attrs(e), box: box(e), label: (labelOf(e) || "").slice(0, 40), near: nearLabel(e).slice(0, 40),
        value: TIME_RE.test(v) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(v.trim()) ? v.slice(0, 20) : v ? `(${v.length} letters)` : "",
        parents: (() => { const out = []; for (let p = e.parentElement, n = 0; p && n < 4; p = p.parentElement, n++) out.push(`${p.tagName.toLowerCase()}${p.className && typeof p.className === "string" ? "." + p.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`); return out; })() };
    });
    const buttons = [...document.querySelectorAll("button,[role=button],a")].filter((e) => visible(e) && notPanel(e) && e.closest("[role=dialog],aside,[class*=panel],[class*=slider],[class*=drawer]"))
      .slice(0, 30).map((e) => ({ text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30), attrs: attrs(e), box: box(e) }));
    return { frame: location.origin + location.pathname, size: [innerWidth, innerHeight], panels_open: panels, boxes, panel_buttons: buttons };
  }


  // ---------------- the schedule grid ----------------
  // In UKG's Schedule Planner a shift is added by clicking an empty spot on the
  // grid: the person's row x the day's column. We don't rely on how the grid is
  // built inside: the day columns are found from their headers ("Tue 10/06") and
  // the row from the person's name ("Last, First") to the left of the spot.
  const DAY_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+(\d{1,2})\/(\d{1,2})(\/\d{2,4})?$/i;
  const NAME_RE = /^[^\d,()|]{2,40},\s*[^\d,()|]{1,40}$/;
  const TIME_RE = /\d{1,2}:\d\d|\b\d{1,2}\s*(a|p)m?\b/i;
  const NOT_GRID = "input,select,textarea,button,a,[role=button],[role=dialog],[role=menu],[role=menuitem],[role=option],[role=tab],form";
  function textLeaves() {
    const out = [];
    for (const e of document.querySelectorAll("body *")) {
      if (e.childElementCount || (panelHost && panelHost.contains(e)) || /^(SCRIPT|STYLE|OPTION)$/.test(e.tagName)) continue;
      const t = e.textContent.replace(/\s+/g, " ").trim();
      if (t && t.length <= 60 && visible(e)) out.push([e, t]);
    }
    return out;
  }
  const mdKey = (m, d) => `${Number(m)}/${Number(d)}`;
  function dayBands(leaves = textLeaves()) {
    const byMd = new Map();
    for (const [e, t] of leaves) {
      const m = DAY_RE.exec(t);
      if (m) byMd.set(mdKey(m[2], m[3]), e); // the last one on the page is the grid's own header
    }
    const heads = [...byMd].map(([md, el]) => ({ md, el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.left - b.r.left);
    const gaps = heads.slice(1).map((h, i) => h.r.left - heads[i].r.left).sort((a, b) => a - b);
    const step = gaps.length ? gaps[gaps.length >> 1] : 0;
    return heads.map((h) => {
      // grow from the header's words to its whole column header cell
      let box = h.el;
      while (box.parentElement && step && box.parentElement.getBoundingClientRect().width <= step * 1.15 &&
        !heads.some((o) => o !== h && box.parentElement.contains(o.el))) box = box.parentElement;
      const b = box.getBoundingClientRect();
      const w = step || b.width;
      const whole = b.width >= w * 0.6;
      return { md: h.md, left: whole ? b.left : h.r.left + h.r.width / 2 - w / 2, width: whole ? b.width : w, bottom: h.r.bottom, el: h.el };
    });
  }
  function nameLeaves(leaves = textLeaves()) { return leaves.filter(([, t]) => NAME_RE.test(t) && !TIME_RE.test(t)); }
  function rowBox(nameEl) {
    const row = nameEl.closest("[role=row],tr");
    const r = row && row.getBoundingClientRect().height < 150 ? row.getBoundingClientRect() : nameEl.getBoundingClientRect();
    return { cy: r.top + r.height / 2, h: r.height };
  }
  // Is the clicked thing on a panel/popup lying over the grid rather than in the grid?
  // (walk up to where it meets the name column: a fixed layer, a dialog, or a part with
  // boxes to fill in means it's the add-shift panel, not an empty grid spot)
  function onTop(target, nameEl) {
    for (let e = target; e && !e.contains(nameEl); e = e.parentElement) {
      if (e.matches("[role=dialog],[aria-modal=true]") || getComputedStyle(e).position === "fixed") return true;
      if (e !== target && e.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea")) return true;
    }
    return false;
  }
  // The name column, read by what is drawn at a height: real Kronos keeps the names in their
  // own pane left of the grid (krn_matrix), with the words split over several tags, so we
  // look at what's under a few points of that pane and climb to the element holding the name.
  const NAME_IN = /([A-Za-z][A-Za-z'.\-]*(?:[ -][A-Za-z'.\-]+)*,\s*[A-Za-z][A-Za-z'.\-]*(?:[ -][A-Za-z][A-Za-z'.\-]*)*)/;
  const notPanel = (e) => !(panelHost && (panelHost === e || panelHost.contains(e)));
  function gridLeft() { const b = dayBands(); return b.length ? b[0].left : 0; }
  function nameAt(y, left = gridLeft()) {
    if (left < 40) return null;
    let loose = null;
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const x = left * f;
      const top = document.elementsFromPoint(x, y).find(notPanel);
      for (let e = top, n = 0; e && e !== document.body && n < 8; e = e.parentElement, n++) {
        const r = e.getBoundingClientRect();
        if (r.height > 130 || r.right > left + 6) break; // left the row / the name pane
        const t = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
        if (!t || t.length > 80 || TIME_RE.test(t)) continue;
        const m = NAME_IN.exec(t);
        if (m) return { name: m[1].trim(), el: e };
        if (!loose && /[A-Za-z]{2,}/.test(t) && !/^name\b/i.test(t)) loose = { name: t, el: e };
      }
    }
    return loose;
  }
  // every name drawn in the name pane right now (scanning down it), as [{name, el}]
  function paneNames() {
    const left = gridLeft(), bands = dayBands();
    if (left < 40 || !bands.length) return [];
    const y0 = Math.max(0, Math.max(...bands.map((b) => b.bottom)) + 2), y1 = innerHeight - 2;
    const out = [], seen = new Set();
    for (let y = y0; y < y1; y += 7) {
      const h = nameAt(y, left);
      if (h && !seen.has(h.el)) { seen.add(h.el); out.push(h); }
    }
    return out;
  }
  const nameForms = (name) => { const i = name.indexOf(","); return i < 0 ? [norm(name)] : [norm(name), norm(`${name.slice(i + 1)} ${name.slice(0, i)}`)]; };
  const sameName = (a, b) => { const fa = nameForms(a), nb = norm(b); return fa.some((f) => nb === f || nb.startsWith(f + " ")); };
  // Which grid spot is at (x, y)? -> { name, md, rel, dy } or null
  function gridAt(x, y, target) {
    if (!target || (target.closest && target.closest(NOT_GRID))) return null;
    const leaves = textLeaves();
    const band = dayBands(leaves).find((b) => x >= b.left && x < b.left + b.width && y > b.bottom);
    if (!band) return null;
    // an existing shift (a block smaller than the day with a time on it), not an empty spot
    const own = ownText(target);
    if (own && own.length <= 40 && TIME_RE.test(own) && (!target.childElementCount || target.getBoundingClientRect().width < band.width * 0.9)) return null;
    let name = null, cy = 0;
    const row = target.closest && target.closest("[role=row],tr");
    if (row) {
      const n = [...row.querySelectorAll("*")].find((e) => !e.childElementCount && NAME_RE.test(e.textContent.trim()));
      if (n) { name = n.textContent.replace(/\s+/g, " ").trim(); cy = rowBox(n).cy; }
    }
    if (!name) {
      const h = nameAt(y, dayBands(leaves)[0].left);
      if (h && !onTop(target, h.el)) { name = h.name; const r = h.el.getBoundingClientRect(); cy = r.top + r.height / 2; }
    }
    if (!name) {
      const names = nameLeaves(leaves).map(([e, t]) => ({ t, el: e, r: e.getBoundingClientRect(), b: rowBox(e) })).filter((n) => n.r.right <= x + 4);
      const ys = names.map((n) => n.b.cy).sort((a, b) => a - b);
      const gaps = ys.slice(1).map((v, i) => v - ys[i]).filter((g) => g > 2).sort((a, b) => a - b);
      const rowH = gaps.length ? gaps[gaps.length >> 1] : 30;
      const best = names.sort((a, b) => Math.abs(a.b.cy - y) - Math.abs(b.b.cy - y))[0];
      if (!best || Math.abs(best.b.cy - y) > Math.max(rowH * 0.6, 12)) return null;
      name = best.t; cy = best.b.cy;
      if (onTop(target, best.el)) return null;
    }
    return { name, md: band.md, rel: (x - band.left) / band.width, dy: Math.round(y - cy) };
  }
  // What Zack can send Joseph when a grid click can't be worked out: the clicked spot's
  // tags and attributes (no page text, no other staff, no typed values).
  function debugInfo(target, x, y) {
    const chain = [];
    for (let e = target, n = 0; e && e.nodeType === 1 && n < 10; e = e.parentElement, n++) {
      const a = {};
      for (const at of e.attributes) {
        if (/^(id|class|role|tabindex|title|name|type)$/.test(at.name) || /^(aria-|data-)/.test(at.name)) a[at.name] = at.value.slice(0, 120);
      }
      const r = e.getBoundingClientRect();
      chain.push({ tag: e.tagName.toLowerCase(), attrs: a, box: [r.left, r.top, r.width, r.height].map(Math.round) });
    }
    const leaves = textLeaves();
    return {
      page: location.origin + location.pathname + location.hash.split("?")[0], at: [Math.round(x), Math.round(y)],
      clicked_and_parents: chain,
      day_headers: dayBands(leaves).map((b) => ({ day: b.md, left: Math.round(b.left), width: Math.round(b.width), header_tag: b.el.tagName.toLowerCase() })),
      name_rows_on_screen: nameLeaves(leaves).length,
      name_pane_rows_seen: paneNames().length,
      name_pane_at_click: (() => {
        const left = gridLeft(); if (left < 40) return null;
        const h = nameAt(y, left);
        return {
          found: h ? h.name.slice(0, 60) : null, // only the clicked row's text
          points: [0.15, 0.5, 0.85].map((f) => ({ x: Math.round(left * f), under: document.elementsFromPoint(left * f, y).filter(notPanel).slice(0, 6).map((e) => {
            const r = e.getBoundingClientRect();
            return { tag: e.tagName.toLowerCase(), class: String(e.className && e.className.baseVal != null ? e.className.baseVal : e.className || "").slice(0, 80), role: e.getAttribute("role") || undefined, aria: (e.getAttribute("aria-label") || "").slice(0, 60) || undefined, box: [r.left, r.top, r.width, r.height].map(Math.round) };
          }) })),
        };
      })(),
      scrollers: (() => { const out = []; for (let e = target; e && e.nodeType === 1; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 5) out.push({ tag: e.tagName.toLowerCase(), class: String(e.className || "").slice(0, 60), scrollTop: Math.round(e.scrollTop), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }); return out; })(),
      clicked_height: Math.round(target.getBoundingClientRect().height),
      grid_guess: gridAt(x, y, target),
    };
  }
  function findRow(name) {
    const want = norm(name);
    const ls = nameLeaves();
    const hit = ls.find(([, t]) => norm(t) === want) || ls.find(([, t]) => norm(t).startsWith(want));
    if (hit) return hit[0];
    const p = paneNames().find((h) => sameName(name, h.name));
    return p ? p.el : null;
  }
  // the box that scrolls the grid (real Kronos: krn_scrollable around krn_matrix)
  function gridScroller() {
    const b = dayBands();
    if (!b.length) return null;
    const y = Math.max(...b.map((x) => x.bottom)) + 20;
    const el = document.elementsFromPoint(b[0].left + 10, y).find(notPanel);
    return el ? scroller(el) : null;
  }
  function scroller(el) {
    for (let e = el && el.parentElement; e; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight + 5 && /auto|scroll|overlay/.test(getComputedStyle(e).overflowY)) return e;
    }
    return document.scrollingElement;
  }
  // Is the name really on screen, not hidden under the grid's sticky header or a panel?
  function shown(el) {
    const r = el.getBoundingClientRect(), x = r.left + Math.min(r.width / 2, 20), y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return false;
    const top = document.elementsFromPoint(x, y).find((e) => !(panelHost && (panelHost === e || panelHost.contains(e))));
    return !!top && (top === el || el.contains(top) || (el.parentElement && el.parentElement.contains(top)));
  }
  function viewOf(box) { return box === document.scrollingElement ? { top: 0, bottom: innerHeight } : box.getBoundingClientRect(); }
  async function scrollToRow(name) {
    // like Zack scrolling down the list of names until the person shows up
    const any = nameLeaves()[0];
    const box = (any && scroller(any[0])) || gridScroller();
    if (!box) return null;
    let el = findRow(name);
    if (!el) { box.scrollTop = 0; await sleep(300); }
    for (let k = 0; k < 80; k++) {
      el = findRow(name);
      if (el && shown(el)) return el;
      if (el) { const r = el.getBoundingClientRect(), v = viewOf(box); box.scrollTop += r.top - (v.top + v.bottom) / 2; await sleep(300); continue; }
      const before = box.scrollTop;
      box.scrollTop += box.clientHeight * 0.8; await sleep(300);
      if (box.scrollTop === before) break;
    }
    return findRow(name);
  }
  async function mouseAt(el, x, y, how) {
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
    el.dispatchEvent(new PointerEvent("pointerover", o)); el.dispatchEvent(new MouseEvent("mouseover", o));
    el.dispatchEvent(new PointerEvent("pointermove", o)); el.dispatchEvent(new MouseEvent("mousemove", o));
    await sleep(120);
    el = document.elementsFromPoint(x, y).find(notPanel) || el;
    const press = (button, detail) => {
      const b = { ...o, button, buttons: button === 2 ? 2 : 1, detail };
      el.dispatchEvent(new PointerEvent("pointerdown", b)); el.dispatchEvent(new MouseEvent("mousedown", b));
      el.dispatchEvent(new PointerEvent("pointerup", { ...b, buttons: 0 })); el.dispatchEvent(new MouseEvent("mouseup", { ...b, buttons: 0 }));
      if (button === 0) el.dispatchEvent(new MouseEvent("click", { ...b, buttons: 0 }));
    };
    if (how === "context") { press(2, 1); el.dispatchEvent(new MouseEvent("contextmenu", { ...o, button: 2, buttons: 0 })); return; }
    press(0, 1);
    if (how === "dblclick") { press(0, 2); el.dispatchEvent(new MouseEvent("dblclick", { ...o, button: 0, detail: 2 })); }
  }
  // Click the empty spot for this person on this day, the way Zack did.
  async function clickGrid(step, g) {
    let row = findRow(g.name);
    if (!row || !shown(row)) row = await scrollToRow(g.name);
    if (!row) return { ok: false, why: `I couldn't find ${g.name}'s row on the schedule. Scroll so their name shows, then press Try again (or click their empty spot on ${g.md} yourself and press I did it).` };
    let band = dayBands().find((b) => b.md === g.md);
    if (!band) return { ok: false, why: `The schedule on screen doesn't show ${g.md}. Go to that week in Kronos, then press Try again.` };
    if (band.left < 0 || band.left + band.width > innerWidth) {
      band.el.scrollIntoView({ block: "nearest", inline: "center" }); await sleep(300);
      band = dayBands().find((b) => b.md === g.md) || band; row = findRow(g.name) || row;
    }
    const cy = rowBox(row).cy, dy0 = step.grid.dy || 0;
    // the spot Zack used; if a shift is already there (a double), use a free part of the day
    const tries = [step.grid.rel, 0.15, 0.85, 0.5, 0.3, 0.7, 0.05, 0.95].map((r) => Math.min(0.97, Math.max(0.03, r)));
    // (and above/below a shift bar that fills the day, as in Table view)
    for (const dy of [dy0, -11, 11, -13, 13]) for (const rel of tries) {
      const x = band.left + rel * band.width, y = cy + dy;
      const el = document.elementsFromPoint(x, y).find((e) => !(panelHost && (panelHost === e || panelHost.contains(e))));
      const g2 = el && gridAt(x, y, el);
      if (!g2 || !(norm(g2.name) === norm(g.name) || sameName(g.name, g2.name) || sameName(g2.name, g.name)) || g2.md !== g.md) continue;
      // v3.4 (Zack 10-09: "I either have to double click the person, the day, or right click to get that option"):
      // a plain click doesn't open Add Shift in his Kronos -> try what he did, then double-click, then
      // right-click > Add Shift, then a plain click, until the panel shows up
      // v3.6 (Zack 10-10): in his Kronos a double-click can open the "Schedule Pattern" window instead -> right-click >
      // Add Shift first, a pattern window is closed and never counted as Add Shift, and what worked is tried first next time
      await closePattern();
      const before = panelSig();
      const hows = [...new Set([openHow, "context", step.how && step.how !== "click" ? step.how : "dblclick", "dblclick", "click"].filter(Boolean))];
      for (const how of hows) {
        await mouseAt(el, x, y, how);
        let since = before;
        if (how === "context") {
          const item = await waitAddShiftItem(2000);
          if (!item) { pressKey(document.activeElement || document.body, "Escape"); await sleep(300); continue; }
          // v3.7 (Zack 10-10): his Kronos ignored a bare click on the menu's "Add shift", and the open menu itself
          // counted as the panel -> compare with the menu open, pick the item like a mouse (hover, press), then Enter
          since = panelSig();
          await pickMenuItem(item);
          if (!(await panelOpened(since, 1500)) && item.isConnected && visible(item)) {
            if (item.focus) item.focus();
            pressKey(item, "Enter");
          }
          // v3.8 (Zack 10-10, 3.7 still couldn't press it): the menu is open, so let Zack press "Add shift" himself
          // and carry on by ourselves as soon as the panel shows (no Try again / I did it needed)
          if (!(await panelOpened(since, 2000)) && item.isConnected && visible(item)) {
            try { live("info", "Add shift menu is open but my click didn't work; waiting for Zack to click it"); } catch (er) { /* optional */ }
            try { showProgress(`<p><b>Click <u>Add shift</u> in the menu that's open on the schedule.</b></p><p class="sh-small sh-muted">I'll carry on by myself as soon as the Add Shift window opens.</p>`); } catch (er) { /* not the top frame */ }
            for (const t0 = Date.now(); Date.now() - t0 < 60000;) {
              const r = await panelOpened(since, 1000);
              if (r === true) { openHow = "context"; try { live("info", "Zack clicked Add shift; carrying on"); } catch (er) { /* optional */ } return { ok: true }; }
              if (r === "pattern" || !(item.isConnected && visible(item))) break;
            }
          }
        }
        const got = await panelOpened(since, 3000);
        if (got === "pattern") { await closePattern(); continue; }
        if (got) { openHow = how; return { ok: true }; }
      }
      return { ok: false, why: `I clicked ${g.name}'s spot on ${g.md}, but Kronos didn't open Add Shift. Open it yourself (right-click the spot > Add Shift) and press I did it. If the Schedule Pattern window opened, close it with Cancel first.` };
    }
    return { ok: false, why: `I couldn't find a free spot for ${g.name} on ${g.md} on the grid. Click it yourself and press I did it.` };
  }

  // What the Add Shift panel looks like when it opens: more time/text boxes, a dialog, or its title
  function panelSig() {
    const t = textLeaves().filter(([, x]) => /^(add|edit|new)\s+shift\b/i.test(x)).length;
    return { boxes: timeBoxes().length, inputs: deepAll("input:not([type=hidden]),select,textarea").filter(visible).length,
      dialogs: [...document.querySelectorAll("[role=dialog],[aria-modal=true]")].filter(visible).length, title: t, frames: document.querySelectorAll("iframe").length };
  }
  // Kronos's "Schedule Pattern" window (opens on a double-click in Zack's Kronos): edits the repeating pattern, never use it
  const PATTERN = ".schedule-pattern,.pattern-body,schedule-pattern-tab,schedule-pattern-cell";
  let openHow = null;     // how Add Shift opened last time (tried first)
  const inPattern = (el) => !!(el && el.closest && el.closest(PATTERN));
  function patternWin() {
    const p = deepAll(PATTERN).find(visible);
    return p ? (p.closest("[role=dialog],.modal") || p) : null;
  }
  async function closePattern() {
    for (let k = 0; k < 3; k++) {
      const w = patternWin();
      if (!w) return true;
      const cancel = [...w.querySelectorAll("button,[role=button],a")].find((b) => /^(cancel|close|×|✕)$/i.test((b.innerText || b.getAttribute("aria-label") || b.title || "").trim()));
      if (cancel) clickEl(cancel); else pressKey(document.activeElement || document.body, "Escape");
      await sleep(700);
    }
    return !patternWin();
  }
  async function panelOpened(before, ms) {
    for (const t0 = Date.now(); Date.now() - t0 < ms;) {
      await sleep(250);
      if (patternWin()) return "pattern";
      const n = panelSig();
      if (n.boxes > before.boxes || n.inputs > before.inputs + 1 || n.dialogs > before.dialogs || n.title > before.title || n.frames > before.frames) return true;
    }
    return false;
  }
  // click a menu entry the way a mouse does: move over it, then press on whatever is drawn at its middle
  async function pickMenuItem(item) {
    const r = item.getBoundingClientRect();
    await mouseAt(item, r.left + r.width / 2, r.top + r.height / 2, "click");
  }
  // the "Add Shift" entry of the right-click menu
  async function waitAddShiftItem(ms) {
    for (const t0 = Date.now(); Date.now() - t0 < ms;) {
      await sleep(200);
      const hit = textLeaves().find(([e, x]) => /^\+?\s*add\s+shift\b/i.test(x) && notPanel(e));
      if (hit) return hit[0].closest("[role=menuitem],li,button,a,[tabindex]") || hit[0];
    }
    return null;
  }

  // ---------------- doing a step (same thing Zack would do) ----------------
  function setVal(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  }
  function clickEl(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", o));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    if (el.focus) el.focus();
    el.dispatchEvent(new PointerEvent("pointerup", o));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }
  async function typeInto(el, text, pace) {
    el.scrollIntoView({ block: "center" });
    el.focus();
    setVal(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of text) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      setVal(el, el.value + ch);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
      await sleep(rand(pace.keyMin, pace.keyMax));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // Kronos only takes a typed time/date when you leave the box (the bar and end date
    // update then), so leave it like Zack moving on to the next box
    await sleep(150);
    if (document.activeElement === el) el.blur();
    else { el.dispatchEvent(new FocusEvent("blur")); el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }
    await sleep(350);
  }
  function selectOption(el, text) {
    const opt = [...el.options].find((o) => norm(o.text) === norm(text)) || [...el.options].find((o) => norm(o.value) === norm(text));
    if (!opt) return false;
    el.value = opt.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const KEYCODE = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
  function pressKey(el, key) {
    for (const type of ["keydown", "keyup"]) {
      const ev = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
      Object.defineProperty(ev, "keyCode", { get: () => KEYCODE[key] });
      Object.defineProperty(ev, "which", { get: () => KEYCODE[key] });
      el.dispatchEvent(ev);
    }
    if (key === "Tab") { // a made-up Tab doesn't move the cursor by itself
      const f = [...document.querySelectorAll("input,select,textarea,button,a[href],[tabindex]:not([tabindex='-1'])")].filter(visible);
      const i = f.indexOf(el);
      if (i >= 0 && f[i + 1]) f[i + 1].focus();
    }
  }
  function clueText(d, wantText) {
    const bits = [];
    if (wantText) bits.push(`text "${wantText}"`);
    else if (d.text) bits.push(`text "${d.text}"`);
    for (const [k, w] of [["label", "label"], ["near", "words next to it"], ["aria-label", "screen-reader name"], ["placeholder", "grey hint"]]) if (d[k] && !bits.some((b) => b.includes(d[k]))) bits.push(`${w} "${d[k]}"`);
    if (d.itype && d.itype !== "text") bits.push(`a ${d.itype} box`);
    if (d.pidx != null && d.pidx >= 0) bits.push(`item ${d.pidx + 1} in the open panel`);
    return `a ${/^(input|select|textarea)$/.test(d.tag) ? "box" : d.tag === "button" ? "button" : "thing"} with ${bits.join(", ") || "no name"}`;
  }
  function describeForPeople(d, wantText) {
    return `"${wantText || d.label || d["aria-label"] || d.placeholder || d.text || d.name || d.title || d.tag}"`;
  }

  async function runStep(m) {
    const { step, value, wantText, pace, timeout } = m;
    if (step.action === "key") {
      const el = (step.desc && find(step.desc, null)) || document.activeElement || document.body;
      pressKey(el, step.key);
      return { ok: true };
    }
    if (step.action === "grid") return clickGrid(step, m.grid);
    const el = await waitFind(step.desc, wantText, timeout || 12000, m.loose);
    if (!el) return { ok: false, why: `I couldn't find ${describeForPeople(step.desc, wantText)} on the screen.`, looking: clueText(step.desc, wantText) };
    if (step.action === "click") clickEl(el);
    else if (step.action === "type") await typeInto(el, value, pace);
    else if (step.action === "select") { if (!selectOption(el, value)) return { ok: false, fatal: true, why: `The list ${describeForPeople(step.desc)} has no "${value}".` }; }
    return { ok: true };
  }
  async function stillThere(m) {
    const el = find(m.desc, m.wantText);
    return { ok: true, there: !!el };
  }

  // "Is this shift already on the schedule?" - look for the start time on the
  // employee's row, under that day's column. Only a hint: Zack decides.
  function checkExisting(shifts) {
    const leaves = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && e.textContent.trim() && !(panelHost && panelHost.contains(e)));
    const vis = leaves.filter(visible);
    const heads = [];
    for (const e of vis) {
      const t = e.textContent.trim();
      const mm = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\.?\s+(\d{1,2})\/(\d{1,2})$/i.exec(t);
      if (mm) heads.push({ md: `${Number(mm[2])}/${Number(mm[3])}`, left: e.getBoundingClientRect().left });
    }
    heads.sort((a, b) => a.left - b.left);
    const flagged = [];
    let pane = null; // the separate name column, read once (real Kronos)
    for (const s of shifts) {
      const nameEl = vis.find((e) => norm(e.textContent) === norm(s.kronosName)) || (pane || (pane = paneNames())).find((h) => sameName(s.kronosName, h.name))?.el;
      if (!nameEl) continue;
      const r = nameEl.closest("[role=row],tr")?.getBoundingClientRect() || nameEl.getBoundingClientRect();
      const [, mo, d] = s.date.split("-");
      const hi = heads.findIndex((h) => h.md === `${Number(mo)}/${Number(d)}`);
      const x0 = hi >= 0 ? heads[hi].left - 4 : -Infinity, x1 = hi >= 0 && heads[hi + 1] ? heads[hi + 1].left - 4 : Infinity;
      if (heads.length && hi < 0) continue; // that day isn't on screen
      const hit = vis.some((e) => {
        if (!norm(e.textContent).startsWith(norm(s.startText))) return false;
        const b = e.getBoundingClientRect(), cy = b.top + b.height / 2, cx = b.left + 2;
        return cy >= r.top - 2 && cy <= r.bottom + 2 && cx >= x0 && cx < x1;
      });
      if (hit) flagged.push(s.id);
    }
    return flagged;
  }

  // ---------------- watching ("Show me once") in every frame ----------------
  let recording = false, lastType = null, seqN = 0;
  const fromPanelOnly = (e) => panelHost && e.composedPath().includes(panelHost);
  // v3.6: steps done inside Kronos's Schedule Pattern window are never learned; the helper warns instead
  let patternWarned = 0;
  const fromPanel = (e) => {
    if (fromPanelOnly(e)) return true;
    if (!recording || !inPattern(realTarget(e))) return false;
    if (fixingDbl) return true; // the helper itself closing the pattern window (v3.7)
    if (Date.now() - patternWarned > 4000) { patternWarned = Date.now(); toTop({ type: "rec-pattern" }); }
    return true;
  };
  const realTarget = (e) => { const p = e.composedPath && e.composedPath()[0]; return p && p.nodeType === 1 ? p : e.target; }; // inside shadow roots too
  // "Point to it": the next click on the page is the thing the helper couldn't find
  let pointing = false;
  document.addEventListener("click", (e) => {
    if (!pointing || fromPanel(e)) return;
    pointing = false;
    const el = clickedThing(realTarget(e));
    const a = document.activeElement;
    const tgt = a && a !== el && a.matches && a.matches(FORM) && (el.contains(a) || a.contains(el) || el.tagName === "LABEL") ? a : el;
    toTop({ type: "point-pick", desc: describe(tgt), text: tgt.matches(FORM) ? "" : ownText(tgt).slice(0, 60) });
  }, true);
  const toTop = (msg) => post(window.top, { ...msg, frameKey: FRAME_KEY });
  const CLICKABLE = "button,a,[role=button],[role=option],[role=menuitem],[role=tab],[role=link],[role=checkbox],[role=radio],[role=gridcell],li,label,input,select,textarea,td,th";
  // the thing that was really clicked: a button/option/box, but never a big container
  // (a click on the edge of a time box used to come out as the whole shift row's text)
  function clickedThing(t) {
    const el = t.closest ? (t.closest(CLICKABLE) || t) : t;
    if (el === t || ownText(el).length <= 40) return el;
    for (let e = t; e && e !== el; e = e.parentElement) { const w = ownText(e); if (w && w.length <= 40) return e; }
    return t;
  }
  // Grid spot under the mouse, worked out when the button goes down (before Kronos opens
  // its panel over it). One step per spot: a double-click updates the step it started.
  let down = null, lastGrid = null;
  document.addEventListener("mousedown", (e) => {
    if (!recording || fromPanel(e)) return;
    const t0 = realTarget(e);
    down = { t: t0, at: Date.now(), x: e.clientX, y: e.clientY, g: gridAt(e.clientX, e.clientY, t0) };
  }, true);
  function gridFromEvent(e) {
    const t0 = realTarget(e);
    const d = down && down.t === t0 && Date.now() - down.at < 2000 ? down : { t: t0, x: e.clientX, y: e.clientY, g: gridAt(e.clientX, e.clientY, t0) };
    return d;
  }
  function recordGrid(e, how) {
    const d = gridFromEvent(e);
    if (!d.g) return false;
    const key = `${d.g.name}|${d.g.md}`;
    if (lastGrid && lastGrid.key === key && Date.now() - lastGrid.at < 700) {
      if (how !== "click") toTop({ type: "rec-update", seq: lastGrid.seq, how });
      lastGrid.at = Date.now();
      return true;
    }
    lastGrid = { key, at: Date.now(), seq: `${FRAME_KEY}#g${++seqN}` };
    toTop({ type: "rec-step", step: { action: "grid", how, seq: lastGrid.seq, grid: d.g, desc: describe(e.target), debug: debugInfo(e.target, d.x, d.y) } });
    lastType = null;
    return true;
  }
  document.addEventListener("click", (e) => {
    if (!recording || fromPanel(e)) return;
    if (recordGrid(e, "click")) return;
    if (pointing) return;
    const el = clickedThing(realTarget(e));
    if (el === lastType?.el) return; // clicking into the box being typed in
    const step = { action: "click", desc: describe(el), text: el.matches(FORM) ? "" : ownText(el).slice(0, 60) };
    if (!step.desc.text && !step.desc.label && !step.desc["aria-label"] && !step.desc.title) step.debug = debugInfo(e.target, e.clientX, e.clientY);
    lastType = null;
    // a click on a box's frame or label puts the cursor in the box: record it as that box
    // (the cursor usually moves on mouse-down, so look now; if not yet, look again right after)
    const intoBox = () => {
      const a = document.activeElement;
      if (!a || a === el || !a.matches || !a.matches(FORM) || el.matches("button,a,[role=button],[role=option],[role=menuitem],[role=tab]")) return false;
      step.desc = describe(a); step.text = ""; delete step.debug;
      return true;
    };
    // sent right away (keeps the order, and Apply may close the panel - and its frame - at once);
    // if the cursor lands in a box a moment later, that step is corrected
    step.seq = `${FRAME_KEY}#c${++seqN}`;
    const now = intoBox();
    toTop({ type: "rec-step", step });
    if (!now && !el.matches(FORM)) setTimeout(() => { if (intoBox()) toTop({ type: "rec-update", seq: step.seq, desc: step.desc, text: "" }); }, 0);
  }, true);
  // v3.7 (Joseph 10-10: "make double click available"): a double-click on the grid that opens the Schedule
  // Pattern window is fixed for Zack: the window is closed, the spot is right-clicked > Add Shift, learned as right-click
  let fixingDbl = false;
  document.addEventListener("dblclick", (e) => {
    if (!recording || fromPanel(e) || fixingDbl) return;
    if (!recordGrid(e, "dblclick")) return;
    const x = e.clientX, y = e.clientY, el = realTarget(e), g = lastGrid;
    (async () => {
      fixingDbl = true;
      try {
        for (let k = 0; k < 8 && !patternWin(); k++) await sleep(250);
        if (!patternWin()) return;
        await closePattern();
        g.at = Date.now();
        toTop({ type: "rec-update", seq: g.seq, how: "context" });
        await mouseAt(el, x, y, "context");
        const item = await waitAddShiftItem(2000);
        if (item) await pickMenuItem(item);
        toTop({ type: "rec-dbl-fixed", ok: !!item });
      } finally { fixingDbl = false; }
    })();
  }, true);
  document.addEventListener("contextmenu", (e) => { if (recording && !fromPanel(e)) recordGrid(e, "context"); }, true);
  document.addEventListener("input", (e) => {
    if (!recording || fromPanel(e)) return;
    const el = realTarget(e);
    if (!el.matches || !el.matches("input,textarea") || /^(checkbox|radio|button|submit)$/.test(el.type)) return;
    if (lastType && lastType.el === el) toTop({ type: "rec-update", seq: lastType.seq, value: el.value });
    else {
      lastType = { el, seq: `${FRAME_KEY}#${++seqN}` };
      toTop({ type: "rec-step", step: { action: "type", seq: lastType.seq, desc: describe(el), value: el.value } });
    }
  }, true);
  document.addEventListener("change", (e) => {
    if (!recording || fromPanel(e)) return;
    const el = realTarget(e);
    if (el.tagName !== "SELECT") return;
    toTop({ type: "rec-step", step: { action: "select", desc: describe(el), value: el.options[el.selectedIndex]?.text || el.value } });
    lastType = null;
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!recording || fromPanel(e) || !(e.key in KEYCODE)) return;
    toTop({ type: "rec-step", step: { action: "key", key: e.key, desc: describe(e.target) } });
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") lastType = null;
  }, true);

  // ---------------- messages ----------------
  const pending = {}, acked = new Set(), handled = new Set();
  let teaching = false, recSteps = [], example = null, patternSeen = false;
  let onRecStep = null, checkReplies = null, snapReplies = null, onPointPick = null;
  window.addEventListener("message", async (e) => {
    let m = e.data;
    if (!m || m.__sh !== 1) return;
    if (m.type === "rec-start") { recording = true; lastType = null; }
    if (m.type === "point-start") pointing = true;
    if (m.type === "point-stop") pointing = false;
    if (m.type === "point-pick" && IS_TOP && onPointPick) onPointPick(m);
    if (m.type === "rec-stop") { recording = false; lastType = null; }
    // a frame whose address changed since Show me once (new iframe, about:blank) can still answer
    // if it has the thing on screen right now
    if (m.type === "exec" && m.anyFrame && m.frameKey !== FRAME_KEY && !handled.has(m.reqId)) {
      const st = m.step;
      const can = st.action === "grid" ? dayBands().length > 0 : st.action === "key" ? false : !!find(st.desc, m.wantText, true);
      if (can) m = { ...m, frameKey: FRAME_KEY };
    }
    if ((m.type === "exec" || m.type === "there") && m.frameKey === FRAME_KEY) {
      // the top page repeats a request until some frame takes it (frames can still be loading)
      if (handled.has(m.reqId)) return;
      handled.add(m.reqId);
      post(window.top, { type: "ack", reqId: m.reqId, frameKey: FRAME_KEY });
    }
    if (m.type === "exec" && m.frameKey === FRAME_KEY) {
      const res = await runStep(m).catch((err) => ({ ok: false, why: String(err) }));
      post(window.top, { type: "result", reqId: m.reqId, ...res });
    }
    if (m.type === "there" && m.frameKey === FRAME_KEY) post(window.top, { type: "result", reqId: m.reqId, ...(await stillThere(m)) });
    if (m.type === "check") post(window.top, { type: "check-result", reqId: m.reqId, flagged: checkExisting(m.shifts) });
    if (m.type === "snap") { let snap; try { snap = snapshot(); } catch (err) { snap = { frame: location.pathname, error: String(err) }; } post(window.top, { type: "snap-result", reqId: m.reqId, snap }); }
    if (!IS_TOP) return;
    // a frame that just opened (e.g. the add-shift form) asks whether we're watching
    if (m.type === "hello" && (teaching === "watching" || teaching === "job") && e.source) post(e.source, { type: "rec-start" });
    if ((m.type === "rec-step" || m.type === "rec-update") && onRecStep) onRecStep(m);
    if (m.type === "rec-dbl-fixed" && IS_TOP && teaching === "watching") { patternSeen = !m.ok; try { live("info", m.ok ? "Show me once: double-click opened Schedule Pattern; closed it and opened Add Shift by right-click" : "Show me once: double-click opened Schedule Pattern; closed it, right-click menu had no Add Shift"); } catch (er) { /* optional */ } renderTeach(); }
    if (m.type === "rec-pattern" && IS_TOP && teaching === "watching") { patternSeen = true; try { live("info", "Show me once: Schedule Pattern window opened, steps there ignored"); } catch (er) { /* optional */ } renderTeach(); }
    if (m.type === "ack") acked.add(m.reqId);
    if (m.type === "result" && pending[m.reqId]) { pending[m.reqId](m); delete pending[m.reqId]; }
    if (m.type === "snap-result" && snapReplies && snapReplies.reqId === m.reqId) snapReplies.list.push(m.snap);
    if (m.type === "check-result" && checkReplies && checkReplies.reqId === m.reqId) checkReplies.flagged.push(...m.flagged);
  });

  if (!IS_TOP) { post(window.top, { type: "hello" }); return; }

  // ======================= the panel (top page only) =======================
  let reqN = 0;
  function request(msg, ms) {
    const reqId = `r${++reqN}`;
    return new Promise((res) => {
      pending[reqId] = res;
      const started = Date.now();
      (function send() {
        if (!pending[reqId] || acked.has(reqId)) return;
        if (Date.now() - started > 12000) {
          delete pending[reqId];
          return res({ ok: false, why: "I couldn't find that part of the Kronos screen (the form may not be open)." });
        }
        // after 3 s with no answer from the recorded frame, let any frame that has it answer
        broadcast({ ...msg, reqId, anyFrame: msg.type === "exec" && (msg.anyFrameNow || Date.now() - started > 3000) });
        setTimeout(send, 700);
      })();
      setTimeout(() => { if (pending[reqId]) { delete pending[reqId]; res({ ok: false, why: "That part of the page didn't answer (maybe it was closed)." }); } }, ms);
    });
  }

  panelHost = document.createElement("div");
  panelHost.id = "schedule-helper-panel";
  const shadow = panelHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `<link rel="stylesheet" href="${chrome.runtime.getURL("ui.css")}">
    <div class="sh-panel sh-root">
      <div class="sh-head"><b>Schedule Helper v${chrome.runtime.getManifest().version.replace(/\.0$/, "")}</b><span class="sh-small" id="count"></span><button id="live" class="sh-livebtn" title="Live help: Joseph sees what the helper is doing">Live</button><button id="min" title="Shrink / grow">&#8211;</button></div>
      <div class="sh-livebar" id="livebar" hidden>
        <div class="sh-livehead">&#9679; Live help is ON &ndash; Joseph and Cisco can see what the helper does. <button id="liveoff">Turn off</button></div>
        <div class="sh-livemsgs" id="livemsgs"><div class="sh-muted">Messages from Joseph / Cisco show up here.</div></div>
        <div class="sh-livesend"><input id="livetext" placeholder="Type a message (what you see, what you expected)..." maxlength="600"><button id="livemsg">Send</button></div>
      </div>
      <div class="sh-tabs"><button data-tab="copy">Copy</button><button data-tab="auto">Auto-fill</button><button data-tab="teach">Show me once</button></div>
      <div class="sh-body"><div id="copy"></div><div id="auto"></div><div id="teach"></div></div>
    </div>`;
  (document.body || document.documentElement).appendChild(panelHost);
  const $ = (sel) => shadow.querySelector(sel);
  const panel = $(".sh-panel");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // drag by the header, shrink button
  (function () {
    let dx = 0, dy = 0, drag = false;
    $(".sh-head").addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      drag = true; const r = panel.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      panel.style.left = Math.max(0, e.clientX - dx) + "px"; panel.style.top = Math.max(0, e.clientY - dy) + "px";
      panel.style.right = "auto"; panel.style.bottom = "auto";
    });
    // remember where Zack put it (Kronos' Add Shift panel and its Apply are on the right)
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = false;
      const r = panel.getBoundingClientRect();
      try { chrome.storage.local.set({ sh_panelpos: { left: Math.round(r.left), top: Math.round(r.top) } }); } catch (e) { /* ignore */ }
    });
    try {
      chrome.storage.local.get("sh_panelpos", (v) => {
        const p = v && v.sh_panelpos;
        if (!p) return;
        // keep it on screen if the window got smaller
        panel.style.left = Math.max(0, Math.min(p.left, innerWidth - 120)) + "px";
        panel.style.top = Math.max(0, Math.min(p.top, innerHeight - 60)) + "px";
        panel.style.right = "auto"; panel.style.bottom = "auto";
      });
    } catch (e) { /* ignore */ }
    $("#min").addEventListener("click", () => panel.classList.toggle("sh-min"));
  })();

  // Live help switch: the code (from Joseph, privately) is a Discord webhook link; it's remembered
  window.__shLiveShown = (on) => { $("#livebar").hidden = !on; $("#live").classList.toggle("sh-liveon", on); };
  window.__shLiveShown(liveOn);
  $("#live").addEventListener("click", () => {
    chrome.storage.local.get("sh_live", (v) => {
      const l = (v && v.sh_live) || {};
      if (liveOn) { chrome.storage.local.set({ sh_live: { ...l, on: false } }); return; }
      let code = l.code || "";
      if (!code || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(code)) {
        code = (prompt("Live help lets Joseph watch what the helper does (staff names are shortened to initials).\n\nPaste the Live help code Joseph sent you:") || "").trim();
        if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(code)) {
          if (code) alert("That doesn't look like the Live help code. Copy the whole thing Joseph sent (it starts with https://discord.com/api/webhooks/).");
          return;
        }
      }
      chrome.storage.local.set({ sh_live: { on: true, code, since: Date.now() } }, () => {
        liveOn = true; window.__shLiveShown(true);
        live("info", `Live help ON - helper v${chrome.runtime.getManifest().version}, tab: ${tab}, screen ${innerWidth}x${innerHeight}, ${navigator.userAgent.match(/Chrome\/[\d.]+/) || ""}`);
      });
    });
  });
  $("#liveoff").addEventListener("click", () => { live("info", "Live help turned off by Zack"); chrome.storage.local.get("sh_live", (v) => chrome.storage.local.set({ sh_live: { ...(v.sh_live || {}), on: false } })); });
  // the little chat: Zack's lines go out with a fresh screen description; replies come back through a "mailbox"
  // message that the helper posted itself (Joseph/Cisco edit it; the helper reads it every 4 s with the same code)
  const chatLines = [];
  function addLine(who, text, mine) {
    const box = $("#livemsgs");
    if (!chatLines.length) box.innerHTML = "";
    chatLines.push([who, text]);
    const d = document.createElement("div");
    d.className = mine ? "sh-lm sh-lm-me" : "sh-lm";
    d.innerHTML = `<b>${esc(who)}:</b> ${esc(text)}`;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
    if (!mine) { panel.classList.remove("sh-min"); panel.classList.add("sh-newmsg"); setTimeout(() => panel.classList.remove("sh-newmsg"), 4000); }
  }
  async function sendLine() {
    const inp = $("#livetext"), t = inp.value.trim();
    if (!t || !liveOn) return;
    inp.value = ""; addLine("You", t, true);
    const reqId = `s${++reqN}`;               // a fresh screen description goes with it
    snapReplies = { reqId, list: [] };
    broadcast({ type: "snap", reqId });
    await sleep(1200);
    const frames = snapReplies ? snapReplies.list : []; snapReplies = null;
    live("note", `ZACK SAYS: ${t}`, { helper: chrome.runtime.getManifest().version, tab, screen_now: frames });
  }
  $("#livemsg").addEventListener("click", sendLine);
  $("#livetext").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendLine(); } e.stopPropagation(); });
  // Remote fixes (Joseph 10-10: "make it so you can troubleshoot and fix the process for him"): a mailbox line
  // "⚙ {json}" is a change to the helper's OWN data -- never code. Allowed:
  //   {"say": "..."}                             shown to Zack with the fix
  //   {"step": 2, "part": "job"?, "set": {...}}  change recorded step 2 (0 = first) of the main recording or part 2
  //                                              (keys: how, action, desc, text, value, map, frameKey, isSave)
  //   {"drop": 3, "part": ...}                   remove a recorded step
  //   {"pace": {...}} / {"confirm": "day"|"shift"}  settings
  //   {"retry": true}                            press "Try again" on the stuck card
  //   {"send": "recipe"|"screen"}                send the recording / a fresh screen description to Joseph
  async function applyFix(json) {
    let c;
    try { c = JSON.parse(json); } catch (e) { live("error", "fix not understood: " + json.slice(0, 120)); return; }
    const did = [];
    try {
      const list = c.part === "job" ? recipe && recipe.jobSteps : recipe && recipe.steps;
      if ((c.step !== undefined || c.drop !== undefined) && !list) did.push("no recording yet");
      if (c.step !== undefined && list && list[c.step]) {
        const ok = ["how", "action", "desc", "text", "value", "map", "frameKey", "isSave"];
        for (const [k, v] of Object.entries(c.set || {})) if (ok.includes(k)) { if (v === null) delete list[c.step][k]; else list[c.step][k] = v; }
        did.push(`step ${c.step + 1} changed`);
      }
      if (c.drop !== undefined && list && list[c.drop]) { list.splice(c.drop, 1); did.push(`step ${c.drop + 1} removed`); }
      if (recipe && did.some((d) => /changed|removed/.test(d))) { delete recipe.broken; await S.set("sh_recipe", recipe); }
      if (c.pace || c.confirm) {
        data.settings = { ...(data.settings || {}), ...(c.pace ? { pace: { ...((data.settings || {}).pace || {}), ...c.pace } } : {}), ...(c.confirm ? { confirm: c.confirm } : {}) };
        await S.set("sh_data", data); did.push("settings changed");
      }
      if (c.send === "recipe") { live("info", "recording sent", { helper: chrome.runtime.getManifest().version, recipe }); did.push("recording sent"); }
      if (c.send === "screen") {
        const reqId = `s${++reqN}`; snapReplies = { reqId, list: [] }; broadcast({ type: "snap", reqId }); await sleep(1200);
        const frames = snapReplies ? snapReplies.list : []; snapReplies = null;
        live("info", "screen sent", { helper: chrome.runtime.getManifest().version, tab, screen_now: frames }); did.push("screen sent");
      }
      if (c.retry) { const b = $("#auto [data-ans=retry]"); if (b) { b.click(); did.push("pressed Try again"); } else did.push("nothing to retry"); }
    } catch (e) { did.push("failed: " + e.message); }
    live("info", `FIX APPLIED: ${did.join(", ") || "nothing"}`);
    addLine("Cisco", `🔧 ${c.say || "I adjusted the helper."}${did.length ? ` (${did.join(", ")})` : ""}`, false);
    if (tab === "teach") renderTeach();
  }
  // mailbox lines look like:  `#3` **Cisco:** text
  let seenN = 0;
  (async function pollReplies() {
    for (;;) {
      await sleep(4000);
      if (!liveOn) continue;
      let r;
      try { r = await chrome.runtime.sendMessage({ type: "live-poll" }); } catch (e) { continue; }
      if (!r || !r.content) continue;
      // v3.7: a new mailbox (Live turned off and on, or a new webhook) counts from #1 again -> don't skip its lines
      const top = Math.max(0, ...[...r.content.matchAll(/^`#(\d+)`/gm)].map((x) => Number(x[1])));
      if (top < seenN) seenN = 0;
      for (const line of r.content.split("\n")) {
        const m = line.match(/^`#(\d+)` \*\*(.+?):\*\* ([\s\S]*)$/);
        if (!m || Number(m[1]) <= seenN) continue;
        seenN = Number(m[1]);
        if (m[3].startsWith("⚙ ")) { await applyFix(m[3].slice(2)); continue; }
        addLine(m[2], m[3], false);
      }
    }
  })();

  let tab = "copy";
  function showTab(t) {
    tab = t;
    shadow.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("sh-on", b.dataset.tab === t));
    for (const id of ["copy", "auto", "teach"]) $("#" + id).style.display = id === t ? "" : "none";
    if (t === "auto") renderAuto();
    if (t === "teach") renderTeach();
  }
  shadow.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { if (!running && !teaching) showTab(b.dataset.tab); }));

  let data = null, done = {}, recipe = null;
  // Recordings from before v3.1 saved the click on the real Kronos grid as "this spot on the
  // page" (its hover box), which only ever hits one day. Turn that into a grid step; a step
  // that types into something that isn't a box can't work, so the recording must be redone.
  function fixOldRecipe(r) {
    if (!r || !r.steps) return r;
    for (const st of r.steps) {
      const dbg = st.action === "click" && st.debug;
      const chain = dbg && dbg.clicked_and_parents;
      if (!chain || !chain.some((c) => /\bkrn_(shadow|matrix)\b/.test((c.attrs && c.attrs.class) || ""))) continue;
      const band = (dbg.day_headers || []).find((b) => dbg.at && dbg.at[0] >= b.left && dbg.at[0] < b.left + b.width);
      st.action = "grid"; st.how = "click";
      st.grid = { name: "", md: band ? band.day : "", rel: band ? (dbg.at[0] - band.left) / band.width : 0.5, dy: 0 };
    }
    r.broken = r.steps.some((x) => (x.action === "type" || x.action === "select") && x.desc && !/^(input|select|textarea)$/.test(x.desc.tag))
      // v3.6: a recording made in the Schedule Pattern window (Zack 10-10) has to be redone the Add Shift way
      || r.steps.some((x) => x.desc && (/schedule-pattern/.test(x.desc.path || "") || x.desc.name === "endDateRadio"));
    return r;
  }
  async function loadAll() {
    data = await S.get("sh_data"); done = (await S.get("sh_done")) || {}; recipe = fixOldRecipe(await S.get("sh_recipe"));
    const left = data ? data.shifts.filter((s) => !done[s.id]).length : 0;
    $("#count").textContent = data ? `${left} of ${data.shifts.length} left` : "";
  }
  S.onChange(async () => { await loadAll(); if (!running && !teaching) { if (tab === "auto") renderAuto(); if (tab === "teach") renderTeach(); } });
  globalThis.SHCopyMode($("#copy"), document);

  // ---------------- Show me once ----------------
  recSteps = []; example = null;
  const STEP_WORD = { click: "Click", type: "Type", select: "Pick", key: "Press", grid: "Click" };
  const HOW = { click: "Click", dblclick: "Double-click", context: "Right-click" };
  const mdOf = (s) => { const [, m, d] = s.date.split("-"); return `${Number(m)}/${Number(d)}`; };
  // short words for a step in the "seen so far" lists
  function stepWords(x) {
    if (x.action === "grid") return `${HOW[x.how] || "Click"} the empty spot for ${x.grid.name} on ${x.grid.md}`;
    if (x.action === "key") return `Press ${x.key}`;
    if (x.action === "click") return /^(input|textarea|select)$/.test(x.desc.tag) ? `Click into the ${x.desc.label || x.desc["aria-label"] || x.desc.placeholder || x.desc.name || ""} box` : `Click ${x.text || x.desc.label || x.desc["aria-label"] || x.desc.title || "(a spot)"}`;
    const box = x.desc.label || x.desc["aria-label"] || x.desc.placeholder || x.desc.name;
    return `${STEP_WORD[x.action]} ${x.value}${box ? ` in ${box}` : ""}`;
  }
  function saveDebug(st) {
    // a small file Zack can send Joseph: how this spot of Kronos is built (no names besides the row clicked)
    const blob = new Blob([JSON.stringify({ helper: chrome.runtime.getManifest().version, step: { action: st.action, how: st.how, grid: st.grid, desc: st.desc }, details: st.debug }, null, 1)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "schedule-helper-debug.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function mappingSelect(st, i) {
    const opts = [["fixed", "", R.FIELD_LABELS.fixed]];
    for (const f of ["name", "date", "endDate", "start", "end", "job"]) {
      for (const fmt of Object.keys(R.FIELDS[f])) {
        if (fmt.startsWith("D (") && st.action !== "click") continue;
        opts.push([f, fmt, `${R.FIELD_LABELS[f]} (${fmt})`]);
      }
    }
    const cur = st.map ? `${st.map.field}|${st.map.fmt}` : "fixed|";
    return `<select data-map="${i}">${opts.map(([f, fmt, l]) => `<option value="${f}|${fmt}" ${`${f}|${fmt}` === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }
  function stepLine(st, i) {
    const dbg = st.debug ? ` <button class="sh-small" data-dbg="${i}" title="Saves a small file about this spot on the Kronos page, to send to Joseph">debug export</button>` : "";
    if (st.action === "grid") {
      const same = example && st.grid.name === example.kronosName && st.grid.md === mdOf(example);
      return `<li>${HOW[st.how] || "Click"} <b>the empty spot on the grid</b> for this shift's person and day
        <br><span class="sh-small sh-muted">You clicked ${esc(st.grid.name)} on ${esc(st.grid.md)}${same ? " &#10003;" : ""}. For every shift I'll use that shift's own person and day.</span>
        ${example && !same ? `<div class="sh-warn">That isn't ${esc(example.kronosName)} on ${esc(mdOf(example))} (the shift you picked). If I read the row or day wrong, use <b>debug export</b> and send the file to Joseph.</div>` : ""}
        <br><button class="sh-small" data-del="${i}" title="Remove this step">remove</button>${dbg}</li>`;
    }
    if (st.action === "click" && /^(input|textarea|select)$/.test(st.desc.tag)) {
      return `<li>Click into the <b>${esc(st.desc.label || st.desc["aria-label"] || st.desc.placeholder || st.desc.name || "")}</b> box <button class="sh-small" data-del="${i}" title="Remove this step">remove</button></li>`;
    }
    const what = st.action === "key" ? st.key : st.action === "click" ? (st.text || st.desc.label || st.desc["aria-label"] || st.desc.title || "(a spot with no words)") : st.value;
    const where = st.desc && (st.desc.label || st.desc["aria-label"] || st.desc.placeholder || st.desc.name);
    const mappable = st.action === "type" || st.action === "select" || (st.action === "click" && st.text);
    const risky = st.action === "click" && !st.text && !st.desc.label && !st.desc["aria-label"] && !st.desc.id && !st.desc.title;
    return `<li>${STEP_WORD[st.action]} <b>${esc(what)}</b>${where ? ` <span class="sh-muted">in ${esc(where)}</span>` : ""}
      ${mappable ? `<br>This is: ${mappingSelect(st, i)}` : ""}
      ${st.action === "click" ? `<br><label><input type="radio" name="save" data-save="${i}" ${st.isSave ? "checked" : ""}> this is the Save / Apply button (closes the form)</label>` : ""}
      ${risky ? `<div class="sh-warn">This click has no name I can find again. If it was an empty spot on the schedule grid, I couldn't work out whose row or which day it was: press <b>debug export</b> and send the file to Joseph.</div>` : ""}
      <button class="sh-small" data-del="${i}" title="Remove this step">remove</button>${dbg}</li>`;
  }

  function renderTeach() {
    const el = $("#teach");
    if (!data || !data.shifts.length) { el.innerHTML = `<p class="sh-muted">Load the week first (Schedule Helper button in Chrome's toolbar).</p>`; return; }
    if (teaching === "watching") {
      el.innerHTML = `<p><b>I'm watching.</b> Add this shift in Kronos the normal way, including pressing Save:</p>
        <div class="sh-card"><b>${esc(example.kronosName)}</b><br>${esc(example.day)} ${esc(example.date)} &middot; ${R.niceTime(example.start)} to ${R.niceTime(example.end)} &middot; ${esc(example.kronosJob)}</div>
        <p class="sh-small sh-muted"><b>Double-click</b> (or right-click &gt; <b>Add Shift</b>) the empty spot on the grid for ${esc(example.kronosName)} on ${esc(example.day)}. If Schedule Pattern pops up, I close it and open Add Shift for you. Fill in the panel, then Save. ${recSteps.length} steps seen so far.</p>
        ${patternSeen ? `<div class="sh-warn">That opened the <b>Schedule Pattern</b> window. It changes the person's repeating pattern, so I'm not learning anything from it. Press <b>Cancel</b> in that window, then right-click the empty spot and pick <b>Add Shift</b>.</div>` : ""}
        <ol class="sh-steps">${recSteps.map((s) => `<li>${esc(stepWords(s))}</li>`).join("")}</ol>
        <div class="sh-row"><button class="sh-primary" id="recdone">I saved it - done</button><button id="reccancel">Cancel</button></div>`;
      $("#recdone").onclick = () => { broadcast({ type: "rec-stop" }); teaching = "review"; autoMap(); renderTeach(); };
      $("#reccancel").onclick = () => { broadcast({ type: "rec-stop" }); teaching = false; renderTeach(); };
      return;
    }
    if (teaching === "review") {
      el.innerHTML = `<p>Here's what I saw. Check that each value is labelled right, then save.</p>
        <ol class="sh-steps">${recSteps.map(stepLine).join("")}</ol>
        <label class="sh-small"><input type="checkbox" id="exdone" checked> I saved ${esc(example.kronosName)}'s shift in Kronos (tick it off)</label>
        <div class="sh-row"><button class="sh-primary" id="recsave">Save these steps</button><button id="reccancel">Throw away</button></div>`;
      el.onchange = (e) => {
        const t = e.target;
        if (t.dataset.map) { const [field, fmt] = t.value.split("|"); recSteps[t.dataset.map].map = field === "fixed" ? null : { field, fmt }; }
        if (t.dataset.save) recSteps.forEach((s, i) => { s.isSave = i === Number(t.dataset.save); });
      };
      el.onclick = (e) => {
        const t = e.target;
        if (t.dataset.del) { recSteps.splice(Number(t.dataset.del), 1); renderTeach(); }
        if (t.dataset.dbg) saveDebug(recSteps[t.dataset.dbg]);
      };
      $("#recsave").onclick = async () => {
        if (!recSteps.some((s) => s.isSave)) { alert("Please pick which click was the Save button."); return; }
        await S.set("sh_recipe", { steps: recSteps, jobSteps: recipe?.jobSteps || null, taughtAt: Date.now() });
        if ($("#exdone").checked) await S.markDone(example.id, true);
        teaching = false; await loadAll(); renderTeach();
      };
      $("#reccancel").onclick = () => { teaching = false; renderTeach(); };
      return;
    }
    el.onchange = el.onclick = null;
    const left = data.shifts.filter((s) => !done[s.id]);
    const plain = left.find((s) => !s.jobChange);
    const flaggedLeft = left.filter((s) => s.jobChange);
    const jobInMain = recipe && recipe.steps.some((x) => x.map && x.map.field === "job");
    el.innerHTML = `${recipe ? `<p>&#10003; I know how to add a shift (${recipe.steps.length} steps). You can show me again any time.</p>` : `<p>Show me once how you add one shift in Kronos. I'll watch, then repeat it for the rest.</p>`}
      <label>Shift to add while I watch:<br><select id="ex" style="width:100%">${left.map((s) => `<option value="${esc(s.id)}" ${s === plain ? "selected" : ""}>${esc(s.day)} ${esc(s.kronosName)} ${R.niceTime(s.start)}-${R.niceTime(s.end)}${s.jobChange ? ` &#9888; ${esc(s.kronosJob)} (job change)` : ""}</option>`).join("")}</select></label>
      <p class="sh-small sh-muted">Pick a normal shift for this (no &#9888;). Job-change shifts are part 2 below.</p>
      <div class="sh-row"><button class="sh-primary" id="recgo" ${left.length ? "" : "disabled"}>Start watching</button></div>
      ${recipe ? `<hr><p><b>Part 2 (optional): job-change shifts.</b> ${
        jobInMain ? "You changed the job while I watched, so I already set the job on every shift." :
        recipe.jobSteps ? `&#10003; I know how to change the job on one shift (${recipe.jobSteps.length} steps). I only do it on &#9888; shifts.` :
        "Kronos fills in each person's usual job. For a shift with a different job (a server working Bar) the job has to be changed. Show me once how you do it: I fill in the shift, then you change the job while I watch."}</p>
      ${jobInMain ? "" : flaggedLeft.length ? `<label>Job-change shift:<br><select id="exjob" style="width:100%">${flaggedLeft.map((s) => `<option value="${esc(s.id)}">${esc(s.day)} ${esc(s.kronosName)} ${R.niceTime(s.start)}-${R.niceTime(s.end)}: ${esc(s.usualJob)} &rarr; ${esc(s.kronosJob)}</option>`).join("")}</select></label>
        <div class="sh-row"><button class="sh-primary" id="jobgo">${recipe.jobSteps ? "Show me again on this shift" : "Show me on this shift"}</button>${recipe.jobSteps ? '<button id="jobforget">Forget part 2</button>' : ""}</div>`
        : `<p class="sh-small sh-muted">No job-change shifts left this week.</p>`}` : ""}`;
    if ($("#jobgo")) $("#jobgo").onclick = () => {
      const s = data.shifts.find((x) => x.id === $("#exjob").value);
      showTab("auto"); runOne(s);
    };
    if ($("#jobforget")) $("#jobforget").onclick = async () => { await S.set("sh_recipe", { ...recipe, jobSteps: null }); await loadAll(); renderTeach(); };
    $("#recgo").onclick = () => {
      example = data.shifts.find((s) => s.id === $("#ex").value);
      recSteps = []; teaching = "watching"; patternSeen = false;
      broadcast({ type: "rec-start" });
      renderTeach();
    };
  }
  onRecStep = (m) => {
    if (teaching === "job") return onJobRec && onJobRec(m);
    if (teaching !== "watching") return;
    if (m.type === "rec-update") { const s = recSteps.find((x) => x.seq === m.seq); if (s) fixStep(s, m); }
    else {
      recSteps.push({ ...m.step, frameKey: m.frameKey });
      try { live("info", `Show me once recorded #${recSteps.length}: ${stepWords(recSteps[recSteps.length - 1])}`); } catch (e) { /* words are optional */ }
    }
    renderTeach();
  };
  function fixStep(s, m) {
    if (m.how) s.how = m.how;
    else if (m.desc) { s.desc = m.desc; s.text = m.text; delete s.debug; }
    else s.value = m.value;
  }
  function autoMap() {
    // drop empty typing; label each value; guess the Save button
    recSteps = recSteps.filter((s) => s.action !== "type" || s.value !== "");
    let dates = 0;
    for (const s of recSteps) {
      if (s.action === "grid") { s.map = null; continue; } // always this shift's person + day
      const v = s.action === "click" ? s.text : s.action === "key" ? "" : s.value;
      s.map = v ? R.guessMapping(v, example, { click: s.action === "click" }) : null;
      if (s.map && s.map.field === "date" && s.action !== "click" && ++dates === 2) s.map = { field: "endDate", fmt: s.map.fmt };
    }
    const saves = recSteps.map((s, i) => [s, i]).filter(([s]) => s.action === "click" && /save|submit|apply|ok\b|add\b/i.test(s.text || s.desc["aria-label"] || ""));
    // UKG: the panel's Apply closes the form, then the toolbar Save stores it. The step that
    // closes the form is the first Save/Apply after the last box filled in.
    let filled = -1; recSteps.forEach((s, i) => { if (s.action === "type" || s.action === "select") filled = i; });
    const last = (saves.find(([, i]) => i > filled) || saves[saves.length - 1] || [null, -1])[1];
    recSteps.forEach((s, i) => { s.isSave = i === last; });
  }

  // ---------------- Auto-fill ----------------
  let running = false, stopAsked = false;
  function settings() {
    const d = globalThis.SH_DEFAULTS;
    return { confirm: data?.settings?.confirm || d.confirm, pace: { ...d.pace, ...(data?.settings?.pace || {}) } };
  }
  function renderAuto() {
    const el = $("#auto");
    if (running) return;
    if (!data || !data.shifts.length) { el.innerHTML = `<p class="sh-muted">Load the week first (Schedule Helper button in Chrome's toolbar).</p>`; return; }
    if (!recipe) { el.innerHTML = `<p>Before auto-fill can work, use <b>Show me once</b> to add one shift by hand while I watch.</p>`; return; }
    if (recipe.broken) { el.innerHTML = `<div class="sh-warn">Your <b>Show me once</b> recording won't work: it was made with an older version or in the Schedule Pattern window.</div><p>Please do <b>Show me once</b> again (one shift, about a minute), opening the shift with <b>right-click &gt; Add Shift</b>. After that, auto-fill picks the right person and day by itself.</p>`; return; }
    const days = [...new Set(data.shifts.map((s) => s.day))];
    const left = (d) => data.shifts.filter((s) => s.day === d && !done[s.id]).length;
    const c = settings().confirm;
    el.innerHTML = `<p>I'll type each shift into Kronos myself, one at a time at a normal pace. ${c === "shift" ? "You approve <b>every shift</b> before I save it." : "You approve <b>each day's list</b> before I start it."} You can stop any time.</p>
      <ul class="sh-small">${days.map((d) => `<li>${d}: ${left(d)} to do</li>`).join("")}</ul>
      <div class="sh-row"><button class="sh-primary" id="go">Start</button></div>`;
    $("#go").onclick = runAll;
  }
  function ask(html, buttons) {
    const el = $("#auto");
    live("asked", `${plain(html)}  [${buttons.map(([, l]) => plain(l)).join(" / ")}]`);
    return new Promise((res) => {
      el.innerHTML = `${html}<div class="sh-row">${buttons.map(([k, l, cls]) => `<button data-ans="${k}" class="${cls || ""}">${l}</button>`).join("")}</div>
        <button class="sh-stop sh-danger" data-ans="stop">Stop</button>`;
      el.onclick = (e) => { const b = e.target.closest("[data-ans]"); if (b) { el.onclick = null; live("answer", `Zack pressed: ${plain(b.textContent)}`); res(b.dataset.ans); } };
    });
  }
  function showProgress(html) {
    $("#auto").innerHTML = `${html}<button class="sh-stop sh-danger" id="stopnow">Stop</button>`;
    $("#stopnow").onclick = () => { stopAsked = true; $("#stopnow").textContent = "Stopping after this step..."; };
  }
  const shiftLine = (s) => `<b>${esc(s.kronosName)}</b> ${R.niceTime(s.start)} &ndash; ${R.niceTime(s.end)}${s.overnight ? " (next day)" : ""} &middot; ${s.jobChange ? `<span class="sh-jobtag" title="Usually ${esc(s.usualJob)} in Kronos">&#9888; ${esc(s.kronosJob)} (job change)</span>` : esc(s.kronosJob)}`;

  async function runAll() {
    running = true; stopAsked = false;
    const { confirm, pace } = settings();
    try {
      const days = [...new Set(data.shifts.map((s) => s.day))];
      for (const day of days) {
        let todo = data.shifts.filter((s) => s.day === day && !done[s.id]);
        if (!todo.length) continue;
        showProgress(`Checking what's already on the schedule for ${day}...`);
        const reqId = `c${++reqN}`;
        checkReplies = { reqId, flagged: [] };
        broadcast({ type: "check", reqId, shifts: todo.map((s) => ({ id: s.id, kronosName: s.kronosName, date: s.date, startText: R.niceTime(s.start) })) });
        await sleep(1500);
        const flagged = new Set(checkReplies.flagged);
        checkReplies = null;
        if (stopAsked) break;
        const ans = await ask(`<p><b>${esc(day)} ${esc(todo[0].date)}</b> &mdash; untick anything you don't want added:</p>
          <ol class="sh-list">${todo.map((s, i) => `<li class="${flagged.has(s.id) ? "sh-flag" : ""}"><input type="checkbox" data-pick="${i}" ${flagged.has(s.id) ? "" : "checked"}><span>${esc(s.day)}</span><span>${shiftLine(s)}</span>${flagged.has(s.id) ? '<span title="Looks like this is already on the schedule">&#9888; already there?</span>' : ""}</li>`).join("")}</ol>`,
          [["go", "Add the ticked shifts", "sh-primary"], ["skip", "Skip this day"]]);
        if (ans === "stop") break;
        if (ans === "skip") continue;
        const ticks = [...$("#auto").querySelectorAll("[data-pick]")];
        todo = todo.filter((_, i) => ticks[i] ? ticks[i].checked : true);
        for (let i = 0; i < todo.length; i++) {
          if (stopAsked) break;
          const s = todo[i];
          const r = await enterShift(s, pace, confirm, `${esc(day)}: shift ${i + 1} of ${todo.length}<br>`);
          if (r === "stop") { stopAsked = true; break; }
          if (r === "saved") { done = await S.markDone(s.id, true); await loadAll(); }
          await sleep(rand(pace.shiftMin, pace.shiftMax));
        }
        if (stopAsked) break;
      }
    } finally {
      running = false;
      await loadAll();
      $("#auto").innerHTML = `<p>${stopAsked ? "Stopped." : "All done for this week."} Shifts I saved are ticked off in the Copy tab.</p><div class="sh-row"><button id="again">OK</button></div>`;
      $("#again").onclick = renderAuto;
    }
  }

  // Part 2 of "Show me once": fill in one job-change shift, then watch Zack change the job.
  async function runOne(s) {
    running = true; stopAsked = false;
    const { pace } = settings();
    let r = "stop";
    try {
      r = await enterShift(s, pace, "day", `Part 2: job change<br>`, { teachJob: true });
      if (r === "saved") done = await S.markDone(s.id, true);
    } finally {
      running = false; teaching = false;
      await loadAll();
      $("#auto").innerHTML = `<p>${r === "saved" ? "Saved. " : ""}${recipe?.jobSteps ? "I'll change the job like that on every &#9888; job-change shift." : "I haven't learned the job change yet."}</p><div class="sh-row"><button id="again">OK</button></div>`;
      $("#again").onclick = renderAuto;
    }
  }

  // One step with this shift's values; asks Zack if it can't be done. "ok" | "skipped" | "stop"
  async function doStep(st, s, pace, head, isJob) {
    const value = st.map ? R.formatValue(s, st.map) : st.value;
    const wantText = st.action === "click" && st.map ? value : null;
    for (;;) {
      const grid = st.action === "grid" ? { name: s.kronosName, md: mdOf(s) } : null;
      // Kronos is slow and redraws its panel (even its frame): ask in short rounds for up to 15 s,
      // so whichever frame has the thing once it settles can answer
      const t0 = Date.now(), limit = st.action === "grid" || st.action === "key" ? 0 : 15000;
      live("step", `${s.kronosName} ${s.date}: ${stepWords({ ...st, value, grid: st.action === "grid" ? { ...(st.grid || {}), name: s.kronosName, md: mdOf(s) } : st.grid })}`);
      let res;
      do {
        const since = Date.now() - t0;
        res = await request({ type: "exec", frameKey: st.frameKey, step: { action: st.action, desc: st.desc, key: st.key, how: st.how, grid: st.grid }, value, wantText, grid, pace,
          timeout: limit ? 1500 : undefined, loose: since > 2500, anyFrameNow: since > 3000 }, st.action === "grid" ? 45000 : limit ? 6000 : 20000);
        if (res.ok || res.fatal) break;
        if (limit) await sleep(300);
      } while (Date.now() - t0 < limit);
      if (res.ok) {   // only slow steps are worth a line (each step's start is already sent)
        if (Date.now() - t0 > 4000) live("ok", `done, but it took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return "ok";
      }
      if (liveOn) {   // stuck: send the screen description straight away (what "Save debug file" would hold)
        const reqId = `s${++reqN}`;
        snapReplies = { reqId, list: [] };
        broadcast({ type: "snap", reqId });
        await sleep(1200);
        const frames = snapReplies ? snapReplies.list : []; snapReplies = null;
        live("stuck", `${res.why}${res.looking ? ` | looking for ${res.looking}` : ""}`,
          { helper: chrome.runtime.getManifest().version, step: { action: st.action, how: st.how, grid: st.grid, desc: st.desc, frameKey: st.frameKey }, why: res.why, frames });
      }
      let a, saved = false;
      for (;;) {
        a = await ask(`${head}${shiftLine(s)}<div class="sh-warn">${isJob ? "Changing the job: " : ""}${esc(res.why)}${res.looking ? `<br><span class="sh-small">Looking for ${esc(res.looking)}.</span>` : ""}</div>
          ${st.action !== "key" ? `<p class="sh-small"><b>Point to it:</b> press the button, then click the right ${st.action === "type" || st.action === "select" ? "box" : "thing"} on the Kronos screen. I'll remember it for every shift after this.</p>` : ""}
          <p>${isJob ? `Change the job to <b>${esc(R.formatValue(s, { field: "job", fmt: "Kronos job" }))}</b> yourself and press <b>I did it</b>, or try again.` : "You can do this step by hand and press <b>I did it</b>, or try again."}</p>
          <p class="sh-small">${saved ? "&#10003; Saved <b>schedule-helper-debug.txt</b> in Downloads &ndash; send it to Joseph." : "Stuck? <b>Save debug file</b> and send it to Joseph (it only describes the boxes on the screen)."}</p>`,
          [["retry", "Try again", "sh-primary"], ...(st.action !== "key" ? [["point", "Point to it", "sh-primary"]] : []), ["manual", "I did it"], ["skip", "Skip this shift"], ["debug", "Save debug file"]]);
        if (a === "debug") { await saveStuck(st, res.why); saved = true; continue; }
        if (a === "point") {
          const got = await pointTo(st, s, head);
          if (got === "stop") return "stop";
          if (got === "clicked") return "ok"; // Zack's click did the step itself
          if (got === "learned") break;      // try the step again with what he pointed at
          continue;
        }
        break;
      }
      if (a === "point") continue;
      if (a === "stop") return "stop";
      if (a === "skip") return "skipped";
      if (a === "manual") return "ok";
    }
  }

  // Zack clicks the thing once; the step learns it (old clues kept as a spare) and is saved.
  async function pointTo(st, s, head) {
    const what = st.action === "type" || st.action === "select" ? "box" : "thing";
    const pick = await new Promise((res) => {
      $("#auto").innerHTML = `${head}${shiftLine(s)}<p><b>Click the ${what} on the Kronos screen now.</b></p><p class="sh-small">Looking for ${esc(clueText(st.desc, st.action === "click" && st.map ? R.formatValue(s, st.map) : null))}.</p><button data-ans="cancel">Cancel</button>`;
      onPointPick = (m) => res(m);
      $("#auto").onclick = (e) => { const b = e.target.closest("[data-ans]"); if (b) res(null); };
      broadcast({ type: "point-start" });
    });
    onPointPick = null; $("#auto").onclick = null;
    broadcast({ type: "point-stop" });
    if (!pick) return "cancel";
    if ((st.action === "type" || st.action === "select") && !/^(input|select|textarea)$/.test(pick.desc.tag)) {
      const a = await ask(`${head}${shiftLine(s)}<div class="sh-warn">That wasn't a box you can type in. Click right inside the box (where the cursor goes).</div>`, [["again", "Point again", "sh-primary"], ["cancel", "Cancel"]]);
      return a === "stop" ? "stop" : a === "again" ? pointTo(st, s, head) : "cancel";
    }
    if (st.action === "grid") return "clicked"; // the grid step stays "this person's spot on this day"
    st.alt = st.alt || st.desc;
    st.desc = { ...pick.desc };
    st.frameKey = pick.frameKey;
    if (st.action === "click" && !st.map) st.text = pick.text;
    await S.set("sh_recipe", recipe);
    return st.action === "click" || st.action === "grid" ? "clicked" : "learned";
  }
  async function saveStuck(st, why) {
    const reqId = `s${++reqN}`;
    snapReplies = { reqId, list: [] };
    broadcast({ type: "snap", reqId });
    await sleep(1200);
    const frames = snapReplies.list; snapReplies = null;
    saveDebug({ action: st.action, how: st.how, grid: st.grid, desc: st.desc, debug: { stuck_because: why, looking_in_frame: st.frameKey, frames } });
  }

  // A job-change shift: Kronos filled in the person's usual job; change it for this shift only.
  // Returns "ok" | "saved" (Zack pressed Save himself while showing me) | "skipped" | "stop"
  async function changeJob(s, pace, head, teach) {
    const job = R.formatValue(s, { field: "job", fmt: "Kronos job" });
    const flag = `<div class="sh-jobflag">&#9888; ${esc(R.jobWord(job))} shift &ndash; change the job for this one<br><span>Kronos filled in ${esc(s.usualJob)}; this shift is <b>${esc(job)}</b>.</span></div>`;
    if (recipe.jobSteps && recipe.jobSteps.length && !teach) {
      for (let k = 0; k < recipe.jobSteps.length; k++) {
        if (stopAsked) return "stop";
        showProgress(`${head}${shiftLine(s)}<br><span class="sh-muted">Changing the job to ${esc(job)} (step ${k + 1} of ${recipe.jobSteps.length})...</span>`);
        const r = await doStep(recipe.jobSteps[k], s, pace, head, true);
        if (r !== "ok") return r;
        await sleep(rand(pace.stepMin, pace.stepMax));
      }
      return "ok";
    }
    if (!teach) {
      const a = await ask(`${head}${shiftLine(s)}${flag}<p>I haven't learned how to change the job yet. The form is filled in and I'm waiting before Save.</p>`,
        [["teach", "Show me now (I'll remember)", "sh-primary"], ["manual", "I changed it myself"], ["skip", "Skip this shift"]]);
      if (a === "stop") return "stop";
      if (a === "skip") return "skipped";
      if (a === "manual") return "ok";
    }
    return teachJob(s, head, flag);
  }

  // Watch Zack change the job on the open form, then let him check what was seen.
  let onJobRec = null;
  async function teachJob(s, head, flag) {
    const el = $("#auto");
    const saveStep = recipe.steps.find((x) => x.isSave);
    let rec = [];
    teaching = "job";
    broadcast({ type: "rec-start" });
    const ans = await new Promise((res) => {
      const draw = () => {
        el.innerHTML = `${head}${shiftLine(s)}${flag}<p><b>I'm watching.</b> In the Kronos form, change the job to <b>${esc(s.kronosJob)}</b> the way you normally do. <b>Don't press Save</b> &ndash; I'll do that next.</p>
          <ol class="sh-steps">${rec.map((x) => `<li>${esc(stepWords(x))}</li>`).join("")}</ol>
          <div class="sh-row"><button class="sh-primary" id="jobdone" data-ans="done">I changed it &ndash; done</button><button data-ans="cancel">Cancel</button></div>`;
      };
      onJobRec = (m) => {
        if (m.type === "rec-update") { const x = rec.find((y) => y.seq === m.seq); if (x) fixStep(x, m); }
        else rec.push({ ...m.step, frameKey: m.frameKey });
        draw();
      };
      draw();
      el.onclick = (e) => { const b = e.target.closest("[data-ans]"); if (b) { el.onclick = null; res(b.dataset.ans); } };
    });
    broadcast({ type: "rec-stop" });
    teaching = false; onJobRec = null;
    if (ans === "cancel") {
      const a = await ask(`${head}${shiftLine(s)}${flag}<p>OK, I won't learn it now. Change the job yourself, then press <b>I changed it</b>.</p>`,
        [["manual", "I changed it", "sh-primary"], ["skip", "Skip this shift"]]);
      return a === "manual" ? "ok" : a === "skip" ? "skipped" : "stop";
    }
    // tidy up: no empty typing; pressing Save isn't part of changing the job
    rec = rec.filter((x) => x.action !== "type" || x.value !== "");
    const isSave = (x) => saveStep && x.action === "click" && x.frameKey === saveStep.frameKey && x.desc.tag === saveStep.desc.tag && (x.text || "") === (saveStep.text || "");
    const savedByZack = rec.some(isSave);
    rec = rec.filter((x) => !isSave(x));
    for (const x of rec) {
      const v = x.action === "click" ? x.text : x.action === "key" ? "" : x.value;
      x.map = v ? R.guessMapping(v, s, { click: x.action === "click" }) : null;
      if (x.map && x.map.field !== "job") x.map = null; // only the job changes here
      if (!x.map && v && x.action !== "click" && v.length >= 2 && norm(s.kronosJob).startsWith(norm(v))) x.map = { field: "job", fmt: "Kronos job" };
    }
    if (!rec.length) {
      const a = await ask(`${head}${shiftLine(s)}<div class="sh-warn">I didn't see you change anything.</div>`, [["manual", "It's changed now", "sh-primary"], ["skip", "Skip this shift"]]);
      return a === "manual" ? (savedByZack ? "saved" : "ok") : a === "skip" ? "skipped" : "stop";
    }
    const keep = await new Promise((res) => {
      const draw = () => {
        el.innerHTML = `<p>Here's how you changed the job. The step where the job name changes from shift to shift should say <b>Job</b>.</p>
          <ol class="sh-steps">${rec.map((x, i) => `<li>${STEP_WORD[x.action]} <b>${esc(x.action === "key" ? x.key : x.action === "click" ? x.text || x.desc.label || x.desc["aria-label"] || "(a spot)" : x.value)}</b>
            ${x.action === "type" || x.action === "select" || (x.action === "click" && x.text) ? `<br>This is: ${mappingSelect(x, i)}` : ""}
            <button class="sh-small" data-del="${i}">remove</button></li>`).join("")}</ol>
          ${rec.some((x) => x.map) ? "" : '<div class="sh-warn">None of these steps is marked as the Job, so I would pick the same job every time. Mark the step where you picked the job.</div>'}
          <div class="sh-row"><button class="sh-primary" id="jobkeep" data-ans="keep">Remember these steps</button><button data-ans="once">Just this once</button></div>`;
      };
      draw();
      el.onchange = (e) => { const t = e.target; if (t.dataset.map) { const [field, fmt] = t.value.split("|"); rec[t.dataset.map].map = field === "fixed" ? null : { field, fmt }; draw(); } };
      el.onclick = (e) => {
        const t = e.target;
        if (t.dataset.del) { rec.splice(Number(t.dataset.del), 1); return draw(); }
        const b = t.closest("[data-ans]"); if (b) { el.onclick = el.onchange = null; res(b.dataset.ans); }
      };
    });
    if (keep === "keep") { recipe = { ...recipe, jobSteps: rec }; await S.set("sh_recipe", recipe); }
    return savedByZack ? "saved" : "ok";
  }

  // One shift: do every learned step with this shift's values. Returns "saved" | "skipped" | "stop".
  // v3.4: the recording from its first box on, after one "open Add Shift for this person on this day" step
  // that the helper does itself (Zack's recordings didn't always catch how he opened the panel: a
  // double-click, or right-click > Add Shift)
  const isBoxStep = (x) => x.action === "type" || x.action === "select" || (x.action === "click" && x.desc && /^(input|select|textarea)$/.test(x.desc.tag));
  function runSteps() {
    const all = recipe.steps, first = all.findIndex(isBoxStep);
    if (first < 0) return all;
    const g = all.slice(0, first).find((x) => x.action === "grid");
    const open = g ? { ...g } : { action: "grid", how: "dblclick", grid: { name: "", md: "", rel: 0.5, dy: 0 }, frameKey: all[first].frameKey };
    return [open, ...all.slice(first)];
  }
  async function enterShift(s, pace, confirm, head, opts = {}) {
    const steps = runSteps();
    const saveAt = steps.findIndex((x) => x.isSave);
    const jobInMain = steps.some((x) => x.map && x.map.field === "job");
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (stopAsked) return "stop";
      if (i === saveAt && s.jobChange && !jobInMain) {
        const r = await changeJob(s, pace, head, opts.teachJob);
        if (r === "saved") return "saved";
        if (r !== "ok") return r;
      }
      if (i === saveAt && (confirm === "shift" || opts.teachJob)) {
        const a = await ask(`${head}<p>Everything is filled in for ${shiftLine(s)}.<br>Check the Kronos form. Save it?</p>`,
          [["save", "Save", "sh-primary"], ["skip", "Skip (close the form yourself)"]]);
        if (a === "stop") return "stop";
        if (a === "skip") return "skipped";
      }
      showProgress(`${head}${shiftLine(s)}<br><span class="sh-muted">Step ${i + 1} of ${steps.length}: ${STEP_WORD[st.action]}...</span>`);
      const r = await doStep(st, s, pace, head);
      if (r !== "ok") return r;
      const wantText = st.action === "click" && st.map ? R.formatValue(s, st.map) : null;
      if (i === saveAt) {
        // wait for Kronos to close the form; if it doesn't, it probably showed an error
        await sleep(1500);
        let gone = false;
        // the form is gone when its boxes are gone (a toolbar Save button stays on screen)
        const box = steps.slice(0, i).reverse().find((x) => (x.action === "type" || x.action === "select") && x.frameKey === st.frameKey);
        const probe = box ? { desc: box.desc, wantText: null } : { desc: st.desc, wantText };
        for (let k = 0; k < 16 && !gone; k++) {
          const t = await request({ type: "there", frameKey: st.frameKey, ...probe }, 3000);
          gone = !t.ok || !t.there;
          if (!gone) await sleep(500);
        }
        if (!gone) {
          const a = await ask(`${head}${shiftLine(s)}<div class="sh-warn">Kronos still shows the form after Save. It may be showing a message.</div><p>Sort it out on the Kronos screen, then tell me what happened.</p>`,
            [["saved", "It's saved now", "sh-primary"], ["skip", "Not saved, skip it"]]);
          if (a === "stop") return "stop";
          if (a === "skip") return "skipped";
        }
      }
      await sleep(rand(pace.stepMin, pace.stepMax));
    }
    return "saved";
  }

  loadAll().then(() => showTab("copy"));
})();
