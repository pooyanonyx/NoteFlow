// The Sources panel: a docked side panel that follows the page the user is on.
//   on a PDF page          -> the notes that cite it (a whole page, a region or a passage), and the other pages that have notes
//   on a notebook / board  -> which sources the notes on the page cite, and which long notes cite none yet
// It only reads the link store and the open panels; it recomputes (at most every 150 ms) only while it is open.
import { el, icon, toast } from "./ui.js";
import { forPdfPage, forItems } from "./sourcesmodel.js";
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
    else { if (this.off) { this.off(); this.off = null; } if (this.offBm) { this.offBm(); this.offBm = null; } clearTimeout(this.timer); this.timer = 0; this.dropThumbs(); this.body.replaceChildren(); }
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
  row(main, sub, { ok = true, onGo, onRemove, quote = false, icn = "note" } = {}) {
    const go = el("button", { class: "srcgo" + (ok ? "" : " bad"), type: "button", onclick: onGo, title: ok ? "Go there" : "This link is broken" },
      icon(icn), el("span", { class: "srctxt" }, el("span", { class: "srcmain" }, main), sub ? el("span", { class: "srcsub" + (quote ? " quote" : "") }, sub) : null));
    return el("div", { class: "srcrow" }, go, onRemove ? el("button", { class: "btn small srcx", type: "button", title: "Remove this link", "aria-label": "Remove this link", onclick: onRemove }, icon("close")) : null);
  }
  render() {
    this.tabs.querySelectorAll(".srctab").forEach((b) => { const sel = b.dataset.tab === this.tab; b.classList.toggle("on", sel); b.setAttribute("aria-selected", String(sel)); });
    if (this.tab === "pages") { this.renderPages(); return; }
    if (this.tab === "outline") { this.renderOutline(); return; }
    this.dropThumbs();
    const app = this.app, p = app.active, L = app.links, store = L.store, b = this.body, kids = [];
    const section = (title, ...rows) => el("section", { class: "srcsec" }, el("h3", {}, title), ...rows);
    const actions = (...btns) => el("div", { class: "srcact" }, ...btns);
    const quoteBtn = el("button", { class: "btn small", type: "button", title: "Drag across text in the PDF: the passage goes into your notes as a quote, linked to where it came from", onclick: () => L.quote() }, "Quote a passage");
    const checkBtn = el("button", { class: "btn small", type: "button", title: "Look for matches between the pages you are looking at", onclick: () => app.smart.scan({ manual: true }) }, "Check this page");
    const rm = (link) => () => { store.remove(link.id); app.scheduleAutosave(); };
    if (!p || !p.hasPage) kids.push(el("p", { class: "srcempty" }, "Open a PDF or a notebook: the sources of the page you are on appear here."));
    else if (p.kind === "pdf") {
      const hash = p.pdf && p.pdf.hash, page = p.shown();
      kids.push(el("div", { class: "srcctx" }, `${p.name || "PDF"} · page ${page + 1}`));
      if (!hash) kids.push(el("p", { class: "srcempty" }, "This PDF has no identity here (an insecure page), so it cannot be linked."));
      else {
        const { rows, others } = forPdfPage(store, { doc: hash, page, pageCount: p.pages.length });
        kids.push(rows.length ? section(`Notes citing this page (${rows.length})`, ...rows.map((r) => {
          const d = L.describe(r.other), shape = r.shape;
          return this.row(clip(d.title, 90), shape === "text" ? `“${clip(r.quote, 120)}”` : shape === "region" ? "A region of this page" : "The whole page", { ok: d.ok, quote: shape === "text", icn: r.other.k === "pdf" ? "pdf" : "note", onGo: () => L.go(r.other, { link: r.link, from: p }), onRemove: rm(r.link) });
        })) : el("p", { class: "srcempty" }, "No notes cite this page yet. Select a note and press Link, or quote a passage."));
        if (others.length) kids.push(section("Other pages with notes", el("div", { class: "srcchips" }, ...others.map((o) => el("button", { class: "btn small", type: "button", title: `Go to page ${o.page + 1}`, onclick: () => p.goto(o.page) }, `p. ${o.page + 1} · ${o.count}`)))));
      }
      kids.push(actions(quoteBtn, checkBtn));
    } else {
      const page = p.kind === "board" ? 0 : p.cur, items = p.pages[page] ? p.pages[page].items : [];
      kids.push(el("div", { class: "srcctx" }, p.kind === "board" ? `${p.label || "Board"}` : `${p.label || "Notebook"} · page ${page + 1}`));
      const { cited, unsourced } = forItems(store, items, { textOf: (d) => d.text, previewOf: (d) => itemPreview(d) });
      if (cited.length) kids.push(section(`Sources used on this page (${cited.length})`, ...cited.map((c) => el("div", { class: "srcgroup" },
        el("button", { class: "srcitem", type: "button", title: "Show this note", onclick: () => this.showItem(p, page, c.index) }, clip(itemPreview(c.item), 70)),
        ...c.links.map(({ link, other }) => {
          const d = L.describe(other), shape = anchorShape(other), isQuote = other.k === "pdf" && shape === "text";
          const main = other.k === "pdf" ? `${other.name || "PDF"} · p. ${other.page + 1}${shape === "region" ? " · region" : ""}` : d.title;
          return this.row(clip(main, 90), isQuote ? `“${clip(other.quote.text, 120)}”` : (other.k === "pdf" ? "" : d.where || ""), { ok: d.ok, quote: isQuote, icn: other.k === "pdf" ? "pdf" : "note", onGo: () => L.go(other, { link, from: p }), onRemove: rm(link) });
        })))));
      if (unsourced.length) kids.push(section(`Notes without a source (${unsourced.length})`, ...unsourced.slice(0, 12).map((u) => this.row(clip(u.preview, 90), "Press Link to connect it to a PDF passage", { icn: "note", onGo: () => this.showItem(p, page, u.index) })),
        unsourced.length > 12 ? el("p", { class: "srcempty" }, `…and ${unsourced.length - 12} more`) : null));
      if (!cited.length && !unsourced.length) kids.push(el("p", { class: "srcempty" }, "Nothing to cite on this page yet. Write a note, then link it to the PDF passage it comes from."));
      kids.push(actions(quoteBtn, checkBtn));
    }
    kids.push(el("div", { class: "srcfoot" }, el("span", {}, `${store.size} link${store.size === 1 ? "" : "s"} in this workspace`), el("button", { class: "btn small", type: "button", onclick: () => L.manage() }, "All links…")));
    b.replaceChildren(...kids.filter(Boolean));
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
