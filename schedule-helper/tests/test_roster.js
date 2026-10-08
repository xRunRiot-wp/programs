// node tests/test_roster.js <roster.csv>   (parser + formatter checks)
const fs = require("fs"), path = require("path"), assert = require("assert");
require("../extension/settings.js");
const R = require("../extension/roster.js");
const f = process.argv[2];
const res = R.readRoster(fs.readFileSync(f, "utf8"), path.basename(f), { jobMap: SH_DEFAULTS.jobMap });
console.log("week", res.week, "shifts", res.shifts.length, "problems", res.problems);
assert.equal(res.week, "2026-10-05");
assert.equal(res.shifts.length, 136);
const byDay = {}; res.shifts.forEach((s) => (byDay[s.day] = (byDay[s.day] || 0) + 1));
console.log(byDay);
const cocktail = res.shifts.find((s) => s.schedule === "Cocktail");
assert.equal(cocktail.kronosJob, "Server");
const mid = res.shifts.find((s) => s.end === "00:00");
assert(mid.overnight && mid.endDate === R.addDays(mid.date, 1));
const one = res.shifts.find((s) => s.end === "01:00");
assert(one.overnight);
const day = res.shifts.find((s) => s.start === "10:00" && s.end === "16:00");
assert(!day.overnight && day.endDate === day.date);
// doubles: same person twice the same day
const k = {}; let dbl = 0; res.shifts.forEach((s) => { const x = s.employee + s.date; if (k[x]) dbl++; k[x] = 1; });
console.log("doubles", dbl); assert(dbl > 0);
// names "First Last" -> "Last, First"
assert.equal(R.kronosNameFor("Jamie Avery"), "Avery, Jamie");
assert.equal(R.kronosNameFor("Mary Ann Smith", { "Mary Ann Smith": "Smith-Jones, Mary" }), "Smith-Jones, Mary");
// formatting + guessing
const s = { kronosName: "Avery, Jamie", date: "2026-10-06", endDate: "2026-10-07", start: "16:00", end: "00:00", kronosJob: "Server", schedule: "Server" };
assert.equal(R.formatValue(s, { field: "start", fmt: "h:mm AM" }), "4:00 PM");
assert.equal(R.formatValue(s, { field: "end", fmt: "HH:mm" }), "00:00");
assert.equal(R.formatValue(s, { field: "date", fmt: "MM/DD/YYYY" }), "10/06/2026");
assert.deepEqual(R.guessMapping("4:00 PM", s), { field: "start", fmt: "h:mm AM" });
assert.deepEqual(R.guessMapping("12:00 AM", s), { field: "end", fmt: "h:mm AM" });
assert.deepEqual(R.guessMapping("10/06/2026", s), { field: "date", fmt: "MM/DD/YYYY" });
assert.deepEqual(R.guessMapping("10/7/2026", s), { field: "endDate", fmt: "M/D/YYYY" });
assert.deepEqual(R.guessMapping("Avery, Jamie", s, { click: true }), { field: "name", fmt: "Last, First" });
assert.deepEqual(R.guessMapping("Aver", s), { field: "name", fmt: "Last" });
assert.deepEqual(R.guessMapping("Server", s, { click: true }), { field: "job", fmt: "Kronos job" });
assert.deepEqual(R.guessMapping("6", s, { click: true }), { field: "date", fmt: "D (calendar day)" });
assert.equal(R.guessMapping("Shift", s, { click: true }), null);
// header-only / junk
assert.equal(R.readRoster("", "x.csv").shifts.length, 0);
assert(R.readRoster("Name,Foo\nA,B", "x.csv").problems.length);
console.log("ALL ROSTER TESTS PASS");
