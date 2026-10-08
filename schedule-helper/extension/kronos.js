// Runs on the Kronos (UKG) pages. Two jobs:
//  * in EVERY frame: watch Zack's clicks/typing while "Show me once" is on, and
//    repeat a single step when the panel asks (find the field, type into it
//    at a normal pace, or click it). Kronos puts its screens inside frames, so
//    frames talk to the top page with window.postMessage.
//  * in the TOP page only: the Schedule Helper panel (Copy / Auto-fill / Show me once).
// Nothing here logs in, sends data anywhere, or calls Kronos behind the screen:
// it only uses the same buttons and boxes Zack does, one shift at a time.
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
    const t = ownText(el); if (t) d.text = t;
    const l = labelOf(el); if (l) d.label = l;
    d.path = cssPath(el);
    return d;
  }
  function score(el, d, wantText) {
    let s = el.tagName.toLowerCase() === d.tag ? 1 : -3;
    if (d.id && el.id === d.id) s += 10;
    for (const a of ATTRS) if (d[a] && el.getAttribute(a) === d[a]) s += a === "type" || a === "role" ? 1 : 6;
    if (d.label && labelOf(el) === d.label) s += 6;
    const t = ownText(el);
    if (wantText != null) {
      if (norm(t) === norm(wantText)) s += 8;
      else if (norm(t).startsWith(norm(wantText))) s += 4;
      else return -99;
    } else if (d.text) {
      s += t === d.text ? 6 : -4;
    }
    try { if (d.path && el.matches(d.path.split(" > ").pop()) && document.querySelector(d.path) === el) s += 3; } catch (e) { /* bad selector */ }
    return s;
  }
  function find(d, wantText) {
    let pool = [...document.querySelectorAll(d.tag)];
    if (wantText != null) pool = pool.concat([...document.querySelectorAll("[role=option],[role=menuitem],[role=gridcell],li,button,a,td,span,div")]);
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
  async function waitFind(d, wantText, ms) {
    const until = Date.now() + ms;
    for (;;) {
      const el = find(d, wantText);
      if (el || Date.now() > until) return el;
      await sleep(250);
    }
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
    const el = await waitFind(step.desc, wantText, timeout || 12000);
    if (!el) return { ok: false, why: `I couldn't find ${describeForPeople(step.desc, wantText)} on the screen.` };
    if (step.action === "click") clickEl(el);
    else if (step.action === "type") await typeInto(el, value, pace);
    else if (step.action === "select") { if (!selectOption(el, value)) return { ok: false, why: `The list ${describeForPeople(step.desc)} has no "${value}".` }; }
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
    for (const s of shifts) {
      const nameEl = vis.find((e) => norm(e.textContent) === norm(s.kronosName));
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
  const fromPanel = (e) => panelHost && e.composedPath().includes(panelHost);
  const toTop = (msg) => post(window.top, { ...msg, frameKey: FRAME_KEY });
  const CLICKABLE = "button,a,[role=button],[role=option],[role=menuitem],[role=tab],[role=link],[role=checkbox],[role=radio],[role=gridcell],li,label,input,select,textarea,td,th";
  document.addEventListener("click", (e) => {
    if (!recording || fromPanel(e)) return;
    const el = e.target.closest ? (e.target.closest(CLICKABLE) || e.target) : e.target;
    if (el === lastType?.el) return; // clicking into the box being typed in
    toTop({ type: "rec-step", step: { action: "click", desc: describe(el), text: ownText(el) } });
    lastType = null;
  }, true);
  document.addEventListener("input", (e) => {
    if (!recording || fromPanel(e)) return;
    const el = e.target;
    if (!el.matches || !el.matches("input,textarea") || /^(checkbox|radio|button|submit)$/.test(el.type)) return;
    if (lastType && lastType.el === el) toTop({ type: "rec-update", seq: lastType.seq, value: el.value });
    else {
      lastType = { el, seq: `${FRAME_KEY}#${++seqN}` };
      toTop({ type: "rec-step", step: { action: "type", seq: lastType.seq, desc: describe(el), value: el.value } });
    }
  }, true);
  document.addEventListener("change", (e) => {
    if (!recording || fromPanel(e)) return;
    const el = e.target;
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
  let teaching = false, recSteps = [], example = null;
  let onRecStep = null, checkReplies = null;
  window.addEventListener("message", async (e) => {
    const m = e.data;
    if (!m || m.__sh !== 1) return;
    if (m.type === "rec-start") { recording = true; lastType = null; }
    if (m.type === "rec-stop") { recording = false; lastType = null; }
    if ((m.type === "exec" || m.type === "there") && m.frameKey === FRAME_KEY) {
      // the top page repeats a request until some frame takes it (frames can still be loading)
      if (handled.has(m.reqId)) return;
      handled.add(m.reqId);
      post(window.top, { type: "ack", reqId: m.reqId });
    }
    if (m.type === "exec" && m.frameKey === FRAME_KEY) {
      const res = await runStep(m).catch((err) => ({ ok: false, why: String(err) }));
      post(window.top, { type: "result", reqId: m.reqId, ...res });
    }
    if (m.type === "there" && m.frameKey === FRAME_KEY) post(window.top, { type: "result", reqId: m.reqId, ...(await stillThere(m)) });
    if (m.type === "check") post(window.top, { type: "check-result", reqId: m.reqId, flagged: checkExisting(m.shifts) });
    if (!IS_TOP) return;
    // a frame that just opened (e.g. the add-shift form) asks whether we're watching
    if (m.type === "hello" && teaching === "watching" && e.source) post(e.source, { type: "rec-start" });
    if ((m.type === "rec-step" || m.type === "rec-update") && onRecStep) onRecStep(m);
    if (m.type === "ack") acked.add(m.reqId);
    if (m.type === "result" && pending[m.reqId]) { pending[m.reqId](m); delete pending[m.reqId]; }
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
        broadcast({ ...msg, reqId });
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
      <div class="sh-head"><b>Schedule Helper</b><span class="sh-small" id="count"></span><button id="min" title="Shrink / grow">&#8211;</button></div>
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
    window.addEventListener("mouseup", () => { drag = false; });
    $("#min").addEventListener("click", () => panel.classList.toggle("sh-min"));
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
  async function loadAll() {
    data = await S.get("sh_data"); done = (await S.get("sh_done")) || {}; recipe = await S.get("sh_recipe");
    const left = data ? data.shifts.filter((s) => !done[s.id]).length : 0;
    $("#count").textContent = data ? `${left} of ${data.shifts.length} left` : "";
  }
  S.onChange(async () => { await loadAll(); if (!running && !teaching) { if (tab === "auto") renderAuto(); if (tab === "teach") renderTeach(); } });
  globalThis.SHCopyMode($("#copy"), document);

  // ---------------- Show me once ----------------
  recSteps = []; example = null;
  const STEP_WORD = { click: "Click", type: "Type", select: "Pick", key: "Press" };

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
    if (st.action === "click" && /^(input|textarea|select)$/.test(st.desc.tag)) {
      return `<li>Click into the <b>${esc(st.desc.label || st.desc["aria-label"] || st.desc.placeholder || st.desc.name || "")}</b> box <button class="sh-small" data-del="${i}" title="Remove this step">remove</button></li>`;
    }
    const what = st.action === "key" ? st.key : st.action === "click" ? (st.text || st.desc.label || st.desc["aria-label"] || st.desc.title || "(a spot with no words)") : st.value;
    const where = st.desc && (st.desc.label || st.desc["aria-label"] || st.desc.placeholder || st.desc.name);
    const mappable = st.action === "type" || st.action === "select" || (st.action === "click" && st.text);
    const risky = st.action === "click" && !st.text && !st.desc.label && !st.desc["aria-label"] && !st.desc.id && !st.desc.title;
    return `<li>${STEP_WORD[st.action]} <b>${esc(what)}</b>${where ? ` <span class="sh-muted">in ${esc(where)}</span>` : ""}
      ${mappable ? `<br>This is: ${mappingSelect(st, i)}` : ""}
      ${st.action === "click" ? `<br><label><input type="radio" name="save" data-save="${i}" ${st.isSave ? "checked" : ""}> this is the Save button</label>` : ""}
      ${risky ? `<div class="sh-warn">This click has no name I can find again. If it was a spot on the schedule grid, please use Kronos' "Add shift" button instead and show me again.</div>` : ""}
      <button class="sh-small" data-del="${i}" title="Remove this step">remove</button></li>`;
  }

  function renderTeach() {
    const el = $("#teach");
    if (!data || !data.shifts.length) { el.innerHTML = `<p class="sh-muted">Load the week first (Schedule Helper button in Chrome's toolbar).</p>`; return; }
    if (teaching === "watching") {
      el.innerHTML = `<p><b>I'm watching.</b> Add this shift in Kronos the normal way, including pressing Save:</p>
        <div class="sh-card"><b>${esc(example.kronosName)}</b><br>${esc(example.day)} ${esc(example.date)} &middot; ${R.niceTime(example.start)} to ${R.niceTime(example.end)} &middot; ${esc(example.kronosJob)}</div>
        <p class="sh-small sh-muted">Use Kronos' own add-shift button and type the times into the boxes (not the grid). ${recSteps.length} steps seen so far.</p>
        <ol class="sh-steps">${recSteps.map((s) => `<li>${STEP_WORD[s.action]} ${esc(s.action === "click" ? s.text || s.desc.label || "" : s.action === "key" ? s.key : s.value)}</li>`).join("")}</ol>
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
      el.onclick = (e) => { const t = e.target; if (t.dataset.del) { recSteps.splice(Number(t.dataset.del), 1); renderTeach(); } };
      $("#recsave").onclick = async () => {
        if (!recSteps.some((s) => s.isSave)) { alert("Please pick which click was the Save button."); return; }
        await S.set("sh_recipe", { steps: recSteps, taughtAt: Date.now() });
        if ($("#exdone").checked) await S.markDone(example.id, true);
        teaching = false; await loadAll(); renderTeach();
      };
      $("#reccancel").onclick = () => { teaching = false; renderTeach(); };
      return;
    }
    el.onchange = el.onclick = null;
    const left = data.shifts.filter((s) => !done[s.id]);
    el.innerHTML = `${recipe ? `<p>&#10003; I know how to add a shift (${recipe.steps.length} steps). You can show me again any time.</p>` : `<p>Show me once how you add one shift in Kronos. I'll watch, then repeat it for the rest.</p>`}
      <label>Shift to add while I watch:<br><select id="ex" style="width:100%">${left.map((s) => `<option value="${esc(s.id)}">${esc(s.day)} ${esc(s.kronosName)} ${R.niceTime(s.start)}-${R.niceTime(s.end)}</option>`).join("")}</select></label>
      <div class="sh-row"><button class="sh-primary" id="recgo" ${left.length ? "" : "disabled"}>Start watching</button></div>`;
    $("#recgo").onclick = () => {
      example = data.shifts.find((s) => s.id === $("#ex").value);
      recSteps = []; teaching = "watching";
      broadcast({ type: "rec-start" });
      renderTeach();
    };
  }
  onRecStep = (m) => {
    if (teaching !== "watching") return;
    if (m.type === "rec-update") { const s = recSteps.find((x) => x.seq === m.seq); if (s) s.value = m.value; }
    else recSteps.push({ ...m.step, frameKey: m.frameKey });
    renderTeach();
  };
  function autoMap() {
    // drop empty typing; label each value; guess the Save button
    recSteps = recSteps.filter((s) => s.action !== "type" || s.value !== "");
    let dates = 0;
    for (const s of recSteps) {
      const v = s.action === "click" ? s.text : s.action === "key" ? "" : s.value;
      s.map = v ? R.guessMapping(v, example, { click: s.action === "click" }) : null;
      if (s.map && s.map.field === "date" && s.action !== "click" && ++dates === 2) s.map = { field: "endDate", fmt: s.map.fmt };
    }
    const saves = recSteps.map((s, i) => [s, i]).filter(([s]) => s.action === "click" && /save|submit|apply|ok\b|add\b/i.test(s.text || s.desc["aria-label"] || ""));
    const last = saves.length ? saves[saves.length - 1][1] : -1;
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
    return new Promise((res) => {
      el.innerHTML = `${html}<div class="sh-row">${buttons.map(([k, l, cls]) => `<button data-ans="${k}" class="${cls || ""}">${l}</button>`).join("")}</div>
        <button class="sh-stop sh-danger" data-ans="stop">Stop</button>`;
      el.onclick = (e) => { const b = e.target.closest("[data-ans]"); if (b) { el.onclick = null; res(b.dataset.ans); } };
    });
  }
  function showProgress(html) {
    $("#auto").innerHTML = `${html}<button class="sh-stop sh-danger" id="stopnow">Stop</button>`;
    $("#stopnow").onclick = () => { stopAsked = true; $("#stopnow").textContent = "Stopping after this step..."; };
  }
  const shiftLine = (s) => `<b>${esc(s.kronosName)}</b> ${R.niceTime(s.start)} &ndash; ${R.niceTime(s.end)}${s.overnight ? " (next day)" : ""} &middot; ${esc(s.kronosJob)}`;

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

  // One shift: do every learned step with this shift's values. Returns "saved" | "skipped" | "stop".
  async function enterShift(s, pace, confirm, head) {
    const steps = recipe.steps;
    const saveAt = steps.findIndex((x) => x.isSave);
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (stopAsked) return "stop";
      if (i === saveAt && confirm === "shift") {
        const a = await ask(`${head}<p>Everything is filled in for ${shiftLine(s)}.<br>Check the Kronos form. Save it?</p>`,
          [["save", "Save", "sh-primary"], ["skip", "Skip (close the form yourself)"]]);
        if (a === "stop") return "stop";
        if (a === "skip") return "skipped";
      }
      showProgress(`${head}${shiftLine(s)}<br><span class="sh-muted">Step ${i + 1} of ${steps.length}: ${STEP_WORD[st.action]}...</span>`);
      const value = st.map ? R.formatValue(s, st.map) : st.value;
      const wantText = st.action === "click" && st.map ? value : null;
      for (;;) {
        const res = await request({ type: "exec", frameKey: st.frameKey, step: { action: st.action, desc: st.desc, key: st.key }, value, wantText, pace }, 20000);
        if (res.ok) break;
        const a = await ask(`${head}${shiftLine(s)}<div class="sh-warn">${esc(res.why)}</div><p>You can do this step by hand and press <b>I did it</b>, or try again.</p>`,
          [["retry", "Try again", "sh-primary"], ["manual", "I did it"], ["skip", "Skip this shift"]]);
        if (a === "stop") return "stop";
        if (a === "skip") return "skipped";
        if (a === "manual") break;
      }
      if (i === saveAt) {
        // wait for Kronos to close the form; if it doesn't, it probably showed an error
        await sleep(1500);
        let gone = false;
        for (let k = 0; k < 16 && !gone; k++) {
          const t = await request({ type: "there", frameKey: st.frameKey, desc: st.desc, wantText }, 3000);
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
