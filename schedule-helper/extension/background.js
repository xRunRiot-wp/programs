// Clicking the toolbar button opens the review screen.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("review.html") }));

// ---------------- Live help ----------------
// Only when Zack turned it on (kronos.js checks that and masks names before sending here):
// lines are collected for ~2.5 s and posted as one Discord message; a screen description
// goes along as a JSON file. The code (webhook link) lives only in chrome.storage.
const ICON = { step: "▶", ok: "✓", stuck: "⚠", asked: "?", answer: "→", note: "💬", error: "✖", info: "ℹ" };
let queue = [], files = [], timer = null;

// Replies: when Live help switches on, the helper posts one "mailbox" message with its own code; Joseph/Cisco edit
// that message (zack_reply.py) and the helper reads it back here (GET on the webhook's own message).
chrome.storage.onChanged.addListener(async (c) => {
  if (!c.sh_live) return;
  const now = c.sh_live.newValue;
  if (!now || !now.on || now.mailbox) return;   // switching on writes a fresh sh_live without a mailbox
  try {
    const r = await fetch(now.code + "?wait=true", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Schedule Helper (Zack)", content: "📬 **Messages for Zack** (Zack's helper shows what's written here)\n_(nothing yet)_", allowed_mentions: { parse: [] } }) });
    const j = await r.json();
    if (j && j.id) await chrome.storage.local.set({ sh_live: { ...now, mailbox: j.id } });
  } catch (e) { /* offline: no replies this time */ }
});

const attached = new Set(), detachTimer = {};

// Self-update (Joseph 10-11: "implement changes automatically for him"): "Update Schedule Helper.bat" (or the hourly
// automatic check) copies the newest release over this folder; when the manifest on disk shows a new version,
// reload -- but never in the middle of an auto-fill run (kronos.js keeps sh_busy fresh while running).
chrome.alarms.create("sh-selfupdate", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "sh-selfupdate") return;
  try {
    const disk = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
    if (!disk.version || disk.version === chrome.runtime.getManifest().version) return;
    const { sh_busy } = await chrome.storage.local.get("sh_busy");
    if (sh_busy && Date.now() - sh_busy < 90000) return;
    chrome.runtime.reload();
  } catch (e) { /* half-copied files: try again next minute */ }
});
chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));   // closed bar / tab / timer

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m && m.type === "live-poll") {
    chrome.storage.local.get("sh_live").then(async ({ sh_live: l }) => {
      if (!l || !l.on || !l.code || !l.mailbox) return reply(null);
      try {
        const r = await fetch(`${l.code}/messages/${l.mailbox}`);
        if (r.status === 401 || r.status === 404) return reply(null);
        const j = await r.json();
        reply({ content: (j && j.content) || "" });
      } catch (e) { reply(null); }
    });
    return true;   // answer comes later
  }
  // v3.18 (Zack 10-11: "have it click Add shift itself"): Kronos ignores clicks a page script makes on its
  // right-click menu, so press it like a real mouse through Chrome's debugger, then let go at once.
  // Chrome shows a "started debugging this browser" bar while attached; it stays for the run (attaching each
  // time would resize the page and close Kronos's menu) and goes 5 minutes after the last click.
  if (m && m.type === "trusted-click" && sender.tab) {
    const t = { tabId: sender.tab.id };
    const send = (method, params) => chrome.debugger.sendCommand(t, method, params);
    (async () => {
      try {
        if (!attached.has(t.tabId)) {
          await chrome.debugger.attach(t, "1.3"); attached.add(t.tabId);
          await new Promise((r) => setTimeout(r, 400));   // let the page settle under Chrome's bar
        }
        clearTimeout(detachTimer[t.tabId]);
        detachTimer[t.tabId] = setTimeout(() => chrome.debugger.detach(t).catch(() => {}), 5 * 60000);
        if (m.prepare) return reply({ ok: true });       // just put the bar up before the run starts
        const at = { x: m.x, y: m.y };
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
        await new Promise((r) => setTimeout(r, 80));
        await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...at });
        await new Promise((r) => setTimeout(r, 60));
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...at });
        reply({ ok: true });
      } catch (e) { reply({ ok: false, why: String(e && e.message || e) }); }
    })();
    return true;
  }
  if (!m || m.type !== "live") return;
  const t = new Date().toTimeString().slice(0, 8);
  queue.push(`\`${t}\` ${ICON[m.kind] || "·"} ${m.kind === "stuck" || m.kind === "note" || m.kind === "error" ? "**" + m.text + "**" : m.text}`);
  if (m.file) files.push({ name: `${m.kind}-${t.replace(/:/g, "")}.json`, body: m.file });
  // ~6 s batches keep a whole week under Discord's limit; stuck / Zack's notes go out at once
  if (m.kind === "stuck" || m.kind === "note" || m.kind === "error") { clearTimeout(timer); timer = setTimeout(flush, 300); }
  else if (!timer) timer = setTimeout(flush, 6000);
});

async function flush() {
  timer = null;
  const { sh_live: l } = await chrome.storage.local.get("sh_live");
  if (!l || !l.on || !l.code) { queue = []; files = []; return; }
  while (queue.length || files.length) {
    let text = "";
    while (queue.length && (text + queue[0]).length < 1900) text += queue.shift() + "\n";
    if (!text && queue.length) text = queue.shift().slice(0, 1900);
    const batch = files.splice(0, 3);
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ username: "Schedule Helper (Zack)", content: text || "(screen description)", allowed_mentions: { parse: [] } }));
    batch.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.body], { type: "application/json" }), f.name));
    try {
      const r = await fetch(l.code, { method: "POST", body: form });
      if (r.status === 429) {                       // Discord says slow down: wait and retry this batch
        const wait = (await r.json().catch(() => ({}))).retry_after || 2;
        queue.unshift(text.trimEnd()); files.unshift(...batch);
        await new Promise((res) => setTimeout(res, wait * 1000 + 200));
      } else if (r.status === 401 || r.status === 404) { // code removed by Joseph: switch off
        await chrome.storage.local.set({ sh_live: { ...l, on: false } });
        queue = []; files = []; return;
      }
    } catch (e) { queue = []; files = []; return; }   // offline: drop, never pile up
    await new Promise((res) => setTimeout(res, 600));
  }
}
