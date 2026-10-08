// Copy mode: shows one shift at a time with a copy button per field.
// Zack clicks into each Kronos field himself and pastes (Ctrl+V).
// Used by the panel on the Kronos page and by the review screen.
(function () {
  const R = globalThis.SHRoster, S = globalThis.SHStore;
  const ORDER = ["name", "date", "start", "end", "job"];
  const LABEL = { name: "Name", date: "Date", start: "Start", end: "End", job: "Job" };
  const DEFAULT_FMT = { name: "Last, First", date: "MM/DD/YYYY", start: "h:mm AM", end: "h:mm AM", job: "Kronos job" };
  const DAYNAME = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  async function copyText(text, doc) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
    const ta = doc.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    doc.body.appendChild(ta); ta.select();
    const ok = doc.execCommand("copy"); ta.remove();
    return ok;
  }

  function shortDate(iso) { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; }

  globalThis.SHCopyMode = function mount(root, doc = document) {
    let data = null, done = {}, st = { idx: 0, field: -1, fmt: { ...DEFAULT_FMT }, day: "" };
    let note = "";

    const valueOf = (s, f) => (f === "date" ? R.formatValue(s, { field: "date", fmt: st.fmt.date })
      : f === "job" ? R.formatValue(s, { field: "job", fmt: st.fmt.job })
      : R.formatValue(s, { field: f, fmt: st.fmt[f] }));

    async function load() {
      data = await S.get("sh_data");
      done = (await S.get("sh_done")) || {};
      const saved = await S.get("sh_copy");
      if (saved) st = { ...st, ...saved, fmt: { ...DEFAULT_FMT, ...(saved.fmt || {}) } };
      else {
        // first time: copy the formats Kronos used in "Show me once", if taught
        const recipe = await S.get("sh_recipe");
        (recipe?.steps || []).forEach((s) => { if (s.map && st.fmt[s.map.field] && !s.map.fmt.startsWith("D (")) st.fmt[s.map.field] = s.map.fmt; });
      }
      if (data && st.idx >= data.shifts.length) st.idx = 0;
      render();
    }
    const save = () => S.set("sh_copy", st);

    function nextNotDone(from, dir = 1) {
      const n = data.shifts.length;
      for (let k = 1; k <= n; k++) {
        const i = (((from + dir * k) % n) + n) % n;
        if (!done[data.shifts[i].id]) return i;
      }
      return from;
    }

    function render() {
      if (!data || !data.shifts?.length) {
        root.innerHTML = `<p class="sh-muted">No schedule loaded yet. Click the Schedule Helper button in Chrome's toolbar and pick the Weekly Roster file.</p>`;
        return;
      }
      const s = data.shifts[st.idx];
      const left = data.shifts.filter((x) => !done[x.id]).length;
      const days = [...new Set(data.shifts.map((x) => x.day))];
      const list = data.shifts.map((x, i) => ({ x, i })).filter(({ x }) => !st.day || x.day === st.day);
      const fmtSel = (f) => `<select data-fmt="${f}">${Object.keys(R.FIELDS[f]).filter((k) => !k.startsWith("D (")).map((k) =>
        `<option ${k === st.fmt[f] ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>`;
      root.innerHTML = `
        <div class="sh-card ${done[s.id] ? "sh-isdone" : ""}">
          <div class="sh-cardtop">${esc(DAYNAME[s.day])} ${shortDate(s.date)} &middot; shift ${st.idx + 1} of ${data.shifts.length} &middot; ${left} left${done[s.id] ? " &middot; <b>done</b>" : ""}</div>
          <div class="sh-fields">
            ${ORDER.map((f, k) => `<button class="sh-field ${k === st.field ? "sh-active" : ""}" data-copy="${f}" title="Copy ${LABEL[f]}">
              <span class="sh-flabel">${LABEL[f]}</span><span class="sh-fval">${esc(valueOf(s, f))}${f === "end" && s.overnight ? ' <i>(next day)</i>' : ""}</span></button>`).join("")}
          </div>
          <button class="sh-big" data-act="nextfield">Copy next field &#9654;</button>
          <div class="sh-note" aria-live="polite">${note}</div>
          <div class="sh-row">
            <button data-act="prev">&#9664; Back</button>
            <button class="sh-primary" data-act="done">${done[s.id] ? "Not done" : "&#10003; Done, next shift"}</button>
            <button data-act="skip">Skip &#9654;</button>
          </div>
        </div>
        <div class="sh-row sh-small">
          <label>Show <select data-day><option value="">all days</option>${days.map((d) => `<option ${d === st.day ? "selected" : ""} value="${d}">${DAYNAME[d]}</option>`).join("")}</select></label>
        </div>
        <ol class="sh-list">
          ${list.map(({ x, i }) => `<li class="${i === st.idx ? "sh-cur" : ""} ${done[x.id] ? "sh-done" : ""}" data-go="${i}">
            <input type="checkbox" data-tick="${i}" ${done[x.id] ? "checked" : ""} title="Done">
            <span>${esc(x.day)} ${shortDate(x.date)}</span><b>${esc(x.kronosName)}</b><span>${R.niceTime(x.start)}&ndash;${R.niceTime(x.end)}</span><span class="sh-muted">${esc(x.kronosJob)}</span></li>`).join("")}
        </ol>
        <details class="sh-small"><summary>Text formats (match what Kronos expects)</summary>
          <div class="sh-fmts">Name ${fmtSel("name")} Date ${fmtSel("date")} Start ${fmtSel("start")} End ${fmtSel("end")}</div>
        </details>`;
      const cur = root.querySelector(".sh-cur");
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    }

    async function doCopy(f) {
      const s = data.shifts[st.idx];
      const v = valueOf(s, f);
      const ok = await copyText(v, doc);
      st.field = ORDER.indexOf(f);
      note = ok ? `Copied <b>${esc(v)}</b> &mdash; click the ${LABEL[f]} box in Kronos and press Ctrl+V.` : `Couldn't copy. Select the text and copy it by hand: <b>${esc(v)}</b>`;
      save(); render();
    }

    root.addEventListener("click", async (e) => {
      const t = e.target.closest("button,li,input[type=checkbox]");
      if (!t || !data) return;
      if (t.dataset.copy) return doCopy(t.dataset.copy);
      if (t.dataset.tick !== undefined) {
        const s = data.shifts[Number(t.dataset.tick)];
        done = await S.markDone(s.id, t.checked);
        return render();
      }
      if (t.dataset.go !== undefined) { st.idx = Number(t.dataset.go); st.field = -1; note = ""; save(); return render(); }
      const a = t.dataset.act;
      if (a === "nextfield") return doCopy(ORDER[(st.field + 1) % ORDER.length]);
      if (a === "prev") { st.idx = (st.idx - 1 + data.shifts.length) % data.shifts.length; }
      if (a === "skip") { st.idx = (st.idx + 1) % data.shifts.length; }
      if (a === "done") {
        const s = data.shifts[st.idx];
        const nowDone = !done[s.id];
        done = await S.markDone(s.id, nowDone);
        if (nowDone) st.idx = nextNotDone(st.idx);
      }
      st.field = -1; note = ""; save(); render();
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.fmt) { st.fmt[t.dataset.fmt] = t.value; save(); render(); }
      if (t.dataset.day !== undefined && t.tagName === "SELECT") {
        st.day = t.value;
        const first = data.shifts.findIndex((x) => x.day === st.day && !done[x.id]);
        if (st.day && first >= 0) st.idx = first;
        save(); render();
      }
    });
    S.onChange((c) => {
      if (c.sh_data) data = c.sh_data.newValue;
      if (c.sh_done) done = c.sh_done.newValue || {};
      if (c.sh_data || c.sh_done) render();
    });
    load();
  };
})();
