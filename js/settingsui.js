// The Settings dialog. Only choices that matter in daily use; every change applies at once (there is no Apply button) and is stored on this device (prefs.js).
import { el, icon, toast, dialog } from "./ui.js";
import { prefs } from "./prefs.js";
import { MODES } from "./smartlink.js";
import * as DX from "./diagnostics.js";

const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.max(0.1, b / 1e6).toFixed(b < 1e7 ? 1 : 0) + " MB");

export async function openSettings(app) {
  const section = (title, ...rows) => el("section", { class: "setsec" }, el("h3", {}, title), ...rows);
  const row = (label, hint, control) => el("div", { class: "setrow" }, el("div", { class: "settxt" }, el("div", { class: "setlbl" }, label), hint ? el("div", { class: "sethint" }, hint) : null), control);
  // a preference that is a plain on/off, or one that is "system" / "reduce" (motion)
  const toggle = (key, label, hint, { disabled = false, on = (v) => !!v, set = (c) => c } = {}) => {
    const id = "set-" + key, inp = el("input", { type: "checkbox", id, checked: on(prefs.get(key)), disabled, onchange: () => prefs.set(key, set(inp.checked)) });
    return el("div", { class: "setrow" }, el("label", { class: "settxt", for: id }, el("div", { class: "setlbl" }, label), hint ? el("div", { class: "sethint" }, hint) : null), inp);
  };
  const seg = (key, options) => {
    const box = el("div", { class: "setseg", role: "radiogroup" });
    const draw = () => box.replaceChildren(...options.map(([v, l]) => el("button", { type: "button", role: "radio", "aria-checked": String(prefs.get(key) === v), class: "btn small" + (prefs.get(key) === v ? " on" : ""), onclick: () => { prefs.set(key, v); draw(); } }, l)));
    draw(); return box;
  };

  const smart = el("select", { "aria-label": "Smart linking", onchange: () => app.smart.setMode(smart.value) }, MODES.map(([v, l]) => el("option", { value: v, selected: v === app.smart.mode }, l)));
  const lastBackup = () => (app.savedAt ? `Last backup: ${new Date(app.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "No backup yet in this session.");
  const store = el("div", { class: "sethint" }, "Checking storage…");
  navigator.storage?.estimate?.().then((e) => { store.textContent = `Backups on this device use ${fmtMB(e.usage || 0)}${e.quota ? " of about " + fmtMB(e.quota) + " available" : ""}.`; }).catch(() => { store.textContent = ""; });

  const body = el("div", { class: "settings" },
    section("Appearance",
      row("Theme", "Dark changes the application around the paper; the paper keeps its colour.", seg("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]])),
      toggle("motion", "Reduce motion", "Turn off animations and fades. (NoteFlow also follows your system setting.)", { on: (v) => v === "reduce", set: (c) => (c ? "reduce" : "system") })),
    section("Workspace",
      toggle("autoSave", "Auto-Save Workspace", "Saves every change on this device as you work, so closing or refreshing never loses anything and your workspace is back when you reopen NoteFlow. With it off, press Ctrl+S to save."),
      row("Save now", lastBackup(), el("button", { class: "btn small", type: "button", onclick: async () => { await app.saveNow(); ref.close(); } }, "Save")),
      row("Export a file", "A copy of the whole workspace as a file on your computer, to keep or move it. (Saving above never creates a file.)", el("button", { class: "btn small", type: "button", onclick: () => { ref.close(); app.exportWorkspace(); } }, "Export…"))),
    section("Pen", toggle("pressure", "Pen pressure", "A stroke gets thicker the harder you press (only with a stylus that reports pressure).")),
    section("Smart linking", row("Suggestions", "Compares only the pages you are looking at. Off by default.", smart)),
    section("Performance",
      toggle("memorySaver", "Memory saver", "Keeps fewer pages in memory and draws at a lower resolution. Use it on an older computer or tablet, or with very large PDFs."), store),
    section("Troubleshooting",
      row("Diagnostic log", "Errors recorded in this session. Nothing is ever sent anywhere.", el("button", { class: "btn small", type: "button", onclick: async () => {
        try { await navigator.clipboard.writeText(DX.report({ workspace: app.wsName || "(not exported)", backup: app.autosaveOk ? "ok" : "failing" })); toast("Copied. Paste it into your bug report."); } catch { toast("Could not copy. Allow clipboard access and try again.", 4000); } } }, "Copy log")),
      row("Reset settings", "Puts every setting on this page back to its default. Your work is not touched.", el("button", { class: "btn small", type: "button", disabled: prefs.isDefault(), onclick: () => { prefs.reset(); app.smart.mode !== "off" && app.smart.setMode("off"); ref.close(); toast("Settings reset."); } }, "Reset")),
      row("Clear this device's backup", "Deletes the backup kept in this browser. Do this only after exporting the workspace to a file.", el("button", { class: "btn small danger", type: "button", onclick: async () => {
        if (!(await dialog({ title: "Clear the backup?", content: "The automatic backup on this device will be deleted. Work that has not been exported to a file cannot be recovered after that.", buttons: [{ label: "Cancel", value: false }, { label: "Delete backup", value: true, danger: true }] }))) return;
        try { await app.clearBackup(); toast("Backup cleared."); } catch (e) { toast("Could not clear it: " + (e.message || e), 4000); } } }, "Clear…"))));
  const ref = {};
  await dialog({ title: "Settings", content: body, buttons: [{ label: "Done", value: true, primary: true }], ref });
}
