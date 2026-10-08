// Review screen: read the roster file, let Zack check/fix it, hand it to the Kronos panel.
(async function () {
  const R = globalThis.SHRoster, S = globalThis.SHStore, D = globalThis.SH_DEFAULTS;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DAYNAME = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

  const prefs = { nameOverrides: { ...D.nameOverrides }, jobMap: { ...D.jobMap }, confirm: D.confirm, paceName: "normal", ...((await S.get("sh_prefs")) || {}) };
  let raw = "", filename = "", shifts = [], off = new Set(), jobEdits = {};

  $("#openk").href = D.kronosUrl;
  document.querySelector(`[name=confirm][value=${prefs.confirm}]`).checked = true;
  document.querySelector(`[name=pace][value=${prefs.paceName}]`).checked = true;

  async function readFile(f) {
    filename = f.name;
    if (/\.xlsx?$/i.test(f.name)) {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      raw = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    } else raw = await f.text();
    $("#week").value = R.weekFromFilename(filename) || $("#week").value;
    off = new Set(); jobEdits = {};
    build();
  }

  function build() {
    const week = $("#week").value;
    const res = R.readRoster(raw, filename, { week, jobMap: prefs.jobMap, nameOverrides: prefs.nameOverrides });
    if (week) {
      const wd = new Date(week + "T12:00:00").getDay();
      if (wd !== 1) res.problems.unshift("The week start isn't a Monday - the roster's first column is Monday, so the dates may be off.");
    }
    shifts = res.shifts;
    shifts.forEach((s) => { if (jobEdits[s.id]) s.kronosJob = jobEdits[s.id]; });
    $("#problems").innerHTML = res.problems.map((p) => `<div class="sh-warn">${esc(p)}</div>`).join("");
    $("#step2").hidden = $("#step3").hidden = !shifts.length;
    render();
  }

  function render() {
    const people = [...new Set(shifts.map((s) => s.employee))].sort();
    const kept = shifts.filter((s) => !off.has(s.id));
    const doubles = new Set();
    const seen = {};
    shifts.forEach((s) => { const k = s.employee + s.date; if (seen[k]) doubles.add(k); seen[k] = 1; });
    $("#summary").innerHTML = `<b>${kept.length}</b> shifts for <b>${people.length}</b> people, week of <b>${esc($("#week").value)}</b>. Untick anything that shouldn't go into Kronos.`;
    $("#names").innerHTML = people.map((p) => `<label>${esc(p)} <input type="text" data-name="${esc(p)}" value="${esc(R.kronosNameFor(p, prefs.nameOverrides))}"></label>`).join("");
    const scheds = [...new Set(shifts.map((s) => s.schedule))].filter(Boolean).sort();
    $("#jobs").innerHTML = scheds.map((sc) => {
      const fallback = (shifts.find((s) => s.schedule === sc) || {}).job || sc;
      return `<label>${esc(sc)} &rarr; <input type="text" data-job="${esc(sc)}" value="${esc(prefs.jobMap[sc] || fallback)}"></label>`;
    }).join("");
    const days = [...new Set(shifts.map((s) => s.day))];
    $("#days").innerHTML = days.map((d) => {
      const list = shifts.filter((s) => s.day === d);
      return `<h3>${DAYNAME[d]} ${esc(list[0].date)} &middot; ${list.filter((s) => !off.has(s.id)).length} shifts</h3>
      <table><tr><th></th><th>Kronos name</th><th>Start</th><th>End</th><th class="hide-sm">HotSchedules</th><th>Kronos job</th></tr>
      ${list.map((s) => `<tr class="${off.has(s.id) ? "off" : ""}"><td><input type="checkbox" data-on="${esc(s.id)}" ${off.has(s.id) ? "" : "checked"}></td>
        <td>${esc(s.kronosName)}${doubles.has(s.employee + s.date) ? ' <span class="tag">double</span>' : ""}</td>
        <td>${R.niceTime(s.start)}</td><td>${R.niceTime(s.end)}${s.overnight ? ' <span class="tag next">next day</span>' : ""}</td>
        <td class="hide-sm">${esc(s.schedule)}</td>
        <td><input type="text" data-sjob="${esc(s.id)}" value="${esc(s.kronosJob)}"></td></tr>`).join("")}</table>`;
    }).join("");
  }

  $("#file").addEventListener("change", (e) => { if (e.target.files[0]) readFile(e.target.files[0]); });
  $("#week").addEventListener("change", () => { if (raw) build(); });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.on) { if (t.checked) off.delete(t.dataset.on); else off.add(t.dataset.on); render(); }
    if (t.dataset.name) {
      const auto = R.kronosNameFor(t.dataset.name, {});
      if (t.value.trim() && t.value.trim() !== auto) prefs.nameOverrides[t.dataset.name] = t.value.trim();
      else delete prefs.nameOverrides[t.dataset.name];
      build();
    }
    if (t.dataset.job) { prefs.jobMap[t.dataset.job] = t.value.trim(); build(); }
    if (t.dataset.sjob) { jobEdits[t.dataset.sjob] = t.value.trim(); build(); }
  });

  $("#use").addEventListener("click", async () => {
    prefs.confirm = document.querySelector("[name=confirm]:checked").value;
    prefs.paceName = document.querySelector("[name=pace]:checked").value;
    const pace = prefs.paceName === "slow"
      ? { keyMin: 140, keyMax: 300, stepMin: 1000, stepMax: 2200, shiftMin: 3000, shiftMax: 5000 } : D.pace;
    const kept = shifts.filter((s) => !off.has(s.id));
    await S.set("sh_prefs", prefs);
    await S.set("sh_data", { week: $("#week").value, filename, shifts: kept, settings: { confirm: prefs.confirm, pace }, loadedAt: Date.now() });
    $("#used").innerHTML = `&#10003; Sent ${kept.length} shifts. Open (or refresh) the Kronos Schedule Planner - the Schedule Helper panel appears in the bottom-right corner.`;
  });
  $("#cleardone").addEventListener("click", async () => { if (confirm("Untick every shift (mark all as not done)?")) await S.set("sh_done", {}); });
  $("#clearrecipe").addEventListener("click", async () => { if (confirm("Forget the steps learned in 'Show me once'?")) await S.set("sh_recipe", null); });

  globalThis.SHCopyMode($("#copy"), document);
})();
