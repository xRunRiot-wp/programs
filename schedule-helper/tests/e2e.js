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
    console.log("next-day tags:", await rv.ev("document.querySelectorAll('.tag.next').length"), "double tags:", await rv.ev("document.querySelectorAll('.tag:not(.next)').length"));
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
    await k.ev(`window.DIRECTORY = ${JSON.stringify(DIRECTORY)}`);
    // copy mode
    await k.ev(`${P}.querySelector('[data-act=nextfield]').click()`);
    await sleep(300);
    console.log("copy note:", await k.ev(`${P}.querySelector('.sh-note').innerText`));
    await k.ev(`${P}.querySelector('[data-act=nextfield]').click()`); await sleep(300);
    console.log("copy note 2:", await k.ev(`${P}.querySelector('.sh-note').innerText`));
    await k.shot("2_copy_mode");

    // show me once: add the first shift by hand with real clicks/typing
    await k.ev(`${P}.querySelector('[data-tab=teach]').click()`);
    await k.until(`${P}.querySelector('#recgo')`);
    const exId = await k.ev(`${P}.querySelector('#ex').value`);
    const ex = roster.shifts.find((s) => s.id === exId);
    console.log("teaching with", ex.day, ex.start, ex.end, ex.kronosJob);
    await k.ev(`${P}.querySelector('#recgo').click()`);
    await sleep(300);
    const box = async (js) => k.ev(`(() => { const e = ${js}; const r = e.getBoundingClientRect(); const f = document.getElementById('dlg').getBoundingClientRect(); const inF = e.ownerDocument !== document; return [r.left + r.width/2 + (inF ? f.left + 2 : 0), r.top + r.height/2 + (inF ? f.top + 2 : 0)]; })()`);
    const D = "document.getElementById('dlg').contentDocument";
    let [x, y] = await box("document.getElementById('quick')"); await k.mouse(x, y);
    await k.until(`${D} && ${D}.getElementById('emp')`);
    await sleep(300);
    const last = ex.kronosName.split(",")[0];
    [x, y] = await box(`${D}.getElementById('emp')`); await k.mouse(x, y); await k.type(last);
    await k.until(`[...${D}.querySelectorAll('li')].some(l => l.textContent === ${JSON.stringify(ex.kronosName)})`);
    [x, y] = await box(`[...${D}.querySelectorAll('li')].find(l => l.textContent === ${JSON.stringify(ex.kronosName)})`); await k.mouse(x, y);
    [x, y] = await box(`${D}.getElementById('date')`); await k.mouse(x, y); await k.type(R.formatValue(ex, { field: "date", fmt: "MM/DD/YYYY" }));
    [x, y] = await box(`${D}.getElementById('st')`); await k.mouse(x, y); await k.type(R.niceTime(ex.start));
    [x, y] = await box(`${D}.getElementById('en')`); await k.mouse(x, y); await k.type(R.niceTime(ex.end));
    await k.ev(`(() => { const s = ${D}.getElementById('job'); s.value = ${JSON.stringify(ex.kronosJob)}; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    [x, y] = await box(`${D}.getElementById('save')`); await k.mouse(x, y);
    await k.until("window.added.length === 1");
    await sleep(500);
    await k.shot("3_watching");
    await k.ev(`${P}.querySelector('#recdone').click()`);
    await k.until(`${P}.querySelector('#recsave')`);
    const steps = await k.ev(`[...${P}.querySelectorAll('.sh-steps > li')].map(li => li.innerText.split('\\n')[0] + ' => ' + (li.querySelector('select') ? li.querySelector('select').selectedOptions[0].text : '-') + (li.querySelector('[data-save]')?.checked ? ' [SAVE]' : ''))`);
    console.log("learned steps:\n  " + steps.join("\n  "));
    await k.shot("4_review_steps");
    await k.ev(`${P}.querySelector('#recsave').click()`);
    await k.until(`${P}.querySelector('#recgo')`);

    // auto-fill Monday
    await k.ev(`${P}.querySelector('[data-tab=auto]').click()`);
    await k.until(`${P}.querySelector('#go')`);
    await k.ev(`${P}.querySelector('#go').click()`);
    await k.until(`${P}.querySelector('[data-ans=go]')`, 20000, "day list");
    console.log("day list:", await k.ev(`${P}.querySelector('#auto p').innerText`), "| rows:", await k.ev(`${P}.querySelectorAll('[data-pick]').length`), "| flagged:", await k.ev(`${P}.querySelectorAll('.sh-flag').length`));
    await k.shot("5_day_list");
    await k.ev(`${P}.querySelector('[data-ans=go]').click()`);
    const mon = roster.shifts.filter((s) => s.day === ex.day);
    await k.until(`window.added.length === ${mon.length} || !!${P}.querySelector('.sh-warn')`, 180000, "Monday entered");
    const warn = await k.ev(`${P}.querySelector('.sh-warn') && ${P}.querySelector('.sh-warn').innerText`);
    if (warn) { await k.shot("x_warn"); throw new Error("auto-fill stopped: " + warn); }
    await k.until(`${P}.querySelector('[data-ans=go]')`, 20000, "next day list");
    await k.shot("6_after_monday");
    await k.ev(`${P}.querySelector('[data-ans=stop]').click()`);
    const added = await k.ev("window.added");
    // every Monday shift entered exactly once, with the right values
    const want = mon.map((s) => JSON.stringify({ name: s.kronosName, date: R.formatValue(s, { field: "date", fmt: "MM/DD/YYYY" }), start: R.niceTime(s.start), end: R.niceTime(s.end), job: s.kronosJob })).sort();
    const got = added.map((a) => JSON.stringify(a)).sort();
    assert.deepEqual(got, want);
    console.log(`auto-fill entered ${added.length - 1} shifts + 1 by hand = all ${mon.length} ${ex.day} shifts, values match the roster`);

    // run again after unticking everything: Monday shifts should show "already there?"
    await rv.ev("new Promise(r => chrome.storage.local.set({sh_done: {}}, r))");
    await sleep(500);
    await k.until(`${P}.querySelector('#again') || ${P}.querySelector('#go')`);
    const again = await k.ev(`${P}.querySelector('#again')`); if (again !== null) await k.ev(`${P}.querySelector('#again').click()`);
    await k.until(`${P}.querySelector('#go')`);
    await k.ev(`${P}.querySelector('#go').click()`);
    await k.until(`${P}.querySelector('[data-ans=go]')`);
    const flagged = await k.ev(`${P}.querySelectorAll('.sh-flag').length`);
    const unticked = await k.ev(`[...${P}.querySelectorAll('[data-pick]')].filter(c => !c.checked).length`);
    console.log(`already-there check: ${flagged} of ${mon.length} flagged, ${unticked} unticked`);
    await k.shot("7_already_there");
    assert.equal(flagged, mon.length);
    await k.ev(`${P}.querySelector('[data-ans=stop]').click()`);
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
