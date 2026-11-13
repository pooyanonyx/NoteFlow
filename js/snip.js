// Built-in snipping tool: capture a rectangle of a PDF page, a Notebook page or the Board, preview it, then copy it or insert it into any panel.
//
// The capture is NOT a screenshot of the screen: the chosen rectangle is rendered again, straight from the data and with NoteFlow's own renderers
// (the PDF page raster + its annotations, the notebook page with its paper, the board region), at a resolution that does not depend on the current
// zoom, so it is sharp whatever the view looks like and nothing else on the screen (toolbars, other panels, selection handles) can be in it.
// Inserting uses the panel's existing image path (Panel.insertImageBlob): the image becomes an ordinary image item (PNG inside the workspace), selected
// so it can be moved and resized with the usual handles, with the aspect ratio of the area.
import * as M from "./model.js";
import * as R from "./render.js";
import * as PDF from "./pdfio.js";
import { el, icon, toast } from "./ui.js";

const MIN_SIDE = 6, TARGET_PX_PER_PT = 4, MAX_PIXELS = 16e6;
const free = (c) => { if (c) c.width = c.height = 1; };

export class SnipTool {
  constructor(app) {
    this.app = app; this.active = false; this.cap = null;
    this.card = el("div", { class: "linkguide snipcard", hidden: true, role: "region", "aria-label": "Snipping tool" });
    app.root.append(this.card);
  }
  // ------------------------------------------------------------ modes
  toggle() { this.active ? this.cancel() : this.start(); }
  start() {
    this.app.links.cancel(); this.app.smart.card.hidden = true;
    for (const p of Object.values(this.app.panels)) p.finishEdit();
    this.active = true; this.clearCap();
    for (const p of Object.values(this.app.panels)) { p.root.classList.add("snipping"); p.releaseToolCursor(); }     // (the capture owns the pointer: the selected tool's cursor, e.g. the eraser's outline, is dropped)
    this.say();
  }
  cancel() {
    if (!this.active) return;
    this.active = false; this.clearCap(); this.card.hidden = true;
    for (const p of Object.values(this.app.panels)) { p.root.classList.remove("snipping"); p.snipPrev = null; if (p.action && p.action.type === "snip") p.action = null; p.render(); }
    this.app.smart.draw();
  }
  clearCap() { if (this.cap) { free(this.cap.canvas); this.cap = null; } for (const p of Object.values(this.app.panels)) if (p.snipPrev) { p.snipPrev = null; p.render(); } }
  say() {
    this.card.hidden = false;
    this.card.replaceChildren(
      el("div", { class: "lghead" }, icon("snip"), el("b", {}, "Snipping tool"), el("span", { class: "lgstep" }, "Step 1 of 2"), el("button", { class: "btn small", type: "button", title: "Stop (Esc)", onclick: () => this.cancel() }, "Cancel")),
      el("div", { class: "lghint" }, "Drag a rectangle over what you want to capture, on any panel: a PDF page, a Notebook page or the Board. You can then copy it or insert it into another panel."));
  }

