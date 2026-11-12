// NoteFlow: application shell - layout, workspace files, autosave, dialogs, shortcuts.
import * as M from "./model.js";
import * as K from "./keys.js";
import { initTouchTips } from "./tips.js";
import * as WS from "./workspace.js";
import { Panel, setMemorySaver } from "./panel.js";
import { LinkController } from "./linkui.js";
import { SearchUI } from "./searchui.js";
import { SmartLink } from "./smartlink.js";
import { SnipTool } from "./snip.js";
import * as SF from "./savefile.js";
import { openSettings } from "./settingsui.js";
import { SourcesPanel } from "./sourcesui.js";
import { Bookmarks } from "./bookmarks.js";
import * as DX from "./diagnostics.js";
import { prefs } from "./prefs.js";
import * as SEL from "./selection.js";
import { setImageLoadedCallback, bumpFontEpoch } from "./render.js";
import { el, icon, toast, dialog, popup, closePopup } from "./ui.js";

const PER_PANEL = 430;                               // a workspace with n panels needs n * 430 px, below that one panel is shown at a time (tabs)
const PANEL_NAMES = { pdf: "PDF", pdf2: "PDF 2", nb: "Notebook", nb2: "Notebook 2", board: "Board", board2: "Board 2" };
// The Layout menu chooses the workspace type, i.e. which panels the workspace consists of (not just what is visible).
const LAYOUTS = [["PDF Only", ["pdf"]], ["Notebook Only", ["nb"]], ["Board Only", ["board"]], ["PDF + Notebook", ["pdf", "nb"]], ["Notebook + PDF", ["nb", "pdf"]],
  ["PDF + Board", ["pdf", "board"]], ["Notebook + Board", ["nb", "board"]], ["PDF + Notebook + Board", ["pdf", "nb", "board"]]];

// ------------------------------------------------------------- IndexedDB
const DB_NAME = "noteflow", LEGACY_DB_NAME = "dualnote";
const AUTOSAVE_QUIET_MS = 1200, AUTOSAVE_MAX_WAIT_MS = 8000;       // Auto-Save: a backup this long after the last change, and at the latest this long after the first unsaved one
/** The session database. Sessions saved before the product was renamed live in the "dualnote" database: on the first start under the new name they are copied over (and only then
 *  is the old database removed), so an existing user loses nothing. If the copy fails the old database is left alone and keeps being used as a read-only fallback for the restore. */
