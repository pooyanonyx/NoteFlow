// Dragging an image from one page to another: the geometry (pure, so it runs in unit tests; panel.js applies it).
//
// Pages sit one under the other in one column ("document space"); page i has its top-left corner and size in geom(i) = [x, y, w, h]. An item is stored in the
// coordinates of its own page, so moving it to another page means: find the page it was dragged onto, express its rectangle in that page's coordinates, and keep it
// inside that page. Size, aspect ratio and picture data are never touched; only the position changes.

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const overlap = (r, g) => Math.max(0, Math.min(r[2], g[0] + g[2]) - Math.max(r[0], g[0])) * Math.max(0, Math.min(r[3], g[1] + g[3]) - Math.max(r[1], g[1]));

/** Document-space rectangle [x1, y1, x2, y2] (normalised) of an image item that belongs to a page whose top-left corner is at (ox, oy). */
export const docRect = (d, ox, oy) => [Math.min(d.x1, d.x2) + ox, Math.min(d.y1, d.y2) + oy, Math.max(d.x1, d.x2) + ox, Math.max(d.y1, d.y2) + oy];

/**
 * The page a dragged rectangle lands on: the page it covers most. A tie goes to `prefer` (the page it came from), so an image that is only moved a little never changes page.
 * An image that covers no page at all (dragged into the gap, or beyond the first / last page) goes to the page nearest to its centre.
 * pg: { count, geom(i) -> [x, y, w, h], pageAt(y) -> page at or above document-y, pageNearest(y), prefer }
 */
export function dropPage(rect, pg) {
  const last = pg.count - 1;
  if (last < 0) return 0;
  const lo = clamp(pg.pageAt(rect[1]), 0, last), hi = clamp(pg.pageAt(rect[3]), 0, last);
  let best = -1, bestA = 0;
  for (let i = lo; i <= hi; i++) { const a = overlap(rect, pg.geom(i)); if (a > bestA + 1e-9) { best = i; bestA = a; } }
  if (best < 0) return clamp(pg.pageNearest((rect[1] + rect[3]) / 2), 0, last);
  const pr = pg.prefer;
  if (pr !== undefined && pr >= lo && pr <= hi && overlap(rect, pg.geom(pr)) >= bestA - 1e-9) return pr;
  return best;
}

/**
 * The image item as it is stored on the page with geometry g, for the document-space rectangle it was dragged to: same size, aspect ratio and data, kept inside the page.
 * (A picture larger than the page is kept covering it instead, so it can still be grabbed.)
 */
export function placeInPage(d, rect, g) {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  const fit = (v, size, dim) => clamp(v, Math.min(0, dim - size), Math.max(0, dim - size));
  const x = r2(fit(rect[0] - g[0], w, g[2])), y = r2(fit(rect[1] - g[1], h, g[3]));
  const o = { ...d };
  if (d.x1 <= d.x2) { o.x1 = x; o.x2 = r2(x + w); } else { o.x2 = x; o.x1 = r2(x + w); }
  if (d.y1 <= d.y2) { o.y1 = y; o.y2 = r2(y + h); } else { o.y2 = y; o.y1 = r2(y + h); }
  return o;
}
