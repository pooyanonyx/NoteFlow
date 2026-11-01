// Global search: the panel (input, options, results), and going to a result. The index itself is search.js; the text of PDFs comes from pdftext.js.
import * as R from "./render.js";
import { runSearch, locate, findAll, KIND_LABEL } from "./search.js";
import { normalize, normalizeWithMap, originalRange } from "./textnorm.js";
import { pageTextData, rectsForRange } from "./pdftext.js";
import { el, icon, toast } from "./ui.js";

const ORDER = ["pdf", "pdf2", "nb", "nb2", "board", "board2"];
const SCOPES = [["all", "Everywhere", null], ["nb", "Notebooks", ["nb"]], ["pdf", "PDFs", ["pdf"]], ["board", "Boards", ["board"]]];

export class SearchUI {
  constructor(app) {
    this.app = app; this.open = false; this.query = ""; this.results = []; this.active = -1; this.token = 0; this.timer = 0; this.last = null; this.subs = new Map(); this.goToken = 0; this.runs = 0;
    this.input = el("input", { type: "search", class: "sinput", dir: "auto", placeholder: "Search notebooks, PDFs and boards…", "aria-label": "Search", autocomplete: "off", spellcheck: "false",
      oninput: () => this.schedule(120), onkeydown: (e) => this.onKey(e) });
    this.whole = el("input", { type: "checkbox", onchange: () => this.run() });
    this.scope = el("select", { "aria-label": "Where to search", onchange: () => this.run() }, SCOPES.map(([v, l]) => el("option", { value: v }, l)));
    this.status = el("div", { class: "sstatus", role: "status", "aria-live": "polite" });
    this.list = el("div", { class: "slist", role: "listbox", "aria-label": "Search results" });
    this.root = el("aside", { class: "searchpanel", hidden: true, "aria-label": "Search" },
      el("div", { class: "shead" }, icon("search"), this.input, el("button", { class: "btn small icon-only", type: "button", title: "Close search (Esc)", "aria-label": "Close search", onclick: () => this.close() }, icon("close"))),
      el("div", { class: "sopts" }, el("label", { class: "chk" }, this.whole, " Whole words"), this.scope), this.status, this.list);
    app.root.append(this.root);
  }
  toggle() { this.open ? this.close() : this.show(); }
  show() {
    this.open = true; this.root.hidden = false;
    for (const p of Object.values(this.app.panels)) p.finishEdit?.();
    this.watchPdfs();
    const sel = String(getSelection && getSelection().toString() || "").trim();
    if (sel && sel.length < 80 && !sel.includes("\n")) this.input.value = sel;
    this.input.focus(); this.input.select();
    this.run();
  }
  close() {
    if (!this.open) return;
    this.open = false; this.root.hidden = true; this.token++; clearTimeout(this.timer);
    for (const [, off] of this.subs) off(); this.subs.clear();
    for (const p of Object.values(this.app.panels)) p.clearMarks("search");
    const a = this.app.active; if (a && a.stage) a.stage.focus({ preventScroll: true });
  }
  /** Read the text of every open PDF in the background (once; it is remembered on this device) and search again as pages arrive. */
  watchPdfs() {
    for (const [key, p] of Object.entries(this.app.panels)) {
      const store = p.kind === "pdf" && p.pdf && p.pdf.text;
      const have = this.subs.get(key);
      if (!store) { if (have) { have(); this.subs.delete(key); } continue; }
      if (have && have.store === store) continue;
      if (have) have();
      let t = 0;
      const off = store.onChange(() => { clearTimeout(t); t = setTimeout(() => { if (this.open) this.run(); }, store.complete ? 0 : 500); });
      off.store = store; this.subs.set(key, off);
      store.start();
    }
  }
  providers() {
    const keys = [...new Set([...this.app.order, ...ORDER])], out = [];
    for (const key of keys) {
      const p = this.app.panels[key];
      if (!p) continue;
      const id = key, title = () => this.app.name(key) + (p.name ? ` · ${p.name}` : "");
      if (p.kind === "pdf") { if (p.pdf) out.push({ id, kind: "pdf", title, count: () => p.pages.length, items: (i) => p.pages[i] && p.pages[i].items, store: p.pdf.text }); }
      else out.push({ id, kind: p.kind, title, count: () => p.pages.length, items: (i) => p.pages[i] && p.pages[i].items });
    }
    return out;
  }
  schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); }
  /** The content changed (called by the app): the results are made again from the current content, so none can be out of date. */
  contentChanged() { if (this.open && this.input.value.trim()) this.schedule(400); }
  async run() {
    if (!this.open) return;
    const q = this.input.value, token = ++this.token;
    this.watchPdfs();
    if (!normalize(q)) { this.results = []; this.active = -1; this.last = null; this.draw(); this.runs++; return; }
    const scope = SCOPES.find(([v]) => v === this.scope.value), opts = { whole: this.whole.checked, scopes: scope && scope[2] ? new Set(scope[2]) : null };
    const r = await runSearch(this.providers(), q, opts, { cancelled: () => token !== this.token });
    if (token !== this.token || r.cancelled) return;
    const keepKey = this.results[this.active] && this.results[this.active].key;
    this.results = r.results; this.last = { q, opts, ...r }; this.runs++;
    this.active = Math.max(-1, this.results.findIndex((x) => x.key === keepKey));
    this.draw();
  }
  pdfProgress() {
    let done = 0, total = 0;
    for (const p of Object.values(this.app.panels)) if (p.kind === "pdf" && p.pdf && p.pdf.text) { done += p.pdf.text.done; total += p.pdf.text.n; }
    return total && done < total ? [done, total] : null;
  }
  draw() {
    const l = this.last, n = this.results.length;
    const prog = this.pdfProgress();
    this.status.textContent = !l ? (prog ? `Reading the PDF text… ${prog[0]} / ${prog[1]} pages` : "Type to search everywhere in this workspace.")
      : (n ? `${n}${l.truncated ? "+" : ""} result${n === 1 ? "" : "s"}` : "No results") + (prog ? ` · reading the PDF text… ${prog[0]} / ${prog[1]} pages` : "");
    this.list.replaceChildren();
    let doc = null, group = null;
    this.results.forEach((r, idx) => {
      if (r.doc !== doc) { doc = r.doc; group = el("div", { class: "sgroup", role: "group" }, el("div", { class: "sdoc" }, icon(r.docKind === "pdf" ? "pdf" : r.docKind === "board" ? "layout" : "notebook"), r.docTitle)); this.list.append(group); }
      const s = r.snippet;
      group.append(el("div", { class: "sitem" + (idx === this.active ? " on" : ""), role: "option", "aria-selected": String(idx === this.active), tabIndex: -1, dataset: { i: String(idx) },
        onclick: () => { this.active = idx; this.mark(); this.go(r); } },
        el("span", { class: "smeta" }, el("span", { class: "skind" }, KIND_LABEL[r.kind] || r.kind), r.docKind === "board" ? "" : el("span", { class: "spage" }, `p. ${r.page + 1}`)),
        el("span", { class: "ssnip", dir: "auto" }, s.before, el("mark", {}, s.match), s.after)));
    });
    if (l && !n && !prog) this.list.append(el("div", { class: "snone" }, "Nothing found. Partial words are matched; Persian and Arabic letter forms, digits and ZWNJ are treated alike."));
  }
  mark() { this.list.querySelectorAll(".sitem").forEach((e) => { const on = +e.dataset.i === this.active; e.classList.toggle("on", on); e.setAttribute("aria-selected", String(on)); if (on) e.scrollIntoView({ block: "nearest" }); }); }
  onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.results.length) return;
      e.preventDefault();
      this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length; this.mark(); this.go(this.results[this.active], true);
    } else if (e.key === "Enter") { e.preventDefault(); if (this.active < 0 && this.results.length) this.active = 0; if (this.results[this.active]) { this.mark(); this.go(this.results[this.active]); } }
  }

  // ------------------------------------------------------------ going to a result
  /** Show the result: the panel, the page, and the matching text highlighted. `soft` (arrow keys) keeps the typing focus in the search box. */
  async go(r, soft = false) {
    const app = this.app, p = app.panels[r.doc], q = this.input.value, whole = this.whole.checked, mine = ++this.goToken;
    if (!p) return;
    await app.revealPanel(r.doc, null);
    if (this.goToken !== mine) return;
    for (const o of Object.values(app.panels)) if (o !== p) o.clearMarks("search");
    p.clearMarks("search");
    let rects = [], page = r.page;
    if (r.kind === "pdf") {
      await p.goto(page);
      try {
        const data = await pageTextData(p.pdf.doc, page), nm = normalizeWithMap(data.text), nq = normalize(q), hits = findAll(nm.t, nq, whole, 200);
        const all = hits.map((h) => originalRange(nm, h, h + nq.length));
        rects = all.flatMap(([a, b]) => rectsForRange(data, a, b));                    // every match of the page, the chosen one is also flashed
        const one = all[r.occ] ? rectsForRange(data, all[r.occ][0], all[r.occ][1]) : [];
        if (this.goToken !== mine) return;
        if (rects.length) await p.showLocation(page, rects, { kind: "search" });
        if (one.length) await p.showLocation(page, one, { kind: "flash", ms: 1800 });
      } catch (e) { console.warn(e); }
      return this.after(soft, p);
    }
    let idx = p.pages[page] ? p.pages[page].items.indexOf(r.item) : -1;                // the item may have moved to another page since the search ran
    if (idx < 0) { for (let i = 0; i < p.pages.length && idx < 0; i++) { idx = p.pages[i].items.indexOf(r.item); if (idx >= 0) page = i; } }
    if (idx < 0) { toast("That text has changed. Searching again…"); this.run(); return; }
    if (p.kind !== "board") await p.goto(page);
    const d = p.pages[page].items[idx], loc = (d.t === "text" || d.t === "note" || d.t === "node") && typeof d.text === "string" ? locate(d.text, q, { whole }, r.occ) : null;
    if (d.t === "text" && loc) rects = R.selectionRects(d, loc[0], loc[1]).map((x) => [x.x0, x.top, x.x1, x.bottom]);
    if (!rects.length) { const b = p.boundsOf(d); rects = [[b[0], b[1], b[2], b[3]]]; }
    if (this.goToken !== mine) return;
    await p.showLocation(page, rects, { kind: "search" });
    this.after(soft, p);
  }
  after(soft, p) { this.app.setActive(p); if (soft) this.input.focus({ preventScroll: true }); }
}
