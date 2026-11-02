// Smart linking: suggests (or, when the user allows it, makes) links between what is on the surfaces the user is looking at right now.
//
// WHAT IS COMPARED: only the ACTIVE surfaces: the current page of every visible panel. PDF page 20 is compared with Notebook page 100 and nothing else: not
// the other pages of the PDF, not the other pages of the notebook, not the rest of the board (of a board only what is on screen). This is what keeps it
// fast, makes suggestions relevant (the user is working on exactly these two things), and keeps it predictable.
// HOW: similar.js (conventional text similarity, local). The link made is an ordinary link of the existing Link system (links.js), tagged src "suggested"
// (the user confirmed it) or "auto" (made on its own, only when the user chose that), so it is shown differently and can be listed and removed.
// STABILITY: nothing runs unless the mode is on; a scan starts only after the surfaces stayed the same for a moment, never while the user types or draws,
// never in several at once; the amount of text read is capped; it works in small slices; a slow scan makes the next ones wait longer.
import * as M from "./model.js";
import { pageTextData, rectsForRange } from "./pdftext.js";
import { passagesOf, noteUnits, findMatches } from "./similar.js";
import { normalize } from "./textnorm.js";
import { el, icon, toast } from "./ui.js";

export const MODES = [["off", "Off"], ["suggest", "Suggest links (I confirm)"], ["auto", "Suggest, and link on their own when very sure"]];
export const SUGGEST_AT = 0.55, AUTO_AT = 0.88, MAX_SUGGESTIONS = 5, SHOW_AT_ONCE = 3, MAX_AUTO_PER_SCAN = 3, POLL_MS = 1500;
const MAX_TEXT_UNITS = 120, MAX_ITEM_TEXT = 2000, MAX_PDF_TEXT = 40000;

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const clip = (s, n) => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const arrIds = new WeakMap(); let arrCount = 0;
const arrId = (a) => { let n = arrIds.get(a); if (!n) arrIds.set(a, (n = ++arrCount)); return n; };

export class SmartLink {
  constructor(app) {
    this.app = app; this.mode = "off"; this.suggestions = []; this.snoozed = new Set(); this.report = null;
    this.scanning = false; this.seenSig = null; this.scannedSig = null; this.coolUntil = 0; this.timer = 0;
    this.stats = { scans: 0, read: [], lastMs: 0 };                    // (what the last scan looked at: the tests check it is only the active pages)
    this.card = el("aside", { class: "smartcard", hidden: true, "aria-label": "Suggested links" });
    app.root.append(this.card);
  }
  get store() { return this.app.links.store; }

  // ------------------------------------------------------------ mode
  setMode(mode, { silent = false } = {}) {
    if (!MODES.some(([m]) => m === mode)) mode = "off";
    this.mode = mode; clearInterval(this.timer); this.timer = 0; this.scannedSig = this.seenSig = null;          // (turning it on looks at the pages that are on screen now)
    if (mode === "off") { this.suggestions = []; this.report = null; this.seenSig = this.scannedSig = null; this.draw(); }
    else { this.timer = setInterval(() => this.poll(), POLL_MS); if (!silent) toast(mode === "auto" ? "Smart linking is on: very close matches are linked automatically, the others are suggested." : "Smart linking is on: close matches are suggested, you confirm them."); }
    this.app.scheduleAutosave && this.app.scheduleAutosave();
  }

