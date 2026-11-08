// Multi-selection and item copying: the parts that need no screen, so they can be tested without a browser.
// The panel keeps ONE selected item (`selected`, an index) as before; a selection of several items (a "group") is a set of item objects. Items are never edited in
// place (an edit makes a new object), so "still the same object" means "unchanged", and a group that no longer matches the page (after Undo, or on another page)
// simply melts away by itself.
import * as M from "./model.js";

export const MIN_GROUP = 2;

/** Indices (in list) of the items whose bounds touch the rectangle [x0, y0, x1, y1]. `boundsOf(d)` -> [x0, y0, x1, y1]; contain: only items completely inside. */
export function itemsInRect(list, rect, boundsOf, { contain = false } = {}) {
  const [x0, y0, x1, y1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])], out = [];
  list.forEach((d, i) => {
    const b = boundsOf(d); if (!b) return;
    const hit = contain ? b[0] >= x0 && b[1] >= y0 && b[2] <= x1 && b[3] <= y1 : !(b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1);
    if (hit) out.push(i);
  });
  return out;
}

/** Union of boxes. null for none. */
export function unionBounds(boxes) {
  let u = null;
  for (const b of boxes) { if (!b) continue; u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice(); }
  return u;
}

/** Limit a move (dx, dy) so that a box stays inside the page [0, 0, w, h]. A box larger than the page is only kept from running away. */
export function clampDelta(box, dx, dy, w, h) {
  const lo = (min, size, d, max) => (size >= max ? Math.min(0, Math.max(d, -min)) : Math.min(Math.max(d, -min), max - size - min));
  return [lo(box[0], box[2] - box[0], dx, w), lo(box[1], box[3] - box[1], dy, h)];
}

/** Which items of `list` are still in the group (by identity)? Indices in list order. */
export function groupIndices(list, group) {
  if (!group || !group.size) return [];
  const out = []; list.forEach((d, i) => { if (group.has(d)) out.push(i); });
  return out;
}

/** The selection after a Shift+click on item `idx`: add it, or take it out when it is in already. Returns an array of indices (any length). */
export function toggleIn(current, idx) { return current.includes(idx) ? current.filter((i) => i !== idx) : [...current, idx].sort((a, b) => a - b); }

/** Copies of items for pasting or duplicating, shifted by (dx, dy):
 *   - items that had an id get a NEW one (a link belongs to the original, never to its copy), and mind-map connectors are re-pointed at the copies of their nodes;
 *   - a connector whose nodes were not both copied is left out (it would point at nothing);
 *   - the payload is deep-copied, so later edits of the original never reach the copy. */
export function cloneItems(items, dx = 0, dy = 0) {
  const nodeIds = new Map();
  for (const d of items) if (d.t === "node" && d.id) nodeIds.set(d.id, M.newId());
  const out = [];
  for (const d of items) {
    if (d.t === "conn" && !(nodeIds.has(d.from) && nodeIds.has(d.to))) continue;
    let n = JSON.parse(JSON.stringify(d));
    n = M.translate(n, dx, dy);
    if (d.t === "node") n.id = nodeIds.get(d.id);
    else if (d.t === "conn") { n.from = nodeIds.get(d.from); n.to = nodeIds.get(d.to); delete n.id; }
    else if (n.id) n.id = M.ensureId({});
    out.push(n);
  }
  return out;
}

// ------------------------------------------------------------------ the copy buffer
// Copy / Cut put a short marker text on the system clipboard and keep the items in memory under that marker: a later Paste whose clipboard still holds the marker pastes the
// items; if anything else was copied in the meantime the marker is gone and the paste is an ordinary one. (Items stay in this tab; nothing large goes to the clipboard.)
export const MARKER = "NoteFlow items #";
const buffer = { token: null, items: null, kind: null, pastes: 0 };
export function setBuffer(items, kind) {
  buffer.token = Math.random().toString(36).slice(2, 10); buffer.items = JSON.parse(JSON.stringify(items)); buffer.kind = kind; buffer.pastes = 0;
  return MARKER + buffer.token;
}
/** The buffer when `text` is its marker, else null. */
export function bufferFor(text) {
  const t = String(text || "").trim();
  return buffer.items && t === MARKER + buffer.token ? buffer : null;
}
export const isMarker = (text) => String(text || "").trim().startsWith(MARKER);
export const clearBuffer = () => { buffer.token = buffer.items = buffer.kind = null; buffer.pastes = 0; };
