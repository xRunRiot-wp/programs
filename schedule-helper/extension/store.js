// Small wrapper around the extension's own storage (stays on this computer only).
//   sh_data   = the loaded week: { week, filename, shifts, settings }
//   sh_done   = { shiftId: time } shifts already entered in Kronos
//   sh_recipe = the steps learned in "Show me once"
//   sh_copy   = copy mode: where Zack is up to, and the text formats
//   sh_prefs  = review-screen choices kept for next week (name fixes, job map, usual job per person)
globalThis.SHStore = {
  get(key) {
    return new Promise((res) => chrome.storage.local.get(key, (v) => res(v[key])));
  },
  set(key, value) {
    return new Promise((res) => chrome.storage.local.set({ [key]: value }, res));
  },
  onChange(fn) {
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "local") fn(changes); });
  },
  async markDone(id, yes = true) {
    const done = (await this.get("sh_done")) || {};
    if (yes) done[id] = Date.now(); else delete done[id];
    await this.set("sh_done", done);
    return done;
  },
};
