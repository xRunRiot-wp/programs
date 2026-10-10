// Reads the HotSchedules Weekly Roster CSV into a clean shift list, and
// formats shift values the way Kronos fields want them.
(function () {
  const F = () => globalThis.SH_FORMAT;

  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x.trim() !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
    return rows;
  }

  // "Weekly_Roster_10052026_10112026.csv" -> "2026-10-05"
  function weekFromFilename(name) {
    const m = /(\d{2})(\d{2})(\d{4})_\d{8}/.exec(name || "");
    return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }

  // "5:00 PM" -> "17:00"
  function to24(s) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?\.?\s*$/.exec(s);
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if (/p/i.test(m[3])) h += 12;
    return String(h).padStart(2, "0") + ":" + m[2];
  }

  function kronosNameFor(hsName, overrides) {
    if (overrides && overrides[hsName]) return overrides[hsName];
    const parts = hsName.trim().split(/\s+/);
    if (parts.length < 2) return hsName.trim();
    const last = parts.pop();
    return `${last}, ${parts.join(" ")}`;
  }

  // Returns { week, shifts: [...], problems: [...] }
  function readRoster(text, filename, opts = {}) {
    const fmt = F();
    const rows = parseCSV(text);
    const problems = [];
    if (!rows.length) return { week: "", shifts: [], problems: ["The file is empty."] };
    const head = rows[0].map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const iEmp = col(fmt.employeeColumn);
    if (iEmp < 0) problems.push(`No "${fmt.employeeColumn}" column - is this the Weekly Roster export?`);
    const week = opts.week || weekFromFilename(filename);
    if (!week) problems.push("Couldn't tell the week from the file name - pick the Monday on the review screen.");
    const jobMap = opts.jobMap || {};
    const overrides = opts.nameOverrides || {};
    const shifts = [];
    rows.slice(1).forEach((r, rowNo) => {
      const emp = (r[iEmp] || "").trim();
      if (!emp) return;
      fmt.days.forEach((day, di) => {
        const cell = (r[col(`${day} ${fmt.shiftColumn}`)] || "").trim();
        if (!cell || cell === fmt.empty) return;
        const parts = cell.split(/\s+-\s+/);
        const start = to24(parts[0] || ""), end = to24(parts[1] || "");
        if (!start || !end) {
          problems.push(`Row ${rowNo + 2}, ${emp}, ${day}: couldn't read "${cell}" - left out.`);
          return;
        }
        const schedule = (r[col(`${day} ${fmt.scheduleColumn}`)] || "").trim();
        const job = (r[col(`${day} ${fmt.jobColumn}`)] || "").trim();
        const date = week ? addDays(week, di) : "";
        const overnight = end <= start;
        const s = {
          employee: emp,
          kronosName: kronosNameFor(emp, overrides),
          day, date,
          start, end,
          endDate: date && overnight ? addDays(date, 1) : date,
          overnight,
          schedule: schedule === fmt.empty ? "" : schedule,
          job: job === fmt.empty ? "" : job,
        };
        s.kronosJob = jobMap[s.schedule] || s.job || s.schedule;
        s.id = `${s.employee}|${s.date}|${s.start}|${s.end}`;
        shifts.push(s);
      });
    });
    shifts.sort((a, b) => (a.date + a.start + a.kronosName).localeCompare(b.date + b.start + b.kronosName));
    return { week, shifts, problems };
  }

  // ---- formatting values for Kronos fields -------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  function timeParts(hhmm) {
    const [H, M] = hhmm.split(":").map(Number);
    return { H, M, h: H % 12 || 12, ap: H < 12 ? "AM" : "PM" };
  }
  function dateParts(iso) {
    const [Y, Mo, D] = iso.split("-").map(Number);
    return { Y, Mo, D };
  }
  const TIME = {
    "h:mm AM": (t) => `${t.h}:${pad(t.M)} ${t.ap}`,
    "h:mmAM": (t) => `${t.h}:${pad(t.M)}${t.ap}`,
    "h:mm am": (t) => `${t.h}:${pad(t.M)} ${t.ap.toLowerCase()}`,
    "h:mmam": (t) => `${t.h}:${pad(t.M)}${t.ap.toLowerCase()}`,
    "h:mma": (t) => `${t.h}:${pad(t.M)}${t.ap[0].toLowerCase()}`,
    "hh:mm AM": (t) => `${pad(t.h)}:${pad(t.M)} ${t.ap}`,
    "HH:mm": (t) => `${pad(t.H)}:${pad(t.M)}`,
    "H:mm": (t) => `${t.H}:${pad(t.M)}`,
    // v3.7 (Zack 10-10 typed "5pm"/"10pm": no format matched, so every shift got 5pm-10pm)
    "ham": (t) => `${t.h}${t.M ? ":" + pad(t.M) : ""}${t.ap.toLowerCase()}`,
    "hAM": (t) => `${t.h}${t.M ? ":" + pad(t.M) : ""}${t.ap}`,
    "h am": (t) => `${t.h}${t.M ? ":" + pad(t.M) : ""} ${t.ap.toLowerCase()}`,
    "h AM": (t) => `${t.h}${t.M ? ":" + pad(t.M) : ""} ${t.ap}`,
  };
  const DATE = {
    // padded first: when the example date can't tell (10/10/2026), 10/05 is the safer guess
    "MM/DD/YYYY": (d) => `${pad(d.Mo)}/${pad(d.D)}/${d.Y}`,
    "M/D/YYYY": (d) => `${d.Mo}/${d.D}/${d.Y}`,
    "M/D/YY": (d) => `${d.Mo}/${d.D}/${String(d.Y).slice(2)}`,
    "MM/DD/YY": (d) => `${pad(d.Mo)}/${pad(d.D)}/${String(d.Y).slice(2)}`,
    "YYYY-MM-DD": (d) => `${d.Y}-${pad(d.Mo)}-${pad(d.D)}`,
    "MM/DD": (d) => `${pad(d.Mo)}/${pad(d.D)}`,
    "M/D": (d) => `${d.Mo}/${d.D}`,
    "D (calendar day)": (d) => `${d.D}`,
  };
  function nameParts(k) {
    const i = k.indexOf(",");
    return i < 0 ? { last: k, first: "" } : { last: k.slice(0, i).trim(), first: k.slice(i + 1).trim() };
  }
  const NAME = {
    "Last, First": (n) => (n.first ? `${n.last}, ${n.first}` : n.last),
    "Last,First": (n) => (n.first ? `${n.last},${n.first}` : n.last),
    "First Last": (n) => `${n.first} ${n.last}`.trim(),
    "Last First": (n) => `${n.last} ${n.first}`.trim(),
    "Last": (n) => n.last,
    "First": (n) => n.first,
  };
  const JOB = {
    "Kronos job": (s) => s.kronosJob,
    "HotSchedules schedule": (s) => s.schedule,
  };

  // field -> {format name -> (shift) => text}
  const FIELDS = {
    name: Object.fromEntries(Object.entries(NAME).map(([k, f]) => [k, (s) => f(nameParts(s.kronosName))])),
    start: Object.fromEntries(Object.entries(TIME).map(([k, f]) => [k, (s) => f(timeParts(s.start))])),
    end: Object.fromEntries(Object.entries(TIME).map(([k, f]) => [k, (s) => f(timeParts(s.end))])),
    date: Object.fromEntries(Object.entries(DATE).map(([k, f]) => [k, (s) => f(dateParts(s.date))])),
    endDate: Object.fromEntries(Object.entries(DATE).map(([k, f]) => [k, (s) => f(dateParts(s.endDate))])),
    job: JOB,
  };
  const FIELD_LABELS = {
    fixed: "Same every time", name: "Employee name", date: "Shift date", endDate: "End date",
    start: "Start time", end: "End time", job: "Job",
  };

  function formatValue(shift, map) {
    const f = FIELDS[map.field] && FIELDS[map.field][map.fmt];
    return f ? f(shift) : null;
  }

  // Which field/format does a recorded value correspond to for the example shift?
  // Order matters: earlier fields win when two give the same text.
  function guessMapping(value, shift, opts = {}) {
    const v = (value || "").trim();
    if (!v) return null;
    const order = ["start", "end", "name", "job", "date", "endDate"];
    for (const exactCase of [true, false]) {
      for (const field of order) {
        for (const [fmt, f] of Object.entries(FIELDS[field])) {
          if (fmt.startsWith("D (") && !opts.click) continue;
          if (fmt.startsWith("D (") && field === "endDate") continue;
          const out = f(shift);
          if (!out) continue;
          if (exactCase ? out === v : out.toLowerCase() === v.toLowerCase()) return { field, fmt };
        }
      }
    }
    // A job picked from a menu that shows the whole path ("Restaurant/Bar")
    if (opts.click && /[/>]/.test(v) && shift.kronosJob && v.split(/\s*[/>]\s*/).pop().toLowerCase() === String(shift.kronosJob).toLowerCase()) return { field: "job", fmt: "Kronos job" };
    // A partial name typed into a search box ("Aver") -> type the whole last/first name.
    if (!opts.click && v.length >= 2) {
      for (const fmt of ["Last", "First", "Last, First", "First Last"]) {
        const out = FIELDS.name[fmt](shift);
        if (out && out.toLowerCase().startsWith(v.toLowerCase())) return { field: "name", fmt: fmt === "Last" || fmt === "First" ? fmt : "Last" };
      }
    }
    return null;
  }

  function niceTime(hhmm) { const t = timeParts(hhmm); return `${t.h}:${pad(t.M)} ${t.ap}`; }

  // ---- usual job per person ------------------------------------------------
  // Kronos fills in a person's PRIMARY job when a shift is added, so a shift with a
  // different job (a server working Bar) needs the job changed for that one shift.
  // The usual job is the one they work most this week (ties: more hours, then A-Z);
  // Zack can set it per person (overrides, remembered on the review screen).
  function hours(s) {
    const [a, b] = [s.start, s.end].map((t) => { const [H, M] = t.split(":").map(Number); return H * 60 + M; });
    return ((b - a + 1440) % 1440 || 1440) / 60;
  }
  function usualJobs(shifts, overrides = {}) {
    const per = {};
    shifts.forEach((s) => {
      if (!s.kronosJob) return;
      const p = (per[s.employee] = per[s.employee] || {});
      const j = (p[s.kronosJob] = p[s.kronosJob] || { n: 0, h: 0 });
      j.n++; j.h += hours(s);
    });
    // Zack (10-09): in Kronos the Bar shifts are the transfer, never the person's main job.
    // So the usual job is the most-worked job that ISN'T a transfer job; someone who only
    // works Bar is a Server in Kronos (settings: transferJobs / transferHome).
    const D = globalThis.SH_DEFAULTS || {};
    const transfer = new Set((D.transferJobs || ["Bar"]).map(norm)), home = D.transferHome || "Server";
    const out = {};
    for (const [emp, jobs] of Object.entries(per)) {
      const ranked = Object.entries(jobs).sort((a, b) => b[1].n - a[1].n || b[1].h - a[1].h || a[0].localeCompare(b[0]));
      const main = ranked.filter(([j]) => !transfer.has(norm(j)));
      const tie = main.length > 1 && main[0][1].n === main[1][1].n;
      out[emp] = overrides[emp]
        ? { job: overrides[emp], how: "set" }
        : main.length ? { job: main[0][0], how: tie ? "tie" : "auto" } : { job: home, how: "auto" };
      out[emp].jobs = ranked.map(([j]) => j);
    }
    return out;
  }
  // adds usualJob + jobChange to every shift; returns how many need a job change
  function markJobChanges(shifts, overrides = {}) {
    const usual = usualJobs(shifts, overrides);
    let n = 0;
    shifts.forEach((s) => {
      s.usualJob = usual[s.employee] ? usual[s.employee].job : "";
      s.jobChange = !!(s.kronosJob && s.usualJob && norm(s.kronosJob) !== norm(s.usualJob));
      if (s.jobChange) n++;
    });
    return { usual, count: n };
  }
  const norm = (x) => String(x || "").trim().toLowerCase();
  // "Bar" -> "BARTENDER" for the copy-mode badge
  const JOB_WORD = { bar: "BARTENDER", bartender: "BARTENDER", server: "SERVER", cocktail: "SERVER", host: "HOST", bus: "BUSSER", busser: "BUSSER", manager: "MANAGER" };
  function jobWord(job) { return JOB_WORD[norm(job)] || String(job || "").toUpperCase(); }

  const api = { parseCSV, readRoster, weekFromFilename, addDays, to24, kronosNameFor, FIELDS, FIELD_LABELS, formatValue, guessMapping, niceTime, usualJobs, markJobChanges, jobWord };
  globalThis.SHRoster = api;
  if (typeof module !== "undefined") module.exports = api;
})();