  // ------------------------------------------------------------ choosing the area (pointer events of a panel, called by Panel)
  down(panel, e, l) {
    if (!this.active) return false;
    if (!panel.hasPage) { toast("There is nothing to capture here yet."); return true; }
    this.clearCap(); this.say();
    panel.activateAt(l.y);
    panel.action = { type: "snip", p0: panel.clampP(panel.toPage(e)), page: panel.cur, l0: l, moved: false };
    return true;
  }
  rectOf(panel, a, e) {
    const p = panel.clampP(panel.toPage(e));
    return [Math.min(a.p0.x, p.x), Math.min(a.p0.y, p.y), Math.max(a.p0.x, p.x), Math.max(a.p0.y, p.y)];
  }
  move(panel, e, l) {
    const a = panel.action;
    if (!a || a.type !== "snip") return;
    if (!a.moved && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) < 4) return;
    a.moved = true; panel.snipPrev = { page: a.page, rect: this.rectOf(panel, a, e) }; panel.render();
  }
  async up(panel, e) {
    const a = panel.action; panel.action = null;
    if (!a || a.type !== "snip" || !a.moved) { panel.snipPrev = null; panel.render(); return; }
    const r = this.rectOf(panel, a, e);
    if (r[2] - r[0] < MIN_SIDE || r[3] - r[1] < MIN_SIDE) { panel.snipPrev = null; panel.render(); toast("Drag a larger area."); return; }
    panel.snipPrev = { page: a.page, rect: r }; panel.render();
    this.card.replaceChildren(el("div", { class: "lghint" }, "Capturing…")); this.card.hidden = false;
    try {
      const canvas = await this.render(panel, a.page, r);
      if (!this.active || !panel.snipPrev) { free(canvas); return; }
      this.cap = { panel, page: a.page, rect: r, canvas }; this.preview();
    } catch (err) { console.warn(err); toast("Could not capture this area."); this.say(); }
  }

  // ------------------------------------------------------------ rendering the area
  /** Render the rectangle r = [x0, y0, x1, y1] (page points) of page `page` of a panel to a new canvas. */
  async render(panel, page, r) {
    const w = r[2] - r[0], h = r[3] - r[1];
    let sc = Math.min(TARGET_PX_PER_PT, Math.max(2, panel.view.scale * (window.devicePixelRatio || 1) * 1.5));      // (at least 2 pixels per point, more when zoomed in)
    while (w * sc * h * sc > MAX_PIXELS && sc > 0.5) sc *= 0.9;
    const out = document.createElement("canvas"), W = Math.max(1, Math.round(w * sc)), H = Math.max(1, Math.round(h * sc));
    const pg = panel.pages[page];
    await R.preloadImages(pg.items);
    if (panel.kind === "board") {
      R.renderBoardRegion(out, pg.items, { x: r[0], y: r[1], w, h, paper: pg.paper, grid: !!pg.grid, theme: R.boardTheme(pg.paper), scale: sc });
      return out;
    }
    out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    if (panel.kind === "pdf") {
      const job = PDF.renderRaster(panel.pdf.doc, page, sc), ras = await job.promise;
      if (ras) { ctx.drawImage(ras, r[0] * sc, r[1] * sc, w * sc, h * sc, 0, 0, W, H); free(ras); }
      ctx.save(); ctx.scale(W / w, H / h); ctx.translate(-r[0], -r[1]); ctx.beginPath(); ctx.rect(r[0], r[1], w, h); ctx.clip();
      const nodes = M.hasConns(pg.items) ? R.mindIndex(pg.items) : null;                       // (mind-map connectors are drawn between their nodes)
      for (const d of pg.items) R.drawItem(ctx, d, { nodes });
      ctx.restore();
      return out;
    }
    const [pw, ph] = panel.sizeOf(page), full = document.createElement("canvas");            // notebook: the page with its paper, then the area cut out of it
    R.renderPage(full, pw, ph, pg.items, { paper: pg, scale: sc });
    ctx.drawImage(full, r[0] * sc, r[1] * sc, w * sc, h * sc, 0, 0, W, H);
    free(full);
    return out;
  }

  // ------------------------------------------------------------ preview and what to do with it
  targets() { return this.app.order.map((k) => this.app.panels[k]).filter(Boolean); }
  preview() {
    const c = this.cap, cv = c.canvas, where = `${c.panel.label}${c.panel.kind === "board" ? "" : ", page " + (c.page + 1)}`;
    const view = el("canvas", { class: "snipprev", width: cv.width, height: cv.height, "aria-label": "Preview of the captured area" });
    view.getContext("2d").drawImage(cv, 0, 0);
    this.card.replaceChildren(
      el("div", { class: "lghead" }, icon("snip"), el("b", {}, "Captured"), el("span", { class: "lgstep" }, `Step 2 of 2 · ${where} · ${cv.width} × ${cv.height} px`), el("button", { class: "btn small", type: "button", title: "Stop (Esc)", onclick: () => this.cancel() }, "Cancel")),
      el("div", { class: "snipview" }, view),
      el("div", { class: "snipact" },
        el("button", { class: "btn small", type: "button", onclick: () => this.copy() }, "Copy"),
        el("span", { class: "sniplbl" }, "Insert into:"),
        ...this.targets().map((p) => el("button", { class: "btn small primary", type: "button", disabled: !p.hasPage, title: p.hasPage ? `Put it on ${p.label}` : "Open a PDF first", onclick: () => this.insert(p) }, p.label + (p === c.panel ? " (same)" : ""))),
        el("button", { class: "btn small", type: "button", title: "Choose another area", onclick: () => { this.clearCap(); this.say(); } }, "Retake")));
  }
  async blob() { const c = this.cap; return new Promise((res) => c.canvas.toBlob(res, "image/png")); }
  async copy() {
    if (!this.cap) return;
    try {
      const b = await this.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
      toast("Copied. Paste it into NoteFlow (Ctrl+V) or into any other application.");
      this.cancel();
    } catch (e) { toast("The browser did not allow copying to the clipboard. Use “Insert into” instead."); }
  }
  async insert(target) {
    const c = this.cap;
    if (!c) return;
    const blob = await this.blob(), natural = [c.rect[2] - c.rect[0], c.rect[3] - c.rect[1]];
    await this.app.revealPanel(target.key, c.panel);
    const ok = await target.insertImageBlob(blob, { natural });
    if (!ok) return;
    this.app.setActive(target);
    this.cancel();
    toast(`Inserted into ${target.label}. Drag it to move, drag a corner to resize.`, 4200);
  }
}