const openDb = (name) => new Promise((res, rej) => {
  const r = indexedDB.open(name, 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const idbAll = (db) => new Promise((res, rej) => {
  const t = db.transaction("kv", "readonly"), s = t.objectStore("kv"), out = [], rq = s.openCursor();
  rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
  t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
});
/** Is there a session database from before the rename? (Browsers without indexedDB.databases(): open it and see whether it had to be created, then remove what we created.) */
async function legacyDbExists() {
  if (indexedDB.databases) return (await indexedDB.databases()).some((d) => d.name === LEGACY_DB_NAME);
  return new Promise((res) => {
    const r = indexedDB.open(LEGACY_DB_NAME); let fresh = false;
    r.onupgradeneeded = () => { fresh = true; };
    r.onsuccess = () => { r.result.close(); if (fresh) indexedDB.deleteDatabase(LEGACY_DB_NAME); res(!fresh); };
    r.onerror = () => res(false);
  });
}
async function migrateLegacyDb(db) {
  try {
    if (!(await legacyDbExists())) return;
    if ((await new Promise((res, rej) => { const t = db.transaction("kv", "readonly"), q = t.objectStore("kv").count(); q.onsuccess = () => res(q.result); t.onerror = () => rej(t.error); })) > 0) return;   // (already has data)
    const old = await openDb(LEGACY_DB_NAME), rows = await idbAll(old);
    await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"), s = t.objectStore("kv"); for (const [k, v] of rows) s.put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    old.close(); indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch (e) { console.warn("could not migrate the old session database", e); }
}
const idb = {
  db: null,
  open() {
    if (this.db) return this.db;
    return (this.db = openDb(DB_NAME).then(async (db) => { await migrateLegacyDb(db); return db; }));
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction("kv", mode), s = t.objectStore("kv"); let r; try { r = fn(s); } catch (e) { try { t.abort(); } catch { /* already finished */ } rej(e); return; }      /* (an error while queueing a write, e.g. a value that cannot be stored, must undo the whole transaction: otherwise the writes before it would be committed) */
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  },
  get(k) { return this.tx("readonly", (s) => s.get(k)); },
  set(k, v) { return this.tx("readwrite", (s) => s.put(v, k)); },
  del(k) { return this.tx("readwrite", (s) => s.delete(k)); },
  /** Many writes and deletes in ONE transaction: they all happen or none does (an interrupted or failing save leaves the previous state exactly as it was). */
  batch(puts, dels = []) { return this.tx("readwrite", (s) => { for (const [k, v] of puts) s.put(v, k); for (const k of dels) s.delete(k); return null; }); },
  keys() { return this.tx("readonly", (s) => s.getAllKeys()); },
};

export class App {
  constructor(root) {
    this.root = root;
    this.order = [...M.DEFAULT_LAYOUT]; this.viewMode = "both"; this.tab = 0; this.active = null;
    this.idb = idb; this.links = new LinkController(this);                 // (before the panels: they draw the link marks)
    this.panels = { pdf: new Panel(this, "pdf", "pdf", "PDF"), pdf2: new Panel(this, "pdf2", "pdf", "PDF 2"),
      nb: new Panel(this, "nb", "nb", "Notebook"), nb2: new Panel(this, "nb2", "nb", "Notebook 2"),
      board: new Panel(this, "board", "board", "Board"), board2: new Panel(this, "board2", "board", "Board 2") };
    this._partIds = new WeakMap(); this._written = new Set();
    this.autosaveOk = true; this.restoring = false; this.autosaveTimer = 0; this.wsName = null; this.installEvt = null;
    this.changeSeq = 0; this.savedSeq = 0; this.savedAt = 0; this.backing = false; this.backupAgain = false; this.firstChangeAt = 0; this.exporting = false;      // (backup bookkeeping: any change bumps changeSeq; a successful backup of the state at that moment sets savedSeq)
    this.autosavePaused = false; this.autosaveError = null;
    setImageLoadedCallback(() => { for (const p of Object.values(this.panels)) p.render(); });
    // the bundled Persian font is used by the canvas too: redraw once it has loaded
    document.fonts?.addEventListener?.("loadingdone", () => { bumpFontEpoch(); for (const p of Object.values(this.panels)) p.render(); });         // text is measured again with the real font
    document.fonts?.load?.('16px Vazirmatn', "\u067e\u0686\u0698\u06af").then(() => { bumpFontEpoch(); for (const p of Object.values(this.panels)) p.render(); }).catch(() => {});   // pictures that finish decoding appear at once
    this.buildDom();
    this.search = new SearchUI(this);
    this.smart = new SmartLink(this);
    this.bookmarks = new Bookmarks(); this.bookmarks.onChange(() => this.scheduleAutosave());
    this.snip = new SnipTool(this);
    this.linksCount = el("span", { class: "lcount", hidden: true }); this.linksBtn.append(this.linksCount);          // (how many links there are)
    const upd = () => { const n = this.links.store.size; this.linksCount.textContent = String(n); this.linksCount.hidden = !n; };
    this.links.store.onChange(upd); upd();
    this.refreshLayout();
    window.addEventListener("resize", () => this.refreshLayout());
    window.addEventListener("beforeunload", (e) => { this.flushAutosave(); if (this.changeSeq !== this.savedSeq && (!prefs.get("autoSave") || !this.autosaveOk)) { e.preventDefault(); e.returnValue = ""; } });       // (a warning only when changes would really be lost)
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") this.flushAutosave(); });
    window.addEventListener("pagehide", () => this.flushAutosave());
    initTouchTips();                                      // press-and-hold bubbles for touch / pen (desktop keeps the browser tooltip)
    document.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("keyup", (e) => { if (K.keyName(e) === " ") this.endTempHand(); });          // releasing Space returns to the previous tool
    window.addEventListener("blur", () => this.endTempHand());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.endTempHand(); });
    document.addEventListener("paste", (e) => this.onPaste(e));
    document.addEventListener("copy", (e) => this.onCopyCut(e, false));
    document.addEventListener("cut", (e) => this.onCopyCut(e, true));
    document.addEventListener("dragover", (e) => { e.preventDefault(); });
    document.addEventListener("drop", (e) => this.onDrop(e));
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); this.installEvt = e; this.installBtn.hidden = false; });
    DX.install((entry) => this.onUnexpectedError(entry));
    this.applyAppearance();
    this.applyMemoryMode();
    prefs.onChange((k) => { if (k === "memorySaver") this.applyMemoryMode(); if (k === "theme" || k === "motion") this.applyAppearance(); if (k === "autoSave") this.onAutoSaveChanged(); });
    try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (prefs.get("theme") === "system") this.applyAppearance(); }); } catch { /* old browser */ }
    this.refreshSaveStatus();
    this.setActive(this.panels.pdf);
  }

  // --------------------------------------------------------------------- DOM
  buildDom() {
    const b = (ic, label, title, fn, cls = "") => el("button", { class: "btn " + cls, type: "button", title, "aria-label": title, onclick: fn }, icon(ic), el("span", { class: "lbl" }, label));
    this.wsOpenInput = el("input", { type: "file", accept: ".nfws,.dnws,application/zip", hidden: true, onchange: () => this.onWorkspaceFile() });
    this.layoutBtn = b("layout", "Layout", "Choose the workspace layout (which panels it has)", () => this.openLayoutMenu());
    this.switchBtn = b("swap", "Switch", "Swap the left and right panels (nothing is closed or lost)", () => this.switchSides());
    this.seg = el("div", { class: "seg", role: "tablist" });
    this.installBtn = b("plus", "Install", "Install NoteFlow as an app", async () => { if (this.installEvt) { this.installEvt.prompt(); this.installEvt = null; this.installBtn.hidden = true; } }, "primary");
    this.installBtn.hidden = true;
    this.top = el("header", { class: "topbar" },
      el("span", { class: "brand" }, "NoteFlow"),
      b("open", "Open workspace", "Open a workspace file (.nfws; older .dnws files open too)", () => this.wsOpenInput.click()),
      b("save", "Save", "Save everything on this device now (" + K.MOD + "+S). NoteFlow also saves automatically (Settings: Auto-Save Workspace), and brings your work back when you reopen it.", () => this.saveNow()),
      this.saveStat = el("button", { class: "savestat", type: "button", "data-state": "saved", onclick: () => this.saveNow() }),
      b("export", "Export", "Export a copy of the workspace as a file on your computer (" + K.MOD + "+Shift+E)", () => this.exportWorkspace()),
      b("plus", "New", "Start a new empty workspace", () => this.newWorkspace()),
      b("search", "Search", "Search everywhere: notebooks, PDFs, boards (" + K.MOD + "+Shift+F)", () => this.search.toggle()),
      b("snip", "Snip", "Snipping tool: capture an area of a PDF page, a notebook page or the board, then copy it or insert it into another panel (" + K.MOD + "+Shift+S)", () => this.snip.toggle()),
      this.linkBtn = b("chain", "Link", "Link two things: a note, text box or drawing with a PDF page, region or text. Select the note first, or just press Link.", () => this.startLink()),
      this.sourcesBtn = b("toc", "Sources", "Side panel: the sources of the page you are on (which PDF passages your notes cite, which notes cite this page), page thumbnails, and the PDF outline with your bookmarks", () => this.sources.toggle()),
      this.linksBtn = b("list", "Links", "All links between notes and PDFs: see, open or remove them, and the Smart linking settings", () => this.links.manage()),
      el("span", { class: "gap" }), this.layoutBtn, this.switchBtn, this.seg, this.installBtn,
      b("gear", "", "Settings: appearance, saving, pen, performance", () => this.openSettings(), "icon-only"),
      b("menu", "", "Help", () => this.help(), "icon-only"), this.wsOpenInput);
    this.main = el("main", { class: "main" });
    for (const k of Object.keys(this.panels)) this.main.append(this.panels[k].root);
    this.sources = new SourcesPanel(this);                                   // (docked after the panels, hidden until opened)
    this.busyBox = el("div", { class: "busy", hidden: true }, el("div", { class: "busybox" }, el("div", { class: "spin" }), el("div", { class: "busymsg" }), el("div", { class: "bar2" }, el("div", { class: "fill" }))));
    this.root.append(this.top, this.main, this.busyBox);
  }
  name(key) {                                         // "PDF 1" / "PDF 2" when both instances are in the workspace
    const base = PANEL_NAMES[key], twin = key.endsWith("2") ? null : key + "2";
    return twin && this.order.includes(twin) ? base + " 1" : base;
  }
  get narrow() { const n = this.order.length; return n >= 2 && window.innerWidth < PER_PANEL * n; }
  /** Wide screens show every panel of the workspace. On a narrow screen (phone) a multi-panel workspace shows one panel at a time (tabs). */
  shownKeys() { const o = this.order; return o.length < 2 || !this.narrow ? o : [o[Math.min(this.tab, o.length - 1)]]; }
  refreshLayout() {
    const n = this.order.length, shown = this.shownKeys();
    for (const [k, p] of Object.entries(this.panels)) {
      p.root.hidden = !shown.includes(k); p.root.style.order = String(this.order.indexOf(k) < 0 ? 9 : this.order.indexOf(k));
      p.setLabel(this.name(k));
    }
    this.root.dataset.narrow = String(this.narrow);
    this.seg.replaceChildren();
    const tabs = n >= 2 && this.narrow ? this.order : [];
    this.seg.hidden = !tabs.length; this.switchBtn.hidden = n !== 2;
    const preset = LAYOUTS.find(([, o]) => o.join() === this.order.join());
    this.layoutBtn.title = `Layout: ${preset ? preset[0] : `custom (${n} panels)`} - choose which panels the workspace has`;
    tabs.forEach((k, i) => this.seg.append(el("button", { class: "segbtn" + (shown[0] === k ? " on" : ""), type: "button", role: "tab", "aria-selected": String(shown[0] === k),
      onclick: () => this.setTab(i) }, this.name(k))));
    for (const k of shown) this.panels[k].onResize();
    if (!shown.includes(this.active?.key)) this.setActive(this.panels[shown[0]]);
  }
  setTab(i) { this.tab = i; this.viewMode = i === 0 ? "left" : i === 1 ? "right" : "both"; this.refreshLayout(); this.scheduleAutosave(); }
  setView(mode) { this.setTab(mode === "right" ? 1 : 0); }          // (older name)
  setActive(p) { if (this.active === p) return; this.active = p; for (const q of Object.values(this.panels)) q.root.classList.toggle("active", q === p); this.sources?.refresh(); }
  openLayoutMenu() {
    const row = (label, on, fn) => el("button", { class: "mi" + (on ? " on" : ""), type: "button", role: "menuitemradio", "aria-checked": String(on), onclick: fn },
      el("span", { class: "chk" }, on ? "✓" : ""), label);
    const custom = !LAYOUTS.some(([, o]) => o.join() === this.order.join());
    const box = el("div", { class: "menu", role: "menu" },
      ...LAYOUTS.map(([label, order]) => row(label, this.order.join() === order.join(), () => { closePopup(); this.setLayout(order); })),
      el("div", { class: "msep" }),
      row("Customize panels…", custom, () => { closePopup(); this.openArrange(); }));
    popup(this.layoutBtn, box);
  }
  /** Free arrangement: 1-3 panels, each one of the six (PDF, Notebook, Board and a second of each). Content stays with its panel. */
  async openArrange() {
    const rows = [...this.order], ALL = Object.keys(this.panels), prefer = ["pdf", "nb", "board", "pdf2", "nb2", "board2"];
    const box = el("div", { class: "arrange" });
    const draw = () => {
      box.replaceChildren(...rows.map((k, i) => {
        const sel = el("select", { "aria-label": `Panel ${i + 1}`, onchange: (e) => { rows[i] = e.target.value; draw(); } },
          ALL.filter((x) => x === k || !rows.includes(x)).map((x) => el("option", { value: x }, PANEL_NAMES[x])));
        sel.value = k;
        return el("div", { class: "arow" }, el("span", { class: "anum" }, String(i + 1)), sel,
          el("button", { class: "btn small", type: "button", title: "Move left", "aria-label": "Move left", disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); } }, "←"),
          el("button", { class: "btn small", type: "button", title: "Move right", "aria-label": "Move right", disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); } }, "→"),
          el("button", { class: "btn small", type: "button", title: "Remove this panel from the workspace", "aria-label": "Remove panel", disabled: rows.length <= 1, onclick: () => { rows.splice(i, 1); draw(); } }, "✕"));
      }),
      rows.length < M.MAX_PANELS ? el("button", { class: "btn", type: "button", onclick: () => { rows.push(prefer.find((x) => !rows.includes(x))); draw(); } }, icon("plus"), "Add panel")
        : el("p", { class: "muted" }, `A workspace has up to ${M.MAX_PANELS} panels.`),
      el("p", { class: "muted" }, "Panels left out are not deleted: they keep their content in memory and come back when you add them again. Left to right = the order on screen."));
    };
    draw();
    const ok = await dialog({ title: "Arrange panels", content: box, buttons: [{ label: "Cancel", value: false }, { label: "Apply", value: true, primary: true }] });
    if (ok) await this.setLayout(rows);
  }
  switchSides() { this.setLayout([...this.order].reverse(), false); }
  /** Change the workspace structure (which panels it consists of, and in which order). Panels that leave the structure are asked about first. */
  async setLayout(order, ask = true) {
    order = M.sanitizeLayout(order);
    if (order.join() === this.order.join()) { this.refreshLayout(); return true; }
    if (ask) for (const key of M.hiddenByLayoutChange(this.order, order)) if (!(await this.confirmExclude(key))) return false;
    this.order = order; this.viewMode = "both"; this.tab = 0;
    this.refreshLayout(); this.scheduleAutosave();
    return true;
  }
  /** Does this panel hold something the user made / opened? */
  hasContent(p) { return p.kind === "pdf" ? p.hasPage : (p.dirty || !this.isPristine(p)); }
  /** A panel is about to leave the workspace structure. Its data is NOT deleted: it stays in memory (and in the session backup)
   *  and returns when a layout with that panel is chosen again - but it is not part of the workspace file any more. */
  async confirmExclude(key) {
    const p = this.panels[key];
    if (!this.hasContent(p)) return true;
    const what = { pdf: "PDF", nb: "notebook", board: "board" }[p.kind], unsaved = p.dirty;
    const choice = await dialog({ title: `Leave the ${what} out of this workspace?`,
      content: el("div", {}, el("p", {}, `The new layout has no ${what} panel, so “${this.name(key)}” will no longer be part of this workspace and will not be written to its file.`),
        unsaved ? el("p", {}, "It also has changes that are not saved yet.") : "",
        el("p", { class: "muted" }, `Nothing is deleted: it stays in memory for this session and comes back if you choose a layout with a ${what} again. To keep it permanently, save it separately first.`)),
      buttons: [{ label: "Cancel", value: "cancel" }, { label: `Save the ${what} separately first`, value: "save" }, { label: "Continue", value: "go", primary: true }] });
    if (!choice || choice === "cancel") return false;
    if (choice === "save") return !!(await p.saveSeparately());
    return true;
  }
  /** The panel of this kind in the current workspace; if there is none (e.g. a PDF is dropped into a Notebook-only workspace), the workspace becomes PDF + Notebook. */
  async ensurePanelOfKind(kind) {
    const have = this.order.map((k) => this.panels[k]).find((q) => q.kind === kind);
    if (have) return have;
    const key = kind, keep = this.order.slice(0, M.MAX_PANELS - 1);                // a PDF goes to the left, the others to the right
    const order = this.order.length < M.MAX_PANELS ? (kind === "pdf" ? [key, ...this.order] : [...this.order, key]) : (kind === "pdf" ? [key, ...keep] : [...keep, key]);
    if (!(await this.setLayout(order))) return null;
    return this.panels[key];
  }
  /** Before a panel's content is replaced by opening something else. */
  async confirmReplace(p, action) {
    if (!p.dirty) return true;
    const choice = await dialog({ title: "Unsaved changes", content: `“${p.name || p.label}” has unsaved changes. Save a copy before you ${action}?`,
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Don't save", value: "dont", danger: true }, { label: "Save", value: "save", primary: true }] });
    if (!choice || choice === "cancel") return false;
    if (choice === "save") return p.saveSeparately();
    return true;
  }
  anyDirty() { return Object.values(this.panels).some((p) => p.dirty); }

  // -------------------------------------------------------------- files
  async saveBlob(blob, filename) {
    const cap = globalThis.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins?.Filesystem) {            // Android app (Capacitor)
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
      const r = await cap.Plugins.Filesystem.writeFile({ path: filename, data, directory: "CACHE" });
      if (cap.Plugins.Share) await cap.Plugins.Share.share({ title: filename, url: r.uri, dialogTitle: "Save or share " + filename });
      return;
    }
    const url = URL.createObjectURL(blob), a = el("a", { href: url, download: filename, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Saved “${filename}” (see your Downloads)`);
  }
  busy(msg) {
    const box = this.busyBox; box.hidden = false;
    box.querySelector(".busymsg").textContent = msg; box.querySelector(".fill").style.width = "0%";
    return { set: (f) => { box.querySelector(".fill").style.width = Math.round(f * 100) + "%"; }, done: () => { box.hidden = true; } };
  }
  async pasteButton(panel) {
    this.setActive(panel);
    try {
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) { await panel.insertImageBlob(await it.getType(type)); return; }
      }
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) panel.insertText(text); else toast("The clipboard is empty.");
    } catch {
      toast("Paste is not allowed here. Press Ctrl+V, or use the Image button to pick a picture.", 5000);
    }
  }
  /** Copy / Cut of the selected items (not while typing in a text field, which keeps its own text clipboard): a marker goes on the clipboard, the items stay in memory. */
  onCopyCut(e, cut) {
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
    if (window.getSelection && String(window.getSelection()).length) return;           // text selected on the page (a dialog, the help): an ordinary copy
    const p = this.active; if (!p || !p.hasSelection()) return;
    const items = p.selectionPayload(); if (!items.length) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", SEL.setBuffer(items, p.kind));
    if (cut) p.deleteSelected();
    toast(cut ? "Cut" : "Copied", 1200);
  }
  onPaste(e) {
    const t = e.target, clip = e.clipboardData?.getData("text/plain");
    if (SEL.isMarker(clip)) {                                                          // the clipboard holds items copied inside NoteFlow
      e.preventDefault();
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;      // (not pasted as text into a text field)
      const buf = SEL.bufferFor(clip), p = this.active;
      if (buf && p && p.hasPage) { buf.pastes++; p.pasteItems(JSON.parse(JSON.stringify(buf.items)), 16 * buf.pastes); }
      return;
    }
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;           // normal text paste
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const text = e.clipboardData?.getData("text/plain");
    const hasText = !!(text && text.trim());
    // A text paste that an editor already took (the rich text editor handles it and calls preventDefault, but the event still bubbles up to this document-level listener) or that is aimed
    // at an editable element is the editor's own: handling it here as well made a second text box with the same text. A picture alone is different: the editor cannot hold one, so it is
    // still added to the page, as before.
    const inEditor = e.defaultPrevented || !!(t && t.isContentEditable);
    if (inEditor && (hasText || !img)) return;
    const p = this.active; if (!p || !p.hasPage) return;
    if (img) { e.preventDefault(); p.insertImageBlob(img.getAsFile()); return; }
    if (hasText) { e.preventDefault(); p.insertText(text); }
  }
  panelAt(x, y) { const e = document.elementFromPoint(x, y)?.closest?.(".panel"); return e ? this.panels[e.dataset.key] : null; }
  async onDrop(e) {
    e.preventDefault();
    const at = this.panelAt(e.clientX, e.clientY);
    for (const f of e.dataTransfer?.files || []) {
      const n = f.name.toLowerCase();
      if (n.endsWith(".nfws") || n.endsWith(".dnws")) await this.openWorkspaceFile(f);
      else if (n.endsWith(".pdf") || f.type === "application/pdf") {
        const p = at && at.kind === "pdf" && this.order.includes(at.key) ? at : await this.ensurePanelOfKind("pdf");
        if (p && await this.confirmReplace(p, "open another PDF")) await p.openPdfBytes(new Uint8Array(await f.arrayBuffer()), f.name);
      } else if (n.endsWith(".nfboard") || n.endsWith(".dnboard")) {
        const p = at && at.kind === "board" && this.order.includes(at.key) ? at : await this.ensurePanelOfKind("board");
        if (p && await this.confirmReplace(p, "open another board")) { try { p.setBoard(M.parseBoard(await f.text()), f.name); } catch (err) { toast(err.message, 4000); } }
      } else if (n.endsWith(".nfnote") || n.endsWith(".dnote")) {
        const p = at && at.kind === "nb" && this.order.includes(at.key) ? at : await this.ensurePanelOfKind("nb");
        if (p && await this.confirmReplace(p, "open another notebook")) { try { p.setNotebook(M.parseNotebook(await f.text()), f.name); } catch (err) { toast(err.message, 4000); } }
      } else if (f.type.startsWith("image/")) {
        const p = at && at.hasPage ? at : this.active;
        if (p) await p.insertImageBlob(f);
      }
    }
  }
  endTempHand() { if (this.tempHeld) { this.tempHeld.endTempTool(); this.tempHeld = null; } }
  focusPanel(i) {
    const key = this.order[i];
    if (!key) return;
    if (this.narrow) this.setTab(i);
    this.setActive(this.panels[key]);
  }
  /**
   * The one keyboard entry point (a single document listener; nothing else handles keys except text boxes, which stop their own events).
   * Order matters: dialog > Ctrl+S > text field (typing owns the keyboard) > focused button > open menu > shortcuts.
   * Letters use keyName(), so shortcuts also work on a Persian (or any non-Latin) keyboard layout.
   */
  onKey(e) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;       // already handled / IME composition in progress
    const t = e.target, p = this.active, mod = e.ctrlKey || e.metaKey, key = K.keyName(e);
    if (document.querySelector(".backdrop")) return;                            // a dialog is open: it owns the keyboard (it handles its own Escape)
    if (mod && !e.altKey && !e.shiftKey && key === "s") { e.preventDefault(); this.saveNow(); return; }                       // Ctrl+S: a backup on this device, never a download
    if (mod && ((e.shiftKey && !e.altKey && key === "e") || (e.altKey && !e.shiftKey && key === "s"))) { e.preventDefault(); this.exportWorkspace(); return; }     // export a file
    if (mod && !e.altKey && e.shiftKey && key === "f") { e.preventDefault(); this.search.toggle(); return; }
    if (mod && !e.altKey && e.shiftKey && key === "s") { e.preventDefault(); this.snip.toggle(); return; }
    if (K.isTextField(t)) return;                                               // typing: Space, letters, Ctrl+Z (text undo) ... are the browser's
    if (K.isFocusedControl(t) && (key === " " || key === "Enter")) return;      // a keyboard-focused button: Enter / Space activate it
    if (document.querySelector(".popup") && key !== "Escape") return;           // an open menu: no shortcuts behind it
    if (key === "Escape") { if (this.snip.active) { this.snip.cancel(); return; } if (this.links.picking) { this.links.cancel(); return; } closePopup(); p?.deselect(); return; }
    if (e.altKey && !mod && /^[1-9]$/.test(key)) { e.preventDefault(); this.focusPanel(+key - 1); return; }
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); p?.goto(p.shown() - 1); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); p?.goto(p.shown() + 1); return; }
    if (mod && !e.altKey && !e.shiftKey && key === "a") { if (p?.selectAll()) e.preventDefault(); return; }          // select every item of the page
    if (mod && !e.altKey && !e.shiftKey && key === "d") { if (p?.duplicateSelection()) e.preventDefault(); return; }     // duplicate the selection (also stops the browser's "bookmark" shortcut)
    if (mod && !e.altKey) {                                                     // undo / redo use the panel's own history (and ignore a stroke in progress)
      if (key === "z") { e.preventDefault(); if (e.shiftKey) p?.redo(); else p?.undo(); return; }
      if (key === "y" && !e.shiftKey) { e.preventDefault(); p?.redo(); return; }
      if (p?.handleKey(e, key)) e.preventDefault();
      return;
    }
    if (key === " " && !e.altKey) {                                             // hold Space: Hand tool until the key is released
      e.preventDefault();
      if (!e.repeat && p && !p.root.hidden && p.beginTempTool("pan")) this.tempHeld = p;
      return;
    }
    if (key === "?") { e.preventDefault(); this.shortcuts(); return; }
    if (p?.boardKey?.(e)) { e.preventDefault(); return; }                       // board: Tab = child node, Enter = sibling, F2 = edit
    if (e.key === "Delete" || e.key === "Backspace") { if (p?.deleteSelected()) e.preventDefault(); return; }
    if (p?.handleKey(e, key)) e.preventDefault();
  }
  shortcuts() {
    const rows = (list) => list.map(([label, keys]) => el("div", { class: "krow" }, el("span", {}, label),
      el("span", { class: "keys" }, ...keys.split("  /  ").flatMap((k, i) => (i ? [" / ", el("kbd", {}, k)] : [el("kbd", {}, k)])))));
    return dialog({ title: "Keyboard shortcuts", content: el("div", { class: "kbdlist" },
      ...K.SHORTCUT_GROUPS.map(([title, list]) => el("div", { class: "kgroup" }, el("h3", {}, title), ...rows(list))),
      el("p", { class: "muted" }, "Shortcuts are switched off while you type in a text box, a field or a dialog, so letters and Space are always typed normally.")) });
  }
  async help() {
    const r = await dialog({ title: "NoteFlow - quick help", buttons: [{ label: "Keyboard shortcuts", value: "keys" }, { label: "Close", value: true, primary: true }], content: el("div", { class: "help" },
      el("p", {}, el("b", {}, "Touch: "), "one finger draws with the chosen tool; two fingers scroll and pinch-zoom. With the Select or Hand tool, drag to scroll. While a pen/stylus is in use, finger touches are ignored (palm rejection)."),
      el("p", {}, el("b", {}, "Board: "), "a big canvas for sketches and mind maps (mind maps also work on PDF and notebook pages: use the Mind map button). Switch between a white board and a blackboard with the sun / moon button (your ink adapts, nothing is changed). Mind map: use the Node tool to add nodes, drag from a node with the Link tool to connect, Tab adds a child, Enter a sibling, double-tap a node or connector to edit its text."),
      el("p", {}, el("b", {}, "Layout: "), "the Layout menu chooses which panels the workspace has (up to three: PDF, Notebook, Board). Use “Customize panels…” for any order or a second PDF / Notebook / Board."),
      el("p", {}, el("b", {}, "PDF pages: "), "pages are laid out one after another - just scroll (mouse wheel, two fingers, or the Hand tool). The page box jumps to a page number; the arrows move one page."),
      el("p", {}, el("b", {}, "Edit: "), "Select an item to move it or drag the round handles to resize it. Double-tap text and notes to edit. Delete key or the Eraser removes items."),
      el("p", {}, el("b", {}, "Eraser: "), "drag over a pen or marker stroke to erase only the part you touch (size: Brush button; the outline shows the area). Shapes, text and mind-map items are removed whole. Undo brings the erased part back."),
      el("p", {}, el("b", {}, "Touch: "), "press and hold a toolbar button for a moment to read what it does (a short tap works as usual)."),
      el("p", {}, el("b", {}, "Keyboard: "), "V select, H hand (or hold Space), P pen, E eraser, T text ..., Ctrl+Z / Ctrl+Shift+Z undo / redo. Press ? for the full list."),
      el("p", {}, el("b", {}, "Pictures: "), "Press Ctrl+V (or the Paste button) to paste a screenshot, or use the Image button / drag a picture onto a page."),
      el("p", {}, el("b", {}, "Saving: "), "Your work is saved on this device automatically (Settings: Auto-Save Workspace) and is back when you reopen NoteFlow; Ctrl+S saves right now. The Saved / Unsaved mark next to Save tells you where you are. Export makes a file on your computer with the PDF, all annotations, notebooks and boards in ONE workspace file, to keep or move it."),
      el("p", { class: "muted" }, "Annotated PDFs show your drawings as images on the page and embed the original + editable data, so they reopen editable here and in the Windows app.")) });
    if (r === "keys") this.shortcuts();
  }

  // ----------------------------------------------------------- workspace
  onChange(panel, info = {}) {
    if (info.clean) panel.ui();
    this.links.touch(); this.links.sweep(); this.search.contentChanged(); this.sources?.refresh();          // (sweep: links whose item was deleted are deleted with it)
    this.scheduleAutosave();
  }
  /** The Link button (top bar): linking starts from what is selected in the active panel; when that panel has nothing selected but exactly one other visible panel has, from that one. */
  startLink() {
    const has = (p) => p && p.tool === "select" && p.selected !== null && p.pages[p.cur] && p.pages[p.cur].items[p.selected];
    let src = this.active && this.panels[this.active.key] ? this.active : null;
    if (!has(src)) { const sel = this.order.map((k) => this.panels[k]).filter(has); if (sel.length === 1) src = sel[0]; }
    this.links.start(src || this.panels[this.order[0]]);
  }
  /** A document was opened / closed (a PDF): links and search look at it again. */
  docsChanged() { this.links.touch(); this.links.sweep(); this.links.renderAll(); this.search.contentChanged(); if (this.search.open) this.search.watchPdfs(); }
  /** Make sure the panel can be seen (a link or a search result lives there): it is added to the layout when the layout does not have it, and on a narrow screen its tab is opened. */
  async revealPanel(key, from = null) {
    if (!this.order.includes(key)) {
      const order = [...this.order];
      if (order.length < M.MAX_PANELS) order.push(key);
      else { let i = order.length - 1; if (from && order[i] === from.key) i--; order[Math.max(0, i)] = key; }
      await this.setLayout(order, false);
      await new Promise((r) => requestAnimationFrame(r));                    // (the panel gets its size)
    }
    if (this.narrow) { const i = this.order.indexOf(key); if (i >= 0 && this.tab !== i) this.setTab(i); }
  }
  isPristine(p) { return !p.dirty && !p.name && p.pages.length === 1 && !p.items.length; }
  settings() {
    const P = this.panels;
    return { window: { layout: [...this.order], view: this.viewMode, tab: this.tab, type: M.workspaceTypeOf(this.order) || "custom" }, board: P.board.viewState(), board2: P.board2.viewState(), pdf: P.pdf.viewState(), pdf2: P.pdf2.viewState(), notebook: P.nb.viewState(), notebook2: P.nb2.viewState(), smartLinking: this.smart.mode, bookmarks: this.bookmarks.toJSON() };
  }
  nbPages(p) { p.finishEdit(); return p.pages.map((q) => M.pageToJson(q)); }
  /** What belongs to the workspace. Default: only the panels of the current structure (a PDF-only workspace has no notebook, and vice versa).
   *  all: true (session backup) also includes panels that were taken out of the structure, so nothing is lost if the tab is reloaded. */
  collect({ all = false, lite = false } = {}) {
    const P = this.panels, inc = (k) => all || this.order.includes(k);
    return { pdf: inc("pdf") ? P.pdf.workspaceData() : null, pdf2: inc("pdf2") ? P.pdf2.workspaceData() : null,
      notebook: inc("nb") && !lite ? this.nbPages(P.nb) : null,
      notebook2: !lite && (this.order.includes("nb2") || (all && !this.isPristine(P.nb2))) ? this.nbPages(P.nb2) : null,
      board: inc("board") ? P.board.boardData() : null,
      board2: this.order.includes("board2") || (all && !this.isPristine(P.board2)) ? P.board2.boardData() : null,
      settings: this.settings(), type: M.workspaceTypeOf(this.order) || "custom", links: this.links.store.toJSON() };
  }
  /** EXPORT: a portable copy of the whole workspace as a file on the computer (a separate act from the automatic backup: the backup lives in this browser and is what reopening restores;
   *  the file is for moving the work elsewhere or keeping an archive). Chromium browsers ask where to put it; elsewhere it is downloaded. */
  async exportWorkspace() {
    if (this.exporting) return false;
    this.exporting = true;
    const busy = this.busy("Exporting workspace…");
    try {
      const blob = await WS.writeWorkspace(this.collect());
      const native = globalThis.Capacitor && globalThis.Capacitor.isNativePlatform && globalThis.Capacitor.isNativePlatform();
      const name = SF.suggestName(this.wsName);
      if (SF.canSaveInPlace() && !native) {
        const h = await SF.pickSaveHandle(name);
        if (!h) return false;                                                               // cancelled: nothing changed
        await SF.writeToHandle(h, blob); this.wsName = h.name; toast(`Exported to “${h.name}”`);
      } else { await this.saveBlob(blob, name); this.wsName = name; }
      for (const [k, p] of Object.entries(this.panels)) { if (this.order.includes(k)) p.dirty = false; p.ui(); }       // (panels outside the workspace were not exported)
      return true;
    } catch (e) {
      console.error(e); DX.record("export", e);
      toast("Could not export the workspace: " + (e.message || e) + " Your work is still backed up on this device.", 6000);
      return false;
    } finally { this.exporting = false; busy.done(); }
  }
  /** Colour theme (system / light / dark) and reduced motion, from the preferences. */
  applyAppearance() {
    const dark = prefs.get("theme") === "dark" || (prefs.get("theme") === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const root = document.documentElement; root.dataset.theme = dark ? "dark" : "light"; root.dataset.motion = prefs.get("motion") === "reduce" ? "reduce" : "";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0d1014" : "#1f2937");
    for (const p of Object.values(this.panels)) { p.desk = null; p.caretColor = null; p.render(); }
  }
  /** Auto-Save was switched on (a backup of whatever is unsaved follows at once) or off (nothing is saved by itself any more; Ctrl+S still saves). */
  onAutoSaveChanged() {
    clearTimeout(this.autosaveTimer); this.autosaveTimer = 0; this.firstChangeAt = 0;
    if (prefs.get("autoSave") && this.changeSeq !== this.savedSeq && !this.autosavePaused) this.autosaveTimer = setTimeout(() => this.autosave(), 200);
    this.refreshSaveStatus();
  }
  openSettings() { return openSettings(this); }
  async clearBackup() {
    const keys = await idb.keys?.() || [];
    for (const k of keys) if (k === "session" || k === "session-prev" || /^(pg|pdf|ptxt):/.test(String(k))) await idb.del(k);
    this.savedSeq = this.changeSeq - 1; this.refreshSaveStatus();
    this._written.clear(); this._partIds = new WeakMap();
  }
  applyMemoryMode() {
    setMemorySaver(prefs.get("memorySaver"));
    for (const p of Object.values(this.panels)) { p.onResize(); p.render(); p.scheduleRaster?.(); }
  }
  /** The save indicator describes the BACKUP on this device (not files): Saved = the latest state is backed up; Unsaved = changes not backed up yet; Backup failed. */
  saveStatus() {
    const unsaved = this.changeSeq !== this.savedSeq, at = this.savedAt ? new Date(this.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    if (this.backing) return { state: "saving", label: "Saving…", tip: "Saving a backup on this device…" };
    if (this.autosavePaused) return { state: "error", label: "Backup paused", tip: "The previous backup could not be read and is being kept, so nothing new is backed up until you decide (reload the page to choose)." };
    if (!this.autosaveOk) return { state: "error", label: "Backup failed", tip: `The backup on this device failed: ${this.autosaveError || "the browser refused to store it"}. Click to try again. Export the workspace to keep a copy.` };
    if (unsaved) return { state: "dirty", label: "Unsaved", tip: prefs.get("autoSave") ? "Changes are being saved to this device. (Ctrl+S saves right now.)" : "Auto-Save is off: press Ctrl+S to save these changes on this device." };
    return { state: "saved", label: "Saved", tip: `Everything is backed up on this device${at ? " (" + at + ")" : ""}. It comes back when you reopen NoteFlow. Use Export for a file.` };
  }
  refreshSaveStatus() {
    const st = this.saveStatus(), b = this.saveStat; if (!b) return;
    b.hidden = false; b.dataset.state = st.state; b.textContent = st.label; b.title = st.tip; b.setAttribute("aria-label", "Save status: " + st.label + ". " + st.tip);
  }
  onSaveStatusClick() { this.saveNow(); }
  onUnexpectedError(entry) {
    const safe = this.autosaveOk && !this.autosavePaused;
    toast(safe ? "Something went wrong. Your work is backed up on this device; if it keeps happening, save the workspace and reload." : "Something went wrong, and your work is NOT backed up. Save the workspace to a file now.", 7000);
    try { this.flushAutosave(); } catch { /* ignore */ }
  }
  async confirmDiscard() {
    if (!this.anyDirty()) return true;
    const c = await dialog({ title: "Replace the current workspace?", content: "The current workspace is backed up on this device, but this replaces that backup. If you want to keep it, export it as a file first.",
      buttons: [{ label: "Cancel", value: "cancel" }, { label: "Replace it", value: "dont", danger: true }, { label: "Export first", value: "save", primary: true }] });
    if (!c || c === "cancel") return false;
    if (c === "save" && !(await this.exportWorkspace())) return false;
    return true;
  }
  async newWorkspace() {
    if (!(await this.confirmDiscard())) return;
    await this.restore({ pdf: null, pdf2: null, notebook: [{ paper: "lined", items: [] }], notebook2: null, settings: {} });
    this.wsName = null; this.autosavePaused = false; this.refreshSaveStatus();
    try { await idb.batch([], ["session", "session-prev"]); } catch { /* ignore */ }
  }
  async onWorkspaceFile() { const f = this.wsOpenInput.files[0]; this.wsOpenInput.value = ""; if (f) await this.openWorkspaceFile(f); }
  async openWorkspaceFile(file) {
    if (!(await this.confirmDiscard())) return false;
    const busy = this.busy("Opening workspace…");
    try {
      const ws = await WS.readWorkspace(await file.arrayBuffer());
      await this.restore(ws);
      this.wsName = file.name;
      // a workspace of the current kind is saved back into the same file; an older (.dnws) one is never overwritten by a file in the new format (the first save asks for a name)
      this.refreshSaveStatus();
      toast("Workspace opened.");
      return true;
    } catch (e) { toast(e.message || "Could not open this workspace.", 5000); return false; }
    finally { busy.done(); }
  }
  /** Rebuild all panels from workspace data (validated by readWorkspace). While it runs, links are left alone (the panels are filled one by one); afterwards links
   *  whose ends are not in the workspace are deleted (a file saved by an older version may hold some). If it fails half way, nothing is deleted. */
  async restore(ws) {
    this.restoring = true; let ok = false;
    try { await this.applyWorkspace(ws); ok = true; } finally { this.restoring = false; }
    if (ok) this.links.sweep();
  }
  async applyWorkspace(ws) {
    const P = this.panels, st = ws.settings || {}, win = st.window && typeof st.window === "object" ? st.window : {};
    this.links.cancel(); this.links.store.load(ws.links || null);                  // (a workspace without links has none: links never leak from the one that was open before)
    const pdfs = [["pdf", ws.pdf, st.pdf], ["pdf2", ws.pdf2, st.pdf2]];
    for (const [key, data, view] of pdfs) {
      const p = P[key];
      if (!data) { p.clearPdf(); continue; }
      if (!(await p.openPdfBytes(data.source, data.name, { workspace: data }))) throw new Error("The PDF in this workspace could not be opened.");
      await p.goto(Number.isInteger(view?.page) ? view.page : 0);
    }
    P.nb.setNotebook(ws.notebook || [{ paper: "lined", items: [] }], null);
    P.nb2.setNotebook(ws.notebook2 || [{ paper: "lined", items: [] }], null);
    for (const [key, view] of [["nb", st.notebook], ["nb2", st.notebook2]]) { if (Number.isInteger(view?.page)) await P[key].goto(view.page); }
    const blankBoard = { paper: "white", grid: false, items: [] };
    P.board.setBoard(ws.board || blankBoard, null); P.board2.setBoard(ws.board2 || blankBoard, null);
    for (const [key, view] of [["pdf", st.pdf], ["pdf2", st.pdf2], ["nb", st.notebook], ["nb2", st.notebook2], ["board", st.board], ["board2", st.board2]]) P[key].restoreView(view);
    // workspace type from the file's metadata; older files have none: their saved layout is used (PDF + Notebook when nothing is saved)
    let order = M.layoutOfType(ws.type ?? ws.manifest?.workspace_type) || M.sanitizeLayout(win.layout);
    if (order.includes("nb2") && !ws.notebook2) order = [...M.DEFAULT_LAYOUT];
    this.bookmarks.load(st.bookmarks);                                       // (workspaces from before bookmarks have none)
    this.smart.setMode(typeof st.smartLinking === "string" ? st.smartLinking : "off", { silent: true });          // (Smart linking is off unless the workspace says otherwise)
    this.order = order; this.viewMode = M.normalizeView(win.view ?? "both", order);
    this.tab = Number.isInteger(win.tab) ? Math.max(0, Math.min(order.length - 1, win.tab)) : (win.view === "right" ? 1 : 0);
    for (const p of Object.values(P)) p.dirty = false;
    this.refreshLayout();
    for (const p of Object.values(P)) p.ui();
    this.scheduleAutosave();
  }

  // ------------------------------------------------------------- autosave
  // ====================================================================== the backup on this device (what reopening restores)
  // One simple model: ANY change bumps changeSeq; a backup remembers the changeSeq it started with and, when it has been written AND read back, sets savedSeq to it. "Saved" is
  // changeSeq === savedSeq. With Auto-Save on (the default) a backup follows a change after a short quiet moment (and at the latest 8 s after the first unsaved change, however
  // long the user keeps working); with it off only Ctrl+S / the Save button back up. Writing is one atomic IndexedDB transaction, so a failure or an interrupted save leaves the
  // previous backup untouched, and the previous backup is kept as a fallback (session-prev) in case the newest one is ever damaged.
  scheduleAutosave() {
    this.changeSeq++;
    if (prefs.get("autoSave") && !this.autosavePaused) {
      const now = Date.now(); this.firstChangeAt = this.firstChangeAt || now;
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = setTimeout(() => this.autosave(), Math.max(0, Math.min(AUTOSAVE_QUIET_MS, this.firstChangeAt + AUTOSAVE_MAX_WAIT_MS - now)));
    }
    this.refreshSaveStatus();
  }
  /** Back up when the page is being hidden or closed (only if a backup was waiting). */
  flushAutosave() { if (this.autosaveTimer) { clearTimeout(this.autosaveTimer); this.autosaveTimer = 0; this.autosave(true); } }
  async backup({ force = false, manual = false } = {}) {
    clearTimeout(this.autosaveTimer); this.autosaveTimer = 0; this.firstChangeAt = 0;
    if (this.autosavePaused) return false;                                       // (an old backup that could not be read is kept, not overwritten, until the user decides)
    if (this.autosaveOk && this.savedAt && this.changeSeq === this.savedSeq && !this.backing) return true;          // nothing changed since the last verified backup: nothing to write
    if (this.backing) { this.backupAgain = true; return false; }
    // collecting the data closes an open text editor: never do that in the middle of typing, unless the user asked (Save) or the page is going away
    if (!force && !manual && Object.values(this.panels).some((p) => p.editing)) { this.autosaveTimer = setTimeout(() => this.autosave(), 1500); return false; }
    this.backing = true; const seq = this.changeSeq; this.refreshSaveStatus();
    try {
      await this.writeBackup();
      this.savedSeq = seq; this.savedAt = Date.now(); this.autosaveOk = true; this.autosaveError = null;
      if (!this._persistAsked) { this._persistAsked = true; try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch { /* not supported */ } }      // (asks the browser not to evict the backup)
      return true;
    } catch (e) {
      console.warn("backup failed", e); DX.record("backup", e); this._written.clear();
      const was = this.autosaveOk; this.autosaveOk = false;
      this.autosaveError = e && e.name === "QuotaExceededError" ? "this device is out of storage space" : (e && e.message) || "the browser refused to store it";
      if (was || manual) toast("Could not back up your work on this device (" + this.autosaveError + "). Export the workspace to keep a copy.", 7000);
      return false;
    } finally {
      this.backing = false;
      if (this.backupAgain) { this.backupAgain = false; if (prefs.get("autoSave")) this.autosaveTimer = setTimeout(() => this.autosave(), 150); }
      this.refreshSaveStatus();
    }
  }
  /** The write itself. Pages are stored one by one under their own ids (an unchanged page of a large notebook is never written again, a PDF is stored once per content hash); the
   *  record that ties them together is written in the SAME transaction, so it can never point at something that is missing. The write is read back and checked before it counts. */
  async writeBackup() {
    const d = this.collect({ all: true, lite: true }), rec = { version: 2, saved: Date.now(), settings: d.settings, board: d.board, board2: d.board2, links: d.links };
    const used = new Set(), fresh = [];
    const ref = (items) => { const id = this.partId(items); used.add(id); if (!this._written.has(id)) fresh.push([id, items]); return id; };
    const nb = (key) => { const p = this.panels[key]; p.finishEdit(); return p.pages.map((q) => ({ ...M.pageMeta(q), part: ref(q.items) })); };
    rec.notebook = nb("nb"); rec.notebook2 = !this.isPristine(this.panels.nb2) || this.order.includes("nb2") ? nb("nb2") : null;
    const have = new Set((await idb.keys()).map(String)), puts = [], keep = new Set(), need = [];       // (what exists is known from the KEYS: a big PDF is not read back to find out)
    for (const key of ["pdf", "pdf2"]) {
      const p = d[key];
      if (!p) { rec[key] = null; continue; }
      const panel = this.panels[key].pdf;
      panel.hash = panel.hash || await WS.sha256Hex(p.source);
      const k = "pdf:" + panel.hash; keep.add(k); keep.add("ptxt:" + panel.hash); need.push(k);
      if (!have.has(k)) puts.push([k, p.source]);
      rec[key] = { name: p.name, hash: panel.hash, parts: p.pages.map((items) => ref(items)) };
    }
    for (const [id, items] of fresh) puts.push([id, items]);
    const prev = await idb.get("session");
    const prevOk = prev && (prev.version === 1 || prev.version === 2);
    if (prevOk) puts.push(["session-prev", prev]);                              // (the last backup stays as the fallback)
    puts.push(["session", rec]);
    await idb.batch(puts);                                                      // ONE transaction: everything or nothing
    // read it back: the record must be the one just written and everything it points at must be there
    const back = await idb.get("session"), keys = new Set((await idb.keys()).map(String));
    if (!back || back.saved !== rec.saved || [...used, ...need].some((k) => !keys.has(k))) throw new Error("the backup could not be read back");
    for (const [id] of fresh) this._written.add(id);
    // tidy up: pages and PDFs that neither the backup nor its fallback use any more
    if (prevOk) { const pk = (r) => [...(r.notebook || []), ...(r.notebook2 || [])].map((x) => x.part).concat((r.pdf ? r.pdf.parts || [] : []), (r.pdf2 ? r.pdf2.parts || [] : [])); for (const id of pk(prev)) used.add(id); for (const r of [prev.pdf, prev.pdf2]) if (r && r.hash) { keep.add("pdf:" + r.hash); keep.add("ptxt:" + r.hash); } }
    const dels = [];
    for (const k of keys) { const x = String(k); if ((x.startsWith("pdf:") || x.startsWith("ptxt:")) && !keep.has(x)) dels.push(x); else if (x.startsWith("pg:") && !used.has(x)) { dels.push(x); this._written.delete(x); } }
    if (dels.length) await idb.batch([], dels);
  }
  autosave(force = false) { return this.backup({ force }); }
  /** Ctrl+S / the Save button: back up right now (works with Auto-Save off too). */
  async saveNow() {
    if (this.autosavePaused) { toast("The previous backup is still waiting for your decision (reload the page to choose).", 4200); return false; }
    const ok = await this.backup({ manual: true });
    if (ok) toast("Saved on this device", 1400);
    return ok;
  }
  flushAutosave() { if (this.autosaveTimer) { clearTimeout(this.autosaveTimer); this.autosave(true); } }
  /** Id under which the items of a page are kept in the backup. Items are never edited in place (an edit makes a new array), so an unchanged page keeps its id. */
  partId(items) {
    let id = this._partIds.get(items);
    if (!id) { id = "pg:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); this._partIds.set(items, id); }
    return id;
  }
  /** Read one stored backup ("session" or "session-prev") back into a workspace. Throws when anything it needs is missing or unreadable (never a half-restored workspace). */
  async loadBackup(key) {
    const rec = await idb.get(key);
    if (!rec || (rec.version !== 1 && rec.version !== 2)) return null;
    const ids = [];
    if (rec.version === 2) {                                         // pages are stored separately: put them back together
      const nb = async (pgs) => (pgs ? Promise.all(pgs.map(async (m) => { const items = await idb.get(m.part); if (!Array.isArray(items)) throw new Error("a page of the backup is missing"); ids.push([m.part, items]); return { ...m, items }; })) : null);
      rec.notebook = await nb(rec.notebook); rec.notebook2 = await nb(rec.notebook2);
      for (const k of ["pdf", "pdf2"]) if (rec[k]) { rec[k].pages = await Promise.all(rec[k].parts.map((id) => idb.get(id))); if (rec[k].pages.some((x) => !Array.isArray(x))) throw new Error("a PDF page of the backup is missing"); rec[k].pages.forEach((x, i) => ids.push([rec[k].parts[i], x])); }
    }
    const bd = (b) => (b ? M.parseBoard(M.boardToJson(b)) : null);       // sanitised copy
    const ws = { links: rec.links || null, settings: rec.settings || {}, board: bd(rec.board), board2: bd(rec.board2), notebook: M.parseNotebook(M.notebookToJson(rec.notebook)), notebook2: rec.notebook2 ? M.parseNotebook(M.notebookToJson(rec.notebook2)) : null };
    for (const k of ["pdf", "pdf2"]) {
      const r = rec[k]; if (!r) continue;
      const source = await idb.get("pdf:" + r.hash);
      if (!source) throw new Error("the PDF of the backup is missing");           // (never silently dropped: the next backup would then lose it for good)
      const pages = M.parsePdfAnnotations(M.pdfAnnotationsToJson(r.pages), r.pages.length);
      if (pages) ws[k] = { name: r.name, source, pages };
    }
    const empty = !ws.pdf && !ws.pdf2 && ws.notebook.every((p) => !p.items.length) && (!ws.notebook2 || ws.notebook2.every((p) => !p.items.length)) && !ws.board?.items.length && !ws.board2?.items.length;
    return empty ? null : { ws, rec };
  }
  async restoreAutosave() {
    let got = null, err = null, fromPrev = false;
    try { got = await this.loadBackup("session"); } catch (e) { err = e; console.warn("the latest backup could not be read", e); DX.record("restore", e); }
    if (!got && err) { try { got = await this.loadBackup("session-prev"); fromPrev = !!got; } catch (e2) { console.warn("the previous backup could not be read either", e2); DX.record("restore", e2); } }
    if (got) {
      try {
        await this.restore(got.ws);
        // what is on screen IS the backup now: its pages keep their stored ids, so the next backup does not write them again, and the state counts as saved
        for (const [key, pg] of [["nb", got.rec.notebook], ["nb2", got.rec.notebook2]]) if (pg) pg.forEach((m, i) => { const q = this.panels[key].pages[i]; if (q) { this._partIds.set(q.items, m.part); this._written.add(m.part); } });
        for (const key of ["pdf", "pdf2"]) { const r = got.rec[key]; if (r && this.panels[key].pages) r.parts.forEach((id, i) => { const q = this.panels[key].pages[i]; if (q) { this._partIds.set(q.items, id); this._written.add(id); } }); }
        clearTimeout(this.autosaveTimer); this.autosaveTimer = 0; this.firstChangeAt = 0; this.savedSeq = this.changeSeq; this.savedAt = got.rec.saved || Date.now();
        for (const p of Object.values(this.panels)) { p.dirty = p.pages.some((q) => q.items.length > 0); p.ui(); }          // (not exported to a file yet: "New" and "Open" still offer to export it)
        toast(fromPrev ? "The newest backup was damaged: your work was restored from the one before it." : "Your last session was restored.", fromPrev ? 5000 : 2600);
        this.refreshSaveStatus();
        return true;
      } catch (e) { err = e; console.warn("restoring failed", e); DX.record("restore", e); }
    }
    if (!err) return false;                                         // nothing stored: a fresh start
    // neither backup can be used: they are kept, NOT overwritten by the next automatic backup, until the user decides
    this.autosavePaused = true; this.refreshSaveStatus();
    const c = await dialog({ title: "Your last session could not be restored", content: "The backups of your last session on this device are damaged or incomplete (" + (err && err.message || "unknown error") + "). They have not been deleted. You can start with an empty workspace, or keep them untouched for now (automatic backup stays off until you start a new workspace).",
      buttons: [{ label: "Keep the backups, work without backup", value: "keep" }, { label: "Discard them and start fresh", value: "fresh", danger: true, primary: true }] });
    if (c === "fresh") { try { await idb.batch([], ["session", "session-prev"]); } catch { /* ignore */ } this.autosavePaused = false; this.refreshSaveStatus(); }
    return false;
  }
}

export async function start() {
  const app = new App(document.getElementById("app"));
  window.noteflow = app;
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
  const restored = await app.restoreAutosave();
  if (!restored && !app.autosavePaused) { app.savedSeq = app.changeSeq; clearTimeout(app.autosaveTimer); app.autosaveTimer = 0; app.firstChangeAt = 0; app.refreshSaveStatus(); }      // (an empty new workspace has nothing to lose: it starts as "Saved")
  return app;
}
