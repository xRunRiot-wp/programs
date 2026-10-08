// End-to-end test in a hidden, separate Chrome (own temp profile, debugging over a pipe,
// never port 9333 / never Joseph's Chrome). Loads the extension, reads the roster on the
// review screen, then on a MOCK Kronos page: copy mode, "Show me once", auto-fill Monday,
// and the "already there?" check.
//   node tests/e2e.js <roster.csv> <workdir>
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), http = require("http");
const assert = require("assert");

const CSV = path.resolve(process.argv[2]);
const WORK = path.resolve(process.argv[3]);
const HERE = __dirname;
const EXT_SRC = path.join(HERE, "..", "extension");
const EXT = path.join(WORK, "ext-test");
const SHOTS = path.join(WORK, "shots");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// test copy of the extension that also runs on http://test.mykronos.com (the mock)
fs.rmSync(EXT, { recursive: true, force: true });
fs.cpSync(EXT_SRC, EXT, { recursive: true });
const man = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json")));
man.content_scripts[0].matches.push("http://*.mykronos.com/*");
man.web_accessible_resources[0].matches.push("http://*.mykronos.com/*");
fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(man, null, 1));
fs.mkdirSync(SHOTS, { recursive: true });

// roster -> expected values + mock directory
global.SH_DEFAULTS = undefined;
require(path.join(EXT_SRC, "settings.js"));
const R = require(path.join(EXT_SRC, "roster.js"));
const roster = R.readRoster(fs.readFileSync(CSV, "utf8"), path.basename(CSV), { jobMap: SH_DEFAULTS.jobMap });
const DIRECTORY = [...new Set(roster.shifts.map((s) => s.kronosName))];
const { usual } = R.markJobChanges(roster.shifts);
const PRIMARY = Object.fromEntries(roster.shifts.map((s) => [s.kronosName, usual[s.employee].job])); // Kronos' main job per person