  // ------------------------------------------------------------ the active surfaces
  visibleKeys() {
    const a = this.app, keys = a.order.filter((k) => a.panels[k]);
    return a.narrow ? keys.slice(a.tab, a.tab + 1) : keys;
  }
  /** A cheap description of what the active surfaces are right now (no text is read): when it changes, the surfaces changed. */
  signature() {
    return this.visibleKeys().map((k) => {
      const p = this.app.panels[k], pg = p.pages[p.cur];
      if (p.kind === "pdf") return p.pdf ? `${k}|${p.pdf.hash}|${p.cur}` : `${k}|-`;
      if (p.kind === "board") { const v = p.view; return `${k}|${pg ? arrId(pg.items) : 0}|${Math.round(v.tx / 60)},${Math.round(v.ty / 60)},${v.scale.toFixed(2)}`; }
      return `${k}|${p.cur}|${pg ? arrId(pg.items) : 0}`;
    }).join(";");
  }
  busy() {
    if (this.app.links.picking || (this.app.snip && this.app.snip.active)) return true;
    return this.visibleKeys().some((k) => { const p = this.app.panels[k]; return p.editing || (p.action && p.action.type !== "none") || p.pointers.size > 0; });
  }
  /** Units of the text items of a page: [{ item, panel, page, text, s, e, toks }] (only typed text: text boxes, notes, mind-map nodes). */
  itemUnits(panel, page, items, visible = null) {
    const out = [];
    for (const d of items) {
      if (out.length >= MAX_TEXT_UNITS) break;
      if ((d.t !== "text" && d.t !== "note" && d.t !== "node") || typeof d.text !== "string" || !d.text.trim()) continue;
      if (visible) { const b = panel.boundsOf(d); if (b[2] < visible[0] || b[0] > visible[2] || b[3] < visible[1] || b[1] > visible[3]) continue; }
      const text = d.text.slice(0, MAX_ITEM_TEXT);
      for (const u of noteUnits(text)) out.push({ item: d, panel, page, text: text.slice(u.s, u.e), s: u.s, e: u.e, toks: u.toks });
    }
    return out;
  }
  async surfaces() {
    const out = [], read = [];
    for (const k of this.visibleKeys()) {
      const p = this.app.panels[k], pg = p.pages[p.cur];
      if (p.kind === "pdf") {
        if (!p.pdf) continue;
        const sf = { key: k, panel: p, kind: "pdf", page: p.cur, label: `${p.name || "PDF"} p. ${p.cur + 1}` };
        try { const data = await pageTextData(p.pdf.doc, p.cur); read.push([k, p.cur]); sf.data = data; sf.text = data.text.slice(0, MAX_PDF_TEXT); }
        catch { sf.issue = "its text could not be read"; }
        if (!sf.issue && sf.text.replace(/\s/g, "").length < 40) sf.issue = "has no selectable text (a scanned page or an image), so it cannot be analyzed";
        if (!sf.issue) sf.passages = passagesOf(sf.text);
        out.push(sf);
      } else {
        if (!pg) continue;
        read.push([k, p.cur]);
        let visible = null;
        if (p.kind === "board") { const a = p.screenToPage(0, 0), b = p.screenToPage(p.cw, p.ch); visible = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]; }
        const units = this.itemUnits(p, p.cur, pg.items, visible), nText = pg.items.filter((d) => d.t === "text" || d.t === "note" || d.t === "node").length;
        out.push({ key: k, panel: p, kind: p.kind, page: p.cur, label: `${p.label}${p.kind === "board" ? " (on screen)" : " p. " + (p.cur + 1)}`, units,
          issue: !units.length ? (nText ? "has no typed text long enough to compare (at least 4 meaningful words)" : "has no typed text (handwriting and images cannot be analyzed)") : null });
      }
    }
    this.stats.read = read;
    return out;
  }

  // ------------------------------------------------------------ scanning
  poll() {
    if (this.mode === "off" || this.scanning || document.hidden || performance.now() < this.coolUntil || this.busy()) return;
    const sig = this.signature();
    if (sig === this.scannedSig) return;
    if (sig !== this.seenSig) { this.seenSig = sig; return; }              // changed just now: wait until it stays the same
    this.scan({ manual: false });
  }
  /** Compare the active surfaces. manual: the user asked (works with the mode off, and says what it did when nothing was found). */
  async scan({ manual = false } = {}) {
    if (this.scanning) return;
    this.scanning = true;
    const t0 = performance.now(), sig = this.signature();
    try {
      const sf = await this.surfaces();
      const found = [], notes = [];
      for (const s of sf) if (s.issue) notes.push(`${s.label} ${s.issue}.`);
      const usable = sf.filter((s) => !s.issue);
      for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
        const X = usable[i], Y = usable[j];
        if (X.kind === "pdf" && Y.kind === "pdf") continue;                 // two PDFs have no notes to link
        const [A, B] = X.kind === "pdf" ? [Y, X] : [X, Y];                  // A: the notes, B: what they may be about (a PDF page's passages, or other items)
        const bUnits = B.kind === "pdf" ? B.passages : B.units;
        const res = await findMatches(A.units, bUnits, { floor: SUGGEST_AT });
        for (const r of res) { const sg = this.makeSuggestion(A, B, r); if (sg) found.push(sg); }
      }
      found.sort((a, b) => b.score - a.score);
      this.suggestions = found.slice(0, MAX_SUGGESTIONS);
      this.scannedSig = sig; this.seenSig = sig;
      this.report = { manual, surfaces: sf.map((s) => s.label), notes, none: !this.suggestions.length };
      if (this.mode === "auto") this.autoLink();
      this.draw();
    } catch (e) { console.warn("Smart linking:", e); this.scannedSig = sig; }
    finally {
      this.scanning = false; this.stats.scans++; this.stats.lastMs = performance.now() - t0;
      if (this.stats.lastMs > 400) this.coolUntil = performance.now() + 4000;       // a slow scan: wait longer before the next
    }
  }
  /** A suggestion unless it is already linked, was rejected, or was put off. */
  makeSuggestion(A, B, r) {
    const n = r.note, text = n.text, pass = r.passage;
    let target, targetKey, targetText;
    if (B.kind === "pdf") { target = { kind: "pdf", panel: B.panel, page: B.page, s: pass.s, e: pass.e }; targetKey = `pdf:${B.panel.pdf.hash.slice(0, 12)}:${B.page}:${pass.s}`; targetText = B.text.slice(pass.s, pass.e); }
    else { target = { kind: "item", panel: B.panel, page: B.page, item: pass.item }; targetKey = `item:${hash(normalize(pass.text).slice(0, 80))}`; targetText = pass.text; }
    const key = `${hash(normalize(text).slice(0, 120))}|${targetKey}`;
    if (this.store.isRejected(key) || this.snoozed.has(key)) return null;
    const id = n.item.id;                                                    // already linked to that place? (the item may not have an id yet = never linked)
    if (id) for (const l of this.store.forItem(id)) {
      const o = this.store.otherEnd(l, { k: "item", id });
      if (target.kind === "pdf" && o.k === "pdf" && o.doc === B.panel.pdf.hash && o.page === B.page) return null;
      if (target.kind === "item" && o.k === "item" && pass.item.id && o.id === pass.item.id) return null;
    }
    return { key, score: r.score, shared: r.shared, from: { panel: A.panel, page: A.page, item: n.item, text }, to: target, toText: targetText, noteText: text, shown: false };
  }

  // ------------------------------------------------------------ making links
  /** Make the link of a suggestion. -> true when made */
  accept(sg, { auto = false } = {}) {
    const LK = this.app.links, pa = sg.from.panel, items = pa.pages[sg.from.page] && pa.pages[sg.from.page].items, idx = items ? items.indexOf(sg.from.item) : -1;
    if (idx < 0) { this.drop(sg); toast("That note has changed since it was suggested."); return false; }
    const a = LK.itemAnchor(pa, idx, sg.from.page);
    let b;
    if (sg.to.kind === "pdf") {
      b = { k: "pdf", doc: sg.to.panel.pdf.hash, name: sg.to.panel.name || "", page: sg.to.page, pv: clip(sg.toText, 80), quote: { text: clip(sg.toText, 400), rects: sg.rects || [] } };
    } else {
      const tp = sg.to.panel, ti = tp.pages[sg.to.page].items.indexOf(sg.to.item);
      if (ti < 0) { this.drop(sg); return false; }
      b = LK.itemAnchor(tp, ti, sg.to.page);
    }
    if (!a || !b) return false;
    const res = this.store.add(a, b, { src: auto ? "auto" : "suggested", score: sg.score });
    this.drop(sg);
    if (!res) return false;
    for (const p of [pa, sg.to.panel]) { p.dirty = true; p.ui(); }
    this.app.scheduleAutosave();
    return res.created;
  }
  async attachRects(sg) {                                                    // the boxes of a PDF passage (for drawing the quote on the page)
    if (sg.to.kind !== "pdf" || sg.rects) return;
    try { const data = await pageTextData(sg.to.panel.pdf.doc, sg.to.page); sg.rects = rectsForRange(data, sg.to.s, sg.to.e).slice(0, 40); } catch { sg.rects = []; }
  }
  async autoLink() {
    let n = 0;
    for (const sg of [...this.suggestions]) {
      if (n >= MAX_AUTO_PER_SCAN) break;
      if (sg.score < AUTO_AT) continue;
      await this.attachRects(sg);
      if (this.accept(sg, { auto: true })) { n++; toast(`Linked automatically (${Math.round(sg.score * 100)}% match): “${clip(sg.noteText, 40)}” ↔ ${sg.to.kind === "pdf" ? `${sg.to.panel.name || "PDF"} p. ${sg.to.page + 1}` : "another note"}. See Links to review.`, 5000); }
    }
    this.draw();
  }
  drop(sg) { this.suggestions = this.suggestions.filter((x) => x !== sg); this.draw(); }
  async confirm(sg) { await this.attachRects(sg); if (this.accept(sg)) toast("Linked. It is marked as a suggested link."); }
  reject(sg) { this.store.reject(sg.key); this.drop(sg); this.app.scheduleAutosave(); }
  /** "Not now" for everything shown: they are not offered again in this session. */
  later() { for (const sg of this.suggestions) this.snoozed.add(sg.key); this.suggestions = []; this.report = null; this.draw(); }
  async show(sg) {
    await this.attachRects(sg);
    const a = sg.from.panel, b = sg.to.panel;
    const nb = a.boundsOf(sg.from.item); await a.showLocation(sg.from.page, [[nb[0] - 4, nb[1] - 4, nb[2] + 4, nb[3] + 4]], { kind: "flash", ms: 2600 });
    if (sg.to.kind === "pdf") await b.showLocation(sg.to.page, sg.rects && sg.rects.length ? sg.rects : [[0, 0, 100, 40]], { kind: "flash", ms: 2600 });
    else { const tb = b.boundsOf(sg.to.item); await b.showLocation(sg.to.page, [[tb[0] - 4, tb[1] - 4, tb[2] + 4, tb[3] + 4]], { kind: "flash", ms: 2600 }); }
  }
  removeAutomatic() { const ids = this.store.all().filter((l) => l.src === "auto").map((l) => l.id); for (const id of ids) this.store.remove(id); this.app.scheduleAutosave(); return ids.length; }

  // ------------------------------------------------------------ the card
  draw() {
    const list = this.suggestions.slice(0, SHOW_AT_ONCE), rep = this.report;
    const show = this.mode !== "off" && list.length || (rep && rep.manual);
    this.card.hidden = !show; if (!show) return;
    const head = (t, closeFn) => el("div", { class: "schead" }, icon("chain"), el("b", {}, t), el("button", { class: "btn small", type: "button", title: "Not now", "aria-label": "Close", onclick: closeFn }, icon("close")));
    if (!list.length) {
      this.card.replaceChildren(head("Smart linking", () => { this.report = null; this.draw(); }),
        el("p", { class: "scmsg" }, "No strong match found between the pages you are looking at."),
        el("p", { class: "scsmall" }, "Compared: " + (rep.surfaces.join("  ↔  ") || "nothing (open two panels)") + "."),
        ...rep.notes.map((n) => el("p", { class: "scsmall warn" }, n)),
        el("p", { class: "scsmall" }, "Only typed text is compared, and only on these pages. Handwriting, images and PDF pages without selectable text cannot be analyzed."));
      return;
    }
    this.card.replaceChildren(head(`Suggested links (${this.suggestions.length})`, () => this.later()),
      ...list.map((sg) => el("div", { class: "sug" },
        el("div", { class: "sugtxt" }, el("div", { class: "sugrow" }, el("span", { class: "sugk" }, "Note"), el("span", { class: "sugv", dir: "auto" }, `“${clip(sg.noteText, 80)}”`)),
          el("div", { class: "sugrow" }, el("span", { class: "sugk" }, sg.to.kind === "pdf" ? `PDF p. ${sg.to.page + 1}` : "Note"), el("span", { class: "sugv", dir: "auto" }, `“${clip(sg.toText, 110)}”`))),
        el("div", { class: "sugact" }, el("span", { class: "sugpct", title: "How closely the wording matches: " + sg.shared.join(", ") }, Math.round(sg.score * 100) + "% match"),
          el("button", { class: "btn small primary", type: "button", onclick: () => this.confirm(sg) }, "Link"),
          el("button", { class: "btn small", type: "button", onclick: () => this.show(sg) }, "Show"),
          el("button", { class: "btn small", type: "button", title: "Do not suggest this again", onclick: () => this.reject(sg) }, "Not related")))),
      this.suggestions.length > list.length ? el("div", { class: "scsmall" }, `${this.suggestions.length - list.length} more after these.`) : null);
  }
}
