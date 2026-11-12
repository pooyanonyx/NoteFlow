// The side panel: Sources, Pages (thumbnails) and Outline (bookmarks).
// Sources answers ONE question: which PDF passages do my notes come from? Every link is shown as the same card (the PDF source and its passage, the note that cites it,
// three labelled buttons), and a scope you choose says which links to list: those of the PDF page you are reading, of the notebook page you are writing, or everything.
// The list never changes by itself when you click around: only the scope buttons and the pages change it.
// It only reads the link store and the open panels; it recomputes (at most every 150 ms) only while it is open.
import { el, icon, toast } from "./ui.js";
import { forPdfPage, cardsForPdfPage, cardsForItems, cardsForAll } from "./sourcesmodel.js";
import { itemPreview } from "./linkui.js";
import { anchorShape } from "./links.js";
import { outlineOf, flattenOutline, Thumbs } from "./pdfnav.js";

const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

export class SourcesPanel {
  constructor(app) {
    this.app = app; this.timer = 0; this.open = false; this.off = null; this.offBm = null; this.tab = "sources"; this.view = null; this.thumbs = null;
    this.body = el("div", { class: "srcbody" });
    this.tabs = el("div", { class: "srctabs", role: "tablist", "aria-label": "Side panel" }, ...[["sources", "Sources"], ["pages", "Pages"], ["outline", "Outline"]].map(([k, l]) =>
      el("button", { class: "srctab", type: "button", role: "tab", "data-tab": k, onclick: () => this.setTab(k) }, l)));
    this.el = el("aside", { class: "sources", hidden: true, "aria-label": "Sources, pages and outline", role: "complementary" },
      el("div", { class: "srchead" }, this.tabs, el("button", { class: "btn small", type: "button", title: "Close the side panel", "aria-label": "Close the side panel", onclick: () => this.setOpen(false) }, icon("close"))),
      this.body);
    app.main.appendChild(this.el);
  }
  toggle() { this.setOpen(!this.open); }
  setTab(k) { if (this.tab === k && this.open) return; this.tab = k; this.dropThumbs(); this.setOpen(true); }
  setOpen(on) {
    this.open = !!on; this.el.hidden = !on;
    if (this.app.sourcesBtn) this.app.sourcesBtn.classList.toggle("on", this.open);
    for (const b of this.tabs.children) { const sel = b.dataset.tab === this.tab; b.classList.toggle("on", sel); b.setAttribute("aria-selected", String(sel)); }
    if (on && !this.off) { this.off = this.app.links.store.onChange(() => this.refresh()); this.offBm = this.app.bookmarks.onChange(() => this.refresh()); }
    if (on) this.render();
    else { if (this.off) { this.off(); this.off = null; } if (this.offBm) { this.offBm(); this.offBm = null; } clearTimeout(this.timer); this.timer = 0; this.dropThumbs(); this.scope = null; this.body.replaceChildren(); }
    for (const p of Object.values(this.app.panels)) p.onResize();            // (the panels share the width with it)
  }
  dropThumbs() { if (this.thumbs) { this.thumbs.destroy(); this.thumbs = null; } this.view = null; }
  /** The PDF the Pages / Outline tabs are about: the active panel when it is a PDF, else the first PDF on screen. */
  pdfPanel() {
    const a = this.app.active; if (a && a.kind === "pdf" && a.pdf) return a;
    return this.app.order.map((k) => this.app.panels[k]).find((q) => q && q.kind === "pdf" && q.pdf && q.root && !q.root.hidden) || null;
  }
  /** Something the panel shows may have changed (page, selection, links, items). Cheap when closed. */
  refresh() {
    if (!this.open || this.timer) return;
    this.timer = setTimeout(() => { this.timer = 0; if (this.open) this.render(); }, 150);
  }
  /** The notebook / board the notes are in, and the PDF that is read: the active panel when it is of that kind, else the first one on screen. */
  notePanel() {
    const ok = (q) => q && (q.kind === "nb" || q.kind === "board") && q.hasPage && q.root && !q.root.hidden;
    const a = this.app.active; if (ok(a)) return a;
    return this.app.order.map((k) => this.app.panels[k]).find(ok) || null;
  }
  setScope(k) { this.scope = k; this.render(); }
  /** One link, as a card: where it comes from (PDF, page, the passage), the note that cites it, and what you can do. Nothing on a card is clickable except its buttons. */
  card(pair) {
    const L = this.app.links, { link, pdf, note, related } = pair, dn = note ? L.describe(note) : { title: "(missing)", where: "", ok: false };
    const dr = related ? L.describe(related) : null, dp = pdf ? L.describe(pdf) : null;
    const shape = pdf ? anchorShape(pdf) : null, broken = (dp && !dp.ok) || !dn.ok || (dr && !dr.ok), why = (dp && !dp.ok && dp.where) || (!dn.ok && dn.where) || (dr && !dr.ok && dr.where) || "";
    const btn = (label, title, fn, cls = "") => el("button", { class: "btn small " + cls, type: "button", title, onclick: fn }, label);
    const noteRow = (d, label) => el("div", { class: "cardnote" }, icon("note"), el("div", { class: "cardtxt" }, el("span", { class: "cardlabel" }, label), el("span", { class: "cardtext", dir: "auto" }, clip(d.title, 160)), d.where && d.ok ? el("span", { class: "cardwhere" }, d.where) : null));
    const kids = [];
    if (pdf) {
      kids.push(el("div", { class: "cardsrc" }, icon("pdf"), el("div", { class: "cardtxt" }, el("span", { class: "cardlabel" }, "PDF source"), el("b", {}, `${pdf.name || "PDF"} · page ${pdf.page + 1}`)),
        el("span", { class: "tag " + shape }, shape === "text" ? "Passage" : shape === "region" ? "Region" : "Whole page")));
      if (shape === "text") kids.push(el("blockquote", { class: "cardquote", dir: "auto" }, clip(pdf.quote.text, 260)));
    } else kids.push(el("div", { class: "cardsrc" }, icon("link"), el("div", { class: "cardtxt" }, el("span", { class: "cardlabel" }, "Linked notes")), el("span", { class: "tag" }, "Note ↔ note")));
    kids.push(noteRow(dn, pdf ? "Your note" : "Note"));
    if (dr) kids.push(noteRow(dr, "Related note"));
    if (broken) kids.push(el("div", { class: "cardbad", role: "alert" }, "This link is broken" + (why ? `: ${why}` : ".")));
    const from = this.app.active;
    kids.push(el("div", { class: "cardact" },
      ...(pdf ? [btn("Open in PDF", "Go to this place in the PDF", () => L.go(pdf, { link, from }), "primary")] : []),
      btn(pdf ? "Show note" : "Show note", "Go to the note", () => L.go(note, { link, from }), pdf ? "" : "primary"),
      ...(related ? [btn("Show related", "Go to the other note", () => L.go(related, { link, from }))] : []),
      btn("Unlink", "Remove this link (the note and the PDF are not changed)", () => { this.app.links.store.remove(link.id); this.app.scheduleAutosave(); }, "quiet")));
    return el("article", { class: "card" + (broken ? " broken" : ""), "aria-label": pdf ? `Link from ${pdf.name || "PDF"} page ${pdf.page + 1}` : "Link between notes" }, ...kids);
  }
  render() {
    this.tabs.querySelectorAll(".srctab").forEach((b) => { const sel = b.dataset.tab === this.tab; b.classList.toggle("on", sel); b.setAttribute("aria-selected", String(sel)); });
    if (this.tab === "pages") { this.renderPages(); return; }
    if (this.tab === "outline") { this.renderOutline(); return; }
    this.dropThumbs();
    const app = this.app, L = app.links, store = L.store, kids = [];
    const pdfP = this.pdfPanel(), noteP = this.notePanel();
    if (!this.scope) this.scope = app.active && app.active.kind === "pdf" ? "pdf" : app.active && (app.active.kind === "nb" || app.active.kind === "board") ? "notes" : pdfP ? "pdf" : "notes";
    const scopes = [["pdf", "PDF page", "The links of the PDF page you are reading"], ["notes", "Notebook page", "The links of the notes on the page you are writing"], ["all", "Everything", "All links of this workspace"]];
    kids.push(el("div", { class: "srcscope", role: "radiogroup", "aria-label": "Which links to show" }, ...scopes.map(([k, l, t]) => el("button", { class: "btn small" + (this.scope === k ? " on" : ""), type: "button", role: "radio", "aria-checked": String(this.scope === k), title: t, onclick: () => this.setScope(k) }, l))));
    const checkBtn = el("button", { class: "btn small", type: "button", title: "Look for notes and PDF passages that match, between the pages you are looking at", onclick: () => app.smart.scan({ manual: true }) }, "Find matches");
    const quoteBtn = el("button", { class: "btn small primary", type: "button", title: "Drag across text in the PDF: that text goes into your notes, linked to where it came from", onclick: () => L.quote() }, "Quote from PDF");
    const sugg = app.smart.suggestions.length;
    const empty = (t) => el("p", { class: "srcempty" }, t);
    const heading = (t, n) => el("h3", {}, n === undefined ? t : `${t} (${n})`);
    if (this.scope === "pdf") {
      const p = pdfP, hash = p && p.pdf && p.pdf.hash, page = p ? p.shown() : 0;
      kids.push(el("div", { class: "srcctx" }, p ? `${p.name || "PDF"} · page ${page + 1}` : "No PDF open"));
      if (!p) kids.push(empty("Open a PDF to see which notes cite its pages."));
      else if (!hash) kids.push(empty("This PDF cannot be linked here (the page is not secure)."));
      else {
        const cards = cardsForPdfPage(store, { doc: hash, page }), { others } = forPdfPage(store, { doc: hash, page, pageCount: p.pages.length });
        kids.push(cards.length ? el("section", { class: "srcsec" }, heading("Notes citing this page", cards.length), ...cards.map((c) => this.card(c))) : empty("No note cites this page yet. Quote from the PDF, or select a note and press Link."));
        if (others.length) kids.push(el("section", { class: "srcsec" }, heading("Other pages with links"), el("div", { class: "srcchips" }, ...others.map((o) => el("button", { class: "btn small", type: "button", title: `Go to page ${o.page + 1}`, onclick: () => p.goto(o.page) }, `p. ${o.page + 1} · ${o.count}`)))));
      }
    } else if (this.scope === "notes") {
      const p = noteP, page = p ? (p.kind === "board" ? 0 : p.cur) : 0, items = p && p.pages[page] ? p.pages[page].items : [];
      kids.push(el("div", { class: "srcctx" }, p ? (p.kind === "board" ? p.label || "Board" : `${p.label || "Notebook"} · page ${page + 1}`) : "No notebook open"));
      if (!p) kids.push(empty("Open a notebook or a board to see the sources of its notes."));
      else {
        const { cards, unsourced } = cardsForItems(store, items, { textOf: (d) => d.text, previewOf: (d) => itemPreview(d) });
        kids.push(cards.length ? el("section", { class: "srcsec" }, heading("Links on this page", cards.length), ...cards.map((c) => this.card(c))) : empty("Nothing on this page is linked yet."));
        if (unsourced.length) kids.push(el("section", { class: "srcsec" }, heading("Notes with no source", unsourced.length), el("p", { class: "srchint" }, "Longer notes that are not linked to a PDF passage."),
          ...unsourced.slice(0, 6).map((u) => el("div", { class: "srcplain" }, el("span", { class: "srcplaintxt", dir: "auto" }, clip(u.preview, 90)), el("button", { class: "btn small", type: "button", onclick: () => this.showItem(p, page, u.index) }, "Show"))),
          unsourced.length > 6 ? el("p", { class: "srchint" }, `and ${unsourced.length - 6} more`) : null));
      }
    } else {
      const all = cardsForAll(store), total = store.size;
      kids.push(el("div", { class: "srcctx" }, `${total} link${total === 1 ? "" : "s"} in this workspace`));
      if (!total) kids.push(empty("No links yet. Quote from a PDF, or select a note and press Link."));
      const cap = 60; let shown = 0;
      for (const g of all.groups) { if (shown >= cap) break; kids.push(el("section", { class: "srcsec" }, el("h3", {}, `${g.name || "PDF"} · page ${g.page + 1}`), ...g.cards.slice(0, cap - shown).map((c) => this.card(c)))); shown += g.cards.length; }
      if (all.notes.length && shown < cap) kids.push(el("section", { class: "srcsec" }, heading("Links between notes", all.notes.length), ...all.notes.slice(0, cap - shown).map((c) => this.card(c))));
      if (total > cap) kids.push(el("p", { class: "srchint" }, `Showing the first ${cap}. Choose a page scope to see the rest.`));
    }
    const top = el("div", { class: "srcact" }, quoteBtn, checkBtn);
    kids.splice(1, 0, top);
    if (sugg) kids.splice(2, 0, el("div", { class: "srcsugg", role: "status" }, el("span", {}, `${sugg} suggested link${sugg === 1 ? "" : "s"} waiting for your answer`), el("button", { class: "btn small", type: "button", onclick: () => app.smart.showCard() }, "Review")));
    this.body.replaceChildren(...kids.filter(Boolean));
  }
  // ------------------------------------------------------------ Pages: thumbnails (drawn when they scroll into view, built once per document)
  renderPages() {
    const p = this.pdfPanel(), app = this.app;
    if (!p) { this.dropThumbs(); this.body.replaceChildren(el("p", { class: "srcempty" }, "Open a PDF to see its pages here.")); return; }
    const doc = p.pdf.doc, hash = p.pdf.hash, here = p.shown();
    if (!this.view || this.view.doc !== doc) {
      this.dropThumbs(); this.thumbs = new Thumbs(doc);
      const grid = el("div", { class: "thgrid", role: "list" }), cells = [];
      for (let i = 0; i < p.pages.length; i++) {
        const cv = el("canvas", { class: "thcv", width: 0, height: 0, "aria-hidden": "true" }), badge = el("span", { class: "thbadge", hidden: true });
        const btn = el("button", { class: "thcell", type: "button", role: "listitem", title: `Go to page ${i + 1}`, "aria-label": `Page ${i + 1}`, onclick: () => p.goto(i) }, cv, el("span", { class: "thnum" }, String(i + 1)), badge);
        grid.append(btn); cells.push({ btn, badge }); this.thumbs.add(btn, cv, i);
      }
      const mark = el("button", { class: "btn small", type: "button", onclick: () => { if (hash) app.bookmarks.toggle(hash, p.shown(), `Page ${p.shown() + 1}`); } });
      this.view = { doc, grid, cells, mark, top: el("div", { class: "srcctx" }, `${p.name || "PDF"} · ${p.pages.length} pages`) };
    }
    const v = this.view; this.view.panel = p;
    const bm = new Set(hash ? app.bookmarks.list(hash).map((b) => b.page) : []), counts = new Map();
    if (hash) for (const l of app.links.store.all()) for (const e of [l.a, l.b]) if (e.k === "pdf" && e.doc === hash) counts.set(e.page, (counts.get(e.page) || 0) + 1);
    v.cells.forEach((c, i) => {
      c.btn.classList.toggle("here", i === here); if (i === here) c.btn.setAttribute("aria-current", "page"); else c.btn.removeAttribute("aria-current");
      const n = counts.get(i) || 0, star = bm.has(i);
      c.badge.hidden = !n && !star; c.badge.textContent = (star ? "★" : "") + (n ? ` ${n}` : ""); c.badge.title = [star ? "Bookmarked" : "", n ? `${n} link${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    });
    v.mark.textContent = bm.has(here) ? "Remove bookmark" : "Bookmark this page"; v.mark.disabled = !hash;
    if (this.body.firstChild !== v.top) this.body.replaceChildren(v.top, el("div", { class: "srcact" }, v.mark), v.grid);
    if (this.lastHere !== here) { this.lastHere = here; v.cells[here]?.btn.scrollIntoView({ block: "nearest" }); }
  }
  // ------------------------------------------------------------ Outline: the reader's bookmarks and the PDF's own table of contents
  async renderOutline() {
    this.dropThumbs();
    const p = this.pdfPanel(), app = this.app;
    if (!p) { this.body.replaceChildren(el("p", { class: "srcempty" }, "Open a PDF to see its bookmarks and outline here.")); return; }
    const hash = p.pdf.hash, here = p.shown(), token = (this.outTok = (this.outTok || 0) + 1);
    const bms = hash ? app.bookmarks.list(hash) : [];
    const bmRows = bms.map((b) => {
      const lbl = el("span", { class: "srcmain" }, b.label);
      return el("div", { class: "srcrow" }, el("button", { class: "srcgo", type: "button", onclick: () => p.goto(b.page) }, icon("bookmark"), el("span", { class: "srctxt" }, lbl, el("span", { class: "srcsub" }, `page ${b.page + 1}`))),
        el("button", { class: "btn small srcx", type: "button", title: "Rename this bookmark", "aria-label": "Rename this bookmark", onclick: () => this.rename(lbl, hash, b) }, "✎"),
        el("button", { class: "btn small srcx", type: "button", title: "Remove this bookmark", "aria-label": "Remove this bookmark", onclick: () => app.bookmarks.remove(hash, b.page) }, icon("close")));
    });
    const addBtn = el("button", { class: "btn small", type: "button", disabled: !hash || app.bookmarks.has(hash, here), onclick: () => app.bookmarks.add(hash, here, `Page ${here + 1}`) }, `Bookmark page ${here + 1}`);
    const kids = [el("div", { class: "srcctx" }, `${p.name || "PDF"}`), el("section", { class: "srcsec" }, el("h3", {}, `Bookmarks (${bms.length})`), ...(bmRows.length ? bmRows : [el("p", { class: "srcempty" }, "None yet. Bookmark the pages you come back to.")]), el("div", { class: "srcact" }, addBtn))];
    this.body.replaceChildren(...kids, el("p", { class: "srcempty" }, "Reading the outline…"));
    const tree = await outlineOf(p.pdf.doc); if (token !== this.outTok || this.tab !== "outline" || !this.open) return;
    const flat = flattenOutline(tree);
    const sec = flat.length ? el("section", { class: "srcsec" }, el("h3", {}, "Outline"), ...flat.map((n) => el("button", { class: "srcgo outl", type: "button", style: { paddingInlineStart: 6 + n.depth * 14 + "px" }, disabled: n.page === null, title: n.page === null ? "This entry does not point to a page" : `Go to page ${n.page + 1}`, onclick: () => p.goto(n.page) },
      el("span", { class: "srctxt" }, el("span", { class: "srcmain" }, n.title)), n.page !== null ? el("span", { class: "srcpg" }, String(n.page + 1)) : null)))
      : el("p", { class: "srcempty" }, "This PDF has no outline of its own. Use bookmarks, or the Pages tab.");
    this.body.replaceChildren(...kids, sec);
  }
  rename(span, doc, b) {
    const inp = el("input", { type: "text", class: "srcedit", value: b.label, maxlength: 120, "aria-label": "Bookmark name" });
    const done = (save) => { if (save) this.app.bookmarks.rename(doc, b.page, inp.value); else this.render(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); e.stopPropagation(); });
    inp.addEventListener("blur", () => done(true));
    span.replaceWith(inp); inp.focus(); inp.select();
  }
  async showItem(p, page, index) {
    this.app.setActive(p);
    if (p.kind !== "board") await p.goto(page);
    const d = p.pages[page].items[index]; if (!d) return;
    p.setSelection([index]);
    const bb = p.boundsOf(d); await p.showLocation(page, [[bb[0] - 4, bb[1] - 4, bb[2] + 4, bb[3] + 4]], { kind: "flash", ms: 2000 });
  }
}