// static server for the mock
const server = http.createServer((req, res) => {
  const p = path.join(HERE, "mock_kronos", decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
  if (!p.startsWith(path.join(HERE, "mock_kronos")) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/html" }); fs.createReadStream(p).pipe(res);
}).listen(0);
const PORT = server.address().port;

const prof = path.join(WORK, "chrome-prof");
fs.rmSync(prof, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  `--user-data-dir=${prof}`, "--no-first-run", "--window-size=1400,900", "--disable-gpu",
  `--host-resolver-rules=MAP test.mykronos.com:80 127.0.0.1:${PORT}`, "about:blank"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

// ---- CDP over the pipe ----
let mid = 0, buf = "";
const waiting = {}, events = [];
chrome.stdio[4].on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\0")) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    else if (m.method === "Runtime.exceptionThrown") events.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
});
function cmd(method, params = {}, sessionId) {
  const id = ++mid;
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  return new Promise((res, rej) => { waiting[id] = (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)); });
}
async function page(url) {
  const { targetId } = await cmd("Target.createTarget", { url });
  const { sessionId } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  await cmd("Runtime.enable", {}, sessionId); await cmd("Page.enable", {}, sessionId);
  await cmd("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
  const ev = async (js) => {
    const r = await cmd("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from((await cmd("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  const until = async (js, ms = 20000, what = js) => {
    const t = Date.now() + ms;
    for (;;) { const v = await ev(js).catch(() => null); if (v) return v; if (Date.now() > t) throw new Error("timed out waiting for " + what); await sleep(200); }
  };
  const mouse = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"]) await cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, sessionId);
  };
  const type = async (text) => cmd("Input.insertText", { text }, sessionId);
  return { sessionId, ev, shot, until, mouse, type, targetId };
}

(async () => {
  try {
    const { id } = await cmd("Extensions.loadUnpacked", { path: EXT });
    await cmd("Browser.grantPermissions", { origin: "http://test.mykronos.com", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch((e) => console.log("perm:", e.message));
    console.log("extension loaded", id);

    // ---------- review screen ----------
    const rv = await page(`chrome-extension://${id}/review.html`);
    await rv.until("!!window.SHRoster && !!document.querySelector('#file')");
    const { result } = await cmd("Runtime.evaluate", { expression: "document.querySelector('#file')" }, rv.sessionId);
    await cmd("DOM.enable", {}, rv.sessionId);
    await cmd("DOM.setFileInputFiles", { files: [CSV], objectId: result.objectId }, rv.sessionId);
    await rv.until("!document.querySelector('#step2').hidden");
    console.log("review summary:", await rv.ev("document.querySelector('#summary').innerText"));
    console.log("week box:", await rv.ev("document.querySelector('#week').value"));
    console.log("next-day tags:", await rv.ev("document.querySelectorAll('.tag.next').length"), "double tags:", await rv.ev("document.querySelectorAll('#days .tag:not(.next):not(.job)').length"));
    const jobTags = await rv.ev("document.querySelectorAll('#days .tag.job').length");
    console.log("job-change tags on review:", jobTags);
    assert.equal(jobTags, roster.shifts.filter((s) => s.jobChange).length);
    await rv.shot("1_review");
    await rv.ev("document.querySelector('#use').click()");
    await rv.until("document.querySelector('#used').textContent.includes('Sent')");
    // speed things up for the test only
    await rv.ev(`new Promise(r => chrome.storage.local.get('sh_data', v => { v.sh_data.settings.pace = {keyMin:5,keyMax:10,stepMin:50,stepMax:80,shiftMin:100,shiftMax:150}; chrome.storage.local.set(v, r); }))`);
    console.log("stored shifts:", await rv.ev("new Promise(r => chrome.storage.local.get('sh_data', v => r(v.sh_data.shifts.length)))"));

    // ---------- mock Kronos ----------
    const k = await page("http://test.mykronos.com/schedule.html");
    const P = "document.getElementById('schedule-helper-panel').shadowRoot";
    await k.until(`!!document.getElementById('schedule-helper-panel') && ${P}.querySelector('.sh-card')`, 20000, "panel");
    await k.ev(`window.DIRECTORY = ${JSON.stringify(DIRECTORY)}; window.PRIMARY = ${JSON.stringify(PRIMARY)}`);
    // copy mode
    await k.ev(`${P}.querySelector('[data-act=nextfield]').click()`);
    await sleep(300);
    console.log("copy note:", await k.ev(`${P}.querySelector('.sh-note').innerText`));
    await k.ev(`${P}.querySelector('[data-act=nextfield]').click()`); await sleep(300);
    console.log("copy note 2:", await k.ev(`${P}.querySelector('.sh-note').innerText`));
    await k.shot("2_copy_mode");

    // copy mode on a job-change shift: badge + highlighted Job button
    const fi = roster.shifts.findIndex((s) => s.jobChange);
    await k.ev(`${P}.querySelector('[data-go="${fi}"]').click()`);
    await k.until(`${P}.querySelector('.sh-jobflag')`, 5000, "job-change badge");
    console.log("copy badge:", (await k.ev(`${P}.querySelector('.sh-jobflag').innerText`)).replace(/\n/g, " | "));
    assert(await k.ev(`!!${P}.querySelector('.sh-field.sh-jobchange[data-copy=job]')`));
    await k.ev(`${P}.querySelector('[data-copy=job]').click()`); await sleep(300);
    console.log("copy job note:", await k.ev(`${P}.querySelector('.sh-note').innerText`));
    await k.shot("2b_copy_job_change");

    // the test day has job-change shifts; teach on a normal shift that day, part 2 on another day
    const D = roster.shifts.find((s) => s.jobChange).day;
    const ex = roster.shifts.find((s) => s.day === D && !s.jobChange);
    const ex2 = roster.shifts.find((s) => s.jobChange && s.day !== D) || roster.shifts.filter((s) => s.jobChange)[1];

    // show me once: add one shift by hand with real clicks/typing
    await k.ev(`${P}.querySelector('[data-tab=teach]').click()`);
    await k.until(`${P}.querySelector('#recgo')`);
    await k.ev(`(() => { const s = ${P}.querySelector('#ex'); s.value = ${JSON.stringify(ex.id)}; })()`);
    console.log("teaching with", ex.day, ex.start, ex.end, ex.kronosJob);
    await k.ev(`${P}.querySelector('#recgo').click()`);
    await sleep(300);
    const box = async (js) => k.ev(`(() => { const e = ${js}; const r = e.getBoundingClientRect(); const f = document.getElementById('dlg').getBoundingClientRect(); const inF = e.ownerDocument !== document; return [r.left + r.width/2 + (inF ? f.left + 2 : 0), r.top + r.height/2 + (inF ? f.top + 2 : 0)]; })()`);
    const DL = "document.getElementById('dlg').contentDocument";
    let [x, y] = await box("document.getElementById('quick')"); await k.mouse(x, y);
    await k.until(`${DL} && ${DL}.getElementById('emp')`);
    await sleep(300);
    const last = ex.kronosName.split(",")[0];
    [x, y] = await box(`${DL}.getElementById('emp')`); await k.mouse(x, y); await k.type(last);
    await k.until(`[...${DL}.querySelectorAll('li')].some(l => l.textContent === ${JSON.stringify(ex.kronosName)})`);
    [x, y] = await box(`[...${DL}.querySelectorAll('li')].find(l => l.textContent === ${JSON.stringify(ex.kronosName)})`); await k.mouse(x, y);
    [x, y] = await box(`${DL}.getElementById('date')`); await k.mouse(x, y); await k.type(R.formatValue(ex, { field: "date", fmt: "MM/DD/YYYY" }));
    [x, y] = await box(`${DL}.getElementById('st')`); await k.mouse(x, y); await k.type(R.niceTime(ex.start));
    [x, y] = await box(`${DL}.getElementById('en')`); await k.mouse(x, y); await k.type(R.niceTime(ex.end));
    // the job is filled in by Kronos (primary job) - nothing to do for a normal shift
    [x, y] = await box(`${DL}.getElementById('save')`); await k.mouse(x, y);
    await k.until("window.added.length === 1");
    await sleep(500);
    await k.shot("3_watching");
    await k.ev(`${P}.querySelector('#recdone').click()`);
    await k.until(`${P}.querySelector('#recsave')`);
    const steps = await k.ev(`[...${P}.querySelectorAll('.sh-steps > li')].map(li => li.innerText.split('\\n')[0] + ' => ' + (li.querySelector('select') ? li.querySelector('select').selectedOptions[0].text : '-') + (li.querySelector('[data-save]')?.checked ? ' [SAVE]' : ''))`);
    console.log("learned steps:\n  " + steps.join("\n  "));
    await k.shot("4_review_steps");
    await k.ev(`${P}.querySelector('#recsave').click()`);
    await k.until(`${P}.querySelector('#jobgo')`, 10000, "part 2 button");

    // part 2: the helper fills in a job-change shift, Zack changes the job while it watches
    await k.shot("4b_part2_offer");
    await k.ev(`(() => { const s = ${P}.querySelector('#exjob'); s.value = ${JSON.stringify(ex2.id)}; })()`);
    console.log("part 2 with", ex2.day, ex2.usualJob, "->", ex2.kronosJob);
    await k.ev(`${P}.querySelector('#jobgo').click()`);
    await k.until(`${P}.querySelector('#jobdone')`, 60000, "helper filled the form and is watching");
    assert.equal(await k.ev(`${DL}.getElementById('job').textContent`), ex2.usualJob); // Kronos put the usual job
    await k.shot("4c_part2_watching");
    [x, y] = await box(`${DL}.getElementById('chg')`); await k.mouse(x, y);
    await k.until(`[...${DL}.querySelectorAll('#jobmenu li')].length`);
    [x, y] = await box(`[...${DL}.querySelectorAll('#jobmenu li')].find(l => l.textContent === ${JSON.stringify(ex2.kronosJob)})`); await k.mouse(x, y);
    await sleep(500);
    await k.ev(`${P}.querySelector('#jobdone').click()`);
    await k.until(`${P}.querySelector('#jobkeep')`);
    const jsteps = await k.ev(`[...${P}.querySelectorAll('.sh-steps > li')].map(li => li.innerText.split('\\n')[0] + ' => ' + (li.querySelector('select') ? li.querySelector('select').selectedOptions[0].text : '-'))`);
    console.log("job-change steps:\n  " + jsteps.join("\n  "));
    await k.shot("4d_part2_steps");
    await k.ev(`${P}.querySelector('#jobkeep').click()`);
    await k.until(`${P}.querySelector('[data-ans=save]')`, 10000, "save prompt");
    await k.ev(`${P}.querySelector('[data-ans=save]').click()`);
    await k.until("window.added.length === 2", 20000, "part-2 shift saved");
    assert.equal((await k.ev("window.added"))[1].job, ex2.kronosJob);
    await k.until(`${P}.querySelector('#again')`);
    await k.ev(`${P}.querySelector('#again').click()`);

    // auto-fill the test day (skip the days before it)
    const toDay = async (day) => {
      for (;;) {
        await k.until(`${P}.querySelector('[data-ans=go]')`, 20000, "day list");
        const head = await k.ev(`${P}.querySelector('#auto p').innerText`);
        if (head.startsWith(day)) return head;
        await k.ev(`${P}.querySelector('[data-ans=skip]').click()`); await sleep(200);
      }
    };
    await k.until(`${P}.querySelector('#go')`);
    await k.ev(`${P}.querySelector('#go').click()`);
    console.log("day list:", await toDay(D), "| rows:", await k.ev(`${P}.querySelectorAll('[data-pick]').length`), "| job-change tags:", await k.ev(`${P}.querySelectorAll('#auto .sh-jobtag').length`));
    await k.shot("5_day_list");
    await k.ev(`${P}.querySelector('[data-ans=go]').click()`);
    const day = roster.shifts.filter((s) => s.day === D);
    await k.until(`window.added.length === ${day.length + (ex2.day === D ? 0 : 1)} || !!${P}.querySelector('.sh-warn')`, 240000, `${D} entered`);
    const warn = await k.ev(`${P}.querySelector('.sh-warn') && ${P}.querySelector('.sh-warn').innerText`);
    if (warn) { await k.shot("x_warn"); throw new Error("auto-fill stopped: " + warn); }
    await k.until(`${P}.querySelector('[data-ans=go]')`, 20000, "next day list");
    await k.shot("6_after_day");
    await k.ev(`${P}.querySelector('[data-ans=stop]').click()`);
    const md = R.formatValue(ex, { field: "date", fmt: "MM/DD/YYYY" });
    const added = (await k.ev("window.added")).filter((a) => a.date === md);
    // every shift that day entered exactly once, with the right values - including the job
    const want = day.map((s) => JSON.stringify({ name: s.kronosName, date: md, start: R.niceTime(s.start), end: R.niceTime(s.end), job: s.kronosJob })).sort();
    const got = added.map((a) => JSON.stringify(a)).sort();
    assert.deepEqual(got, want);
    const jc = day.filter((s) => s.jobChange).length;
    assert(jc > 0);
    console.log(`auto-fill entered all ${day.length} ${D} shifts (${jc} job-change shifts got ${[...new Set(day.filter((s) => s.jobChange).map((s) => s.kronosJob))]}), values match the roster`);

    // run again after unticking everything: that day's shifts should show "already there?"
    await rv.ev("new Promise(r => chrome.storage.local.set({sh_done: {}}, r))");
    await sleep(500);
    const restart = async () => {
      await k.until(`${P}.querySelector('#again') || ${P}.querySelector('#go')`);
      const again = await k.ev(`${P}.querySelector('#again')`); if (again !== null) await k.ev(`${P}.querySelector('#again').click()`);
      await k.until(`${P}.querySelector('#go')`);
      await k.ev(`${P}.querySelector('#go').click()`);
      await toDay(D);
    };
    await restart();
    const flagged = await k.ev(`${P}.querySelectorAll('.sh-flag').length`);
    const unticked = await k.ev(`[...${P}.querySelectorAll('[data-pick]')].filter(c => !c.checked).length`);
    console.log(`already-there check: ${flagged} of ${day.length} flagged, ${unticked} unticked`);
    await k.shot("7_already_there");
    assert.equal(flagged, day.length);
    await k.ev(`${P}.querySelector('[data-ans=stop]').click()`);

    // Kronos without the job menu: auto-fill must stop and ask on a job-change shift
    await k.ev("window.HIDE_JOB = true");
    await restart();
    const fIdx = day.findIndex((s) => s.jobChange);
    await k.ev(`[...${P}.querySelectorAll('[data-pick]')].forEach((c, i) => { c.checked = i === ${fIdx}; })`);
    await k.ev(`${P}.querySelector('[data-ans=go]').click()`);
    await k.until(`${P}.querySelector('.sh-warn')`, 60000, "job-menu warning");
    const jwarn = await k.ev(`${P}.querySelector('#auto').innerText`);
    console.log("no job menu ->", jwarn.replace(/\n+/g, " | ").slice(0, 300));
    assert(/Changing the job/.test(jwarn) && /couldn't find/i.test(jwarn));
    await k.shot("9_job_menu_missing");
    await k.ev(`${P}.querySelector('[data-ans=stop]').click()`);
    await k.ev("window.HIDE_JOB = false");
    if (process.env.EXT_SHOT) { // picture of Chrome's extensions page for the instructions
      const ex = await page("chrome://extensions/");
      await sleep(1500);
      await ex.ev(`(() => { const m = document.querySelector('extensions-manager'); const t = m.shadowRoot.querySelector('extensions-toolbar').shadowRoot.querySelector('#devMode'); if (!t.checked) t.click(); })()`);
      await sleep(1000);
      await ex.shot("0_chrome_extensions");
      // the copy-mode panel with a shift done
      await k.ev(`${P}.querySelector('[data-tab=copy]').click()`);
      await sleep(500);
      await k.shot("8_copy_after");
    }
    console.log("page errors:", events.length ? events : "none");
    console.log("E2E PASS");
  } catch (e) {
    console.log("E2E FAIL:", e.message);
    process.exitCode = 1;
  } finally {
    try { await cmd("Browser.close"); } catch (e) { /* ignore */ }
    chrome.kill(); server.close();
  }
})();
