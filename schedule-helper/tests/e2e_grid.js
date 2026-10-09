// Grid part of the end-to-end test: the mock UKG Schedule Planner (mock_kronos/planner.html).
// Zack's way of adding a shift: click the EMPTY spot in the person's row under the day, fill the
// slide-in "Add Shift" panel (Start Time / End Time are pre-filled with a 1-hour shift), Apply,
// then the toolbar Save. "Show me once" records that; auto-fill must repeat it for other people
// and other days, including job-change shifts (Transfer Employee -> job).
// Called from e2e.js; each variant is one planner.html query string (see the top of planner.html).
const assert = require("assert");

const VARIANTS = {
  click: "",                     // Zack's case: Gantt view, one click opens the panel
  dblclick: "open=dblclick",     // click selects, double-click opens
  menu: "open=menu",             // right-click -> "Add Shift"
  table: "view=table",           // Table view: one cell per person/day, times start empty
  aria: "aria=1",                // friendlier build with role=grid/gridcell + aria-labels
  jobpath: "jobpath=1",          // job menu shows "Restaurant/Bar" instead of "Bar"
  applysaves: "save=apply",      // Apply stores the shift (no toolbar Save)
};

module.exports = async function gridTests(t, which) {
  const { page, cmd, sleep, rv, roster, R, DIRECTORY, PRIMARY, P } = t;
  const md = (s) => R.formatValue(s, { field: "date", fmt: "MM/DD/YYYY" });
  const days = [...new Set(roster.shifts.map((s) => s.day))];
  const D = roster.shifts.find((s) => s.jobChange).day;              // a day with job-change shifts
  const D2 = days[days.indexOf(D) + 1] || days[days.indexOf(D) - 1]; // and another day
  const ex = roster.shifts.find((s) => s.day === D && !s.jobChange);
  const ex2 = roster.shifts.find((s) => s.jobChange && s.day !== D && s.day !== D2) || roster.shifts.filter((s) => s.jobChange && s.day === D)[1];
  const summary = [], coveredNotes = new Set();

  const failed = [];
  for (const name of which) {
    try { await one(name); } catch (e) { console.log(`FAIL ${name}: ${e.message}`); summary.push(`FAIL ${name}: ${e.message}`); failed.push(name); }
  }
  if (coveredNotes.size) summary.push(`NOTE: the helper panel covered ${[...coveredNotes].join(", ")} (UKG's slide-in panel/toolbar); the test dragged it aside like Zack would`);
  if (failed.length) { console.log(summary.join("\n")); throw new Error("grid variants failed: " + failed.join(", ")); }
  return summary;

  async function one(name) {
    const qs = VARIANTS[name];
    if (qs == null) throw new Error("unknown grid variant " + name);
    const tag = `grid_${name}`;
    const full = name === "click"; // two days only on Zack's own setup; one day for the other variants
    console.log(`\n=== grid variant: ${name} (planner.html?${qs}) ===`);
    // fresh start: nothing learned, nothing ticked off
    await rv.ev("new Promise(r => chrome.storage.local.remove(['sh_recipe'], () => chrome.storage.local.set({sh_done: {}}, r)))");
    const k = await page(`http://test.mykronos.com/planner.html?${qs}`);
    await k.until(`!!document.getElementById('schedule-helper-panel') && ${P}.querySelector('.sh-card')`, 20000, "helper panel");
    await k.ev(`window.mockInit(${JSON.stringify(DIRECTORY)}, ${JSON.stringify(PRIMARY)})`);
    const wantJobText = (job) => (qs.includes("jobpath") ? "Restaurant/" + job : job);
    if (qs.includes("jobpath")) await k.ev("window.JOB_PATH = true");

    // ---------- the things Zack does with the mouse/keyboard ----------
    const center = async (sel) => k.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; })()`);
    // The helper's panel sits bottom-right, right over UKG's slide-in panel footer (Apply). Zack
    // would drag it out of the way by its title bar, so the test does the same with the mouse.
    const covered = async (p) => k.ev(`document.elementFromPoint(${p[0]}, ${p[1]}) === document.getElementById('schedule-helper-panel')`);
    const dragHelperLeft = async () => {
      const h = await k.ev(`(() => { const r = ${P}.querySelector('.sh-head').getBoundingClientRect(); return [r.left + 60, r.top + r.height / 2]; })()`);
      await k.drag(h[0], h[1], 560, h[1]);
    };
    const clickSel = async (sel) => {
      let p = await center(sel); assert(p, "not on screen: " + sel);
      if (await covered(p)) { coveredNotes.add(sel); await dragHelperLeft(); await sleep(200); p = await center(sel); }
      assert(!(await covered(p)), "still covered by the helper: " + sel);
      await k.mouse(...p);
    };
    const clickText = async (sel, text) => {
      const p = await k.ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; })()`);
      assert(p, `no "${text}" in ${sel}`); await k.mouse(...p);
    };
    const typeOver = async (sel, text) => { await clickSel(sel); await k.selectAll(); await k.type(text); };
    async function openPanelFor(s) {
      // scroll the name list to the person (like Zack), then the empty spot under the day, ~7 AM
      const p = await k.ev(`(() => {
        const row = [...document.querySelectorAll('.row')].find(r => r.querySelector('.nm span').textContent === ${JSON.stringify(s.kronosName)});
        row.querySelector('.nm').scrollIntoView({ block: 'center' });
        const di = [...document.querySelectorAll('.dh .d')].findIndex(d => d.textContent.endsWith(${JSON.stringify(md(s).slice(0, 5).replace(/^0/, ""))}));
        const lane = row.querySelector('.lane');
        if (lane) { const r = lane.getBoundingClientRect(), w = r.width / 7; return [r.left + (di + 0.3) * w, r.top + r.height / 2]; }
        const c = row.querySelector('.tcell[data-day="' + di + '"]').getBoundingClientRect(); return [c.left + c.width * 0.3, c.top + c.height / 2];
      })()`);
      if (qs.includes("open=dblclick")) await k.mouse(...p, { double: true });
      else if (qs.includes("open=menu")) {
        await k.mouse(...p, { button: "right" });
        await k.until("document.getElementById('ctx')", 3000, "right-click menu");
        await clickText("#ctx [role=menuitem]", "Add Shift");
      } else await k.mouse(...p);
      await k.until("document.getElementById('panel').classList.contains('open')", 5000, "Add Shift panel");
      await sleep(300); // the slide-in
    }
    const apply = async () => { await clickSel("#papply"); await k.until("!document.getElementById('panel').classList.contains('open')", 5000, "panel closed after Apply"); await sleep(400); };
    const save = async () => {
      if (qs.includes("save=apply")) return;
      await clickSel("#save");
    };

    // ---------- Show me once on a grid cell ----------
    await k.ev(`${P}.querySelector('[data-tab=teach]').click()`);
    await k.until(`${P}.querySelector('#recgo')`);
    await k.ev(`(() => { const s = ${P}.querySelector('#ex'); s.value = ${JSON.stringify(ex.id)}; })()`);
    console.log("teaching with", ex.kronosName, ex.day, R.niceTime(ex.start), "-", R.niceTime(ex.end), ex.kronosJob);
    await k.ev(`${P}.querySelector('#recgo').click()`); await sleep(300);
    await openPanelFor(ex);
    await k.shot(`${tag}_1_panel_open`);
    await typeOver("#st", R.niceTime(ex.start));
    await typeOver("#en", R.niceTime(ex.end));
    await k.shot(`${tag}_2_panel_filled`);
    await apply(); await save();
    await k.until("window.added.length === 1", 5000, "first shift saved");
    await sleep(500);
    await k.ev(`${P}.querySelector('#recdone').click()`);
    await k.until(`${P}.querySelector('#recsave')`);
    const steps = await k.ev(`[...${P}.querySelectorAll('.sh-steps > li')].map(li => li.innerText.split('\\n').filter(Boolean).slice(0, 2).join(' / ') + ' => ' + (li.querySelector('select') ? li.querySelector('select').selectedOptions[0].text : '-') + (li.querySelector('[data-save]')?.checked ? ' [SAVE]' : ''))`);
    console.log("learned steps:\n  " + steps.join("\n  "));
    await k.shot(`${tag}_3_steps`);
    // the grid click must be understood as this person's spot on this day...
    assert(steps.some((x) => x.includes(ex.kronosName) && x.includes(Number(md(ex).slice(0, 2)) + "/" + Number(md(ex).slice(3, 5)))), "grid click not recorded as the person's spot on that day");
    assert(!steps.some((x) => /no name I can find|spot with no words/i.test(x)), "a step still has no name");
    // ...and the times by their own labels, not the panel's whole text
    assert(!steps.some((x) => /Regular.*Start Time.*End Time/is.test(x)), "a step is named by the panel's whole text");
    for (const f of ["Start Time", "End Time"]) assert(steps.some((x) => x.toLowerCase().includes(f.toLowerCase())), `no step named "${f}"`);
    assert(steps.some((x) => x.includes("[SAVE]")), "no step marked as Save");
    await k.ev(`${P}.querySelector('#recsave').click()`);
    await k.until(`${P}.querySelector('#recgo')`, 10000, "back to the teach tab");

    // ---------- part 2: change the job on a job-change shift ----------
    // (always: without it the helper stops to ask on every job-change shift)
    let expectHand = 1;
    {
      await k.until(`${P}.querySelector('#jobgo')`, 10000, "part 2 button");
      await k.ev(`(() => { const s = ${P}.querySelector('#exjob'); s.value = ${JSON.stringify(ex2.id)}; })()`);
      console.log("part 2 with", ex2.kronosName, ex2.day, ex2.usualJob, "->", ex2.kronosJob);
      await k.ev(`${P}.querySelector('#jobgo').click()`);
      await k.until(`${P}.querySelector('#jobdone')`, 60000, "helper filled the panel and is watching");
      await k.shot(`${tag}_4_part2_watching`);
      assert(await k.ev("document.getElementById('panel').classList.contains('open')"), "the panel should still be open (job is changed before Apply)");
      assert.equal(await k.ev("document.getElementById('jobpath').textContent"), ex2.usualJob); // Kronos put the usual job
      await clickSel("#xfer");
      await k.until("!document.getElementById('xmenu').hidden", 3000, "transfer menu");
      await clickText("#xmenu [role=menuitem]", wantJobText(ex2.kronosJob));
      await sleep(400);
      await k.ev(`${P}.querySelector('#jobdone').click()`);
      await k.until(`${P}.querySelector('#jobkeep')`);
      const jsteps = await k.ev(`[...${P}.querySelectorAll('.sh-steps > li')].map(li => li.innerText.split('\\n')[0] + ' => ' + (li.querySelector('select') ? li.querySelector('select').selectedOptions[0].text : '-'))`);
      console.log("job-change steps:\n  " + jsteps.join("\n  "));
      await k.ev(`${P}.querySelector('#jobkeep').click()`);
      await k.until(`${P}.querySelector('[data-ans=save]')`, 10000, "save prompt");
      await k.ev(`${P}.querySelector('[data-ans=save]').click()`);
      await k.until("window.added.length === 2", 20000, "part-2 shift saved");
      const a2 = (await k.ev("window.mockAdded()"))[1];
      assert.equal(a2.job, ex2.kronosJob, "part-2 job");
      assert.equal(a2.name, ex2.kronosName);
      expectHand = 2;
      await k.until(`${P}.querySelector('#again')`);
      await k.ev(`${P}.querySelector('#again').click()`);
    }

    // ---------- auto-fill: several people, a job-change shift, one or two days ----------
    await k.ev(`${P}.querySelector('[data-tab=auto]').click()`);
    const toDay = async (day) => {
      for (;;) {
        await k.until(`${P}.querySelector('[data-ans=go]')`, 30000, "day list");
        const head = await k.ev(`${P}.querySelector('#auto p').innerText`);
        if (head.startsWith(day)) return head;
        await k.ev(`${P}.querySelector('[data-ans=skip]').click()`); await sleep(200);
      }
    };
    await k.until(`${P}.querySelector('#go')`);
    await k.ev(`${P}.querySelector('#go').click()`);
    const runDays = full ? [D, D2].filter(Boolean).sort((a, b) => days.indexOf(a) - days.indexOf(b)) : [D];
    for (const day of runDays) {
      await toDay(day);
      await k.shot(`${tag}_5_list_${day}`);
      const before = await k.ev("window.added.length");
      const todo = await k.ev(`${P}.querySelectorAll('[data-pick]').length`);
      await k.ev(`${P}.querySelector('[data-ans=go]').click()`);
      try {
        await k.until(`window.added.length === ${before + todo} || !!${P}.querySelector('.sh-warn')`, 180000, `${day} entered`);
      } catch (e) { // stuck without a message: show where
        await k.shot(`${tag}_x_stuck`);
        console.log("stuck; helper says:", (await k.ev(`${P}.querySelector('#auto').innerText`)).replace(/\n+/g, " | ").slice(0, 300));
        console.log("mock log tail:", (await k.ev("window.mockLog")).slice(-5).join(" | "), "| added", await k.ev("window.added.length"), "of", before + todo);
        throw e;
      }
      const warn = await k.ev(`${P}.querySelector('.sh-warn') && ${P}.querySelector('.sh-warn').innerText`);
      if (warn) { await k.shot(`${tag}_x_warn`); throw new Error(`[${name}] auto-fill stopped on ${day}: ${warn}`); }
      console.log(`${day}: helper entered ${todo} shifts`);
    }
    await k.until(`${P}.querySelector('[data-ans=go]') || ${P}.querySelector('#again')`, 20000, "after the days");
    await k.shot(`${tag}_6_after`);
    const stop = await k.ev(`!!${P}.querySelector('[data-ans=stop]')`);
    if (stop) await k.ev(`${P}.querySelector('[data-ans=stop]').click()`);

    // every shift on those days entered exactly once with the roster's values, nothing left pending
    const added = await k.ev("window.mockAdded()");
    assert.equal(await k.ev("window.pending.length"), 0, "shifts applied but never saved");
    let jc = 0, people = new Set();
    for (const day of runDays) {
      const want = roster.shifts.filter((s) => s.day === day).map((s) => JSON.stringify({ name: s.kronosName, date: md(s), start: R.niceTime(s.start), end: R.niceTime(s.end), job: s.kronosJob })).sort();
      const got = added.filter((a) => a.date === md(roster.shifts.find((s) => s.day === day))).map((a) => JSON.stringify(a)).sort();
      assert.deepEqual(got, want, `[${name}] ${day} doesn't match the roster`);
      roster.shifts.filter((s) => s.day === day).forEach((s) => { people.add(s.kronosName); if (s.jobChange) jc++; });
    }
    const line = `${name}: ${added.length - expectHand} shifts by the helper + ${expectHand} by hand, ${people.size} people, ${runDays.length} day(s), ${jc} job-change shift(s) - all match the roster`;
    console.log("PASS " + line); summary.push(line);
    await cmd("Target.closeTarget", { targetId: k.targetId });
  }
};
module.exports.VARIANTS = VARIANTS;
