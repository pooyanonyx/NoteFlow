// Several items selected (a "group"), copy / cut / paste / duplicate, and the selection overlay: the methods of Panel that deal with more than one item.
// They are mixed into Panel.prototype (see the end of panel.js), so `this` is the panel; the pure parts (rectangles, copies, the copy buffer) live in selection.js.
import * as M from "./model.js";
import * as R from "./render.js";
import * as S from "./selection.js";
import * as K from "./keys.js";
import { el } from "./ui.js";

export const selectionMethods = {
  /** The selected group: a dashed box round every member and one round all of them. */
  drawGroupSelection(ctx, list, idxs) {
    const s = this.view.scale; ctx.save(); ctx.strokeStyle = "#1976d2"; ctx.lineWidth = 1.2 / s; ctx.setLineDash([4 / s, 3 / s]);
    const boxes = [];
    for (const i of idxs) { const b = list[i] && this.boundsOf(list[i]); if (!b) continue; boxes.push(b); ctx.strokeRect(b[0] - 2 / s, b[1] - 2 / s, b[2] - b[0] + 4 / s, b[3] - b[1] + 4 / s); }
    const u = S.unionBounds(boxes);
    if (u) { ctx.lineWidth = 1.8 / s; ctx.setLineDash([8 / s, 5 / s]); const m = 6 / s; ctx.strokeRect(u[0] - m, u[1] - m, u[2] - u[0] + 2 * m, u[3] - u[1] + 2 * m); }
    ctx.restore(); this.selBarAt = u;
  },

  /** A small bar above the selected group: how many items, Duplicate, Delete. Shown only while a group is selected and nothing is being dragged. */
  updateSelBar() {
    const gi = this.action ? [] : this.groupIdx(), u = gi.length ? this.selBarAt : null;
    if (!u) { if (this.selBar) this.selBar.hidden = true; return; }
    if (!this.selBar) {
      this.selBarCount = el("span", { class: "selcount" });
      this.selBar = el("div", { class: "selbar", role: "toolbar", "aria-label": "Selected items" }, this.selBarCount,
        el("button", { class: "btn small", type: "button", title: "Duplicate (" + K.MOD + "+D)", onclick: () => this.duplicateSelection() }, "Duplicate"),
        el("button", { class: "btn small danger", type: "button", title: "Delete (Delete key)", onclick: () => this.deleteSelected() }, "Delete"));
      this.stage.parentElement.appendChild(this.selBar);
    }
    this.selBarCount.textContent = gi.length + " selected";
    const [sx, sy] = this.pageToScreen(u[0], u[1]), top = this.barsInset() + 6, w = this.selBar.offsetWidth || 200;
    this.selBar.hidden = false;
    this.selBar.style.left = Math.max(6, Math.min(this.cw - w - 6, sx)) + "px";
    this.selBar.style.top = Math.max(top, sy - 40) + "px";
  },

  drawMarquee(ctx) {
    const a = this.action, s = this.view.scale; ctx.save();
    ctx.fillStyle = "rgba(25,118,210,.10)"; ctx.strokeStyle = "#1976d2"; ctx.lineWidth = 1 / s; ctx.setLineDash([4 / s, 3 / s]);
    const x = Math.min(a.p0.x, a.p1.x), y = Math.min(a.p0.y, a.p1.y), w = Math.abs(a.p1.x - a.p0.x), h = Math.abs(a.p1.y - a.p0.y);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]); ctx.strokeStyle = "rgba(25,118,210,.8)"; ctx.lineWidth = 1.2 / s;
    for (const i of a.hits) { const d = this.items[i], b = d && this.boundsOf(d); if (b) ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }       // (what the rectangle would select)
    ctx.restore();
  },

  // ------------------------------------------------------------- several items selected (a "group"), copy, cut, paste, duplicate
  /** Indices of the group (two or more items), [] when there is none (a group melts away when its items are gone: another page, Undo, deleted). */
  groupIdx() { if (!this.group) return []; const g = S.groupIndices(this.items, this.group); if (g.length < S.MIN_GROUP) { this.group = null; return []; } return g; },

  /** Indices of what is selected: the group, or the single selected item. */
  selectionIdx() { const g = this.groupIdx(); return g.length ? g : (this.selected !== null && this.items[this.selected] ? [this.selected] : []); },

  setSelection(idx) {
    if (idx.length >= S.MIN_GROUP) { this.group = new Set(idx.map((i) => this.items[i])); this.selected = null; }
    else { this.group = null; this.selected = idx.length ? idx[0] : null; }
    this.ui(); this.render();
  },

  selectAll() {
    if (this.editing || !this.hasPage) return false;
    const idx = this.items.map((d, i) => (d.t === "conn" ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return false;
    if (this.tool !== "select") this.setTool("select");
    this.setSelection(idx); return true;
  },

  /** What a copy takes: the selected items and, with mind-map nodes, the connectors between them. */
  selectionPayload() {
    const idx = this.selectionIdx(); if (!idx.length) return [];
    const picked = idx.map((i) => this.items[i]), nodes = new Set(picked.filter((d) => d.t === "node").map((d) => d.id));
    const conns = this.items.filter((d) => d.t === "conn" && nodes.has(d.from) && nodes.has(d.to) && !picked.includes(d));
    return [...picked, ...conns];
  },

  hasSelection() { return this.selectionIdx().length > 0 && !this.editing; },

  /** Put copies into this page (shifted by step), select them, one undo step. */
  pasteItems(items, step = 16) {
    if (!items || !items.length || !this.hasPage) return false;
    this.finishEdit();
    const [pw, ph] = this.pageDims(), box = S.unionBounds(items.filter((d) => d.t !== "conn").map((d) => R.itemBounds(d, null)));
    const [dx, dy] = box ? S.clampDelta(box, step, step, pw, ph) : [step, step];
    const copies = S.cloneItems(items, dx, dy).map((d) => { if (d.t === "text" && d.ruled && !["lined", "cornell"].includes(this.pages[this.cur] && this.pages[this.cur].paper)) { const n = { ...d }; delete n.ruled; delete n.rp; return n; } return this.settle(d); });      // (ruled text only on ruled paper)
    const base = this.items.length;
    this.commit([...this.items, ...copies], { keepSel: false });
    const idx = copies.map((_, k) => base + k).filter((i) => this.items[i] && this.items[i].t !== "conn");
    this.setTool("select"); this.setSelection(idx.length ? idx : [base]); return true;
  },

  duplicateSelection() { const items = this.selectionPayload(); if (!items.length || this.editing) return false; return this.pasteItems(items, 16); }
};
