import { test } from "node:test";
import assert from "node:assert/strict";
import { docRect, dropPage, placeInPage } from "../../js/pagemove.js";
import * as M from "../../js/model.js";

// A column of pages like Panel.layout() builds it: page i starts at offs[i], pages are centred in docW, GAP apart.
const GAP = 12;
function column(sizes) {
  const offs = []; let y = 0, W = 0;
  for (const [w, h] of sizes) { offs.push(y); y += h + GAP; W = Math.max(W, w); }
  const geom = (i) => [(W - sizes[i][0]) / 2, offs[i], sizes[i][0], sizes[i][1]];
  const pageAt = (y) => { let lo = 0, hi = sizes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= y) lo = mid; else hi = mid - 1; } return lo; };
  const pageNearest = (y) => { const i = pageAt(y); return i < sizes.length - 1 && y > offs[i] + sizes[i][1] + GAP / 2 ? i + 1 : i; };
  return { count: sizes.length, geom, pageAt, pageNearest, offs, W };
}
const A4 = [595, 842], NB = column([A4, A4, A4, A4]);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const img = (o = {}) => ({ t: "image", id: "imgA", x1: 100, y1: 600, x2: 300, y2: 700, data: PNG, ...o });

// Drag an image of page `src` by (dx, dy) and return where it lands: { page, item } (what Panel.dropImage does with these functions).
function drag(col, src, d, dx, dy, prefer = src) {
  const g = col.geom(src), moved = M.translate(d, dx, dy), rect = docRect(moved, g[0], g[1]);
  const page = dropPage(rect, { ...col, prefer });
  return { page, item: placeInPage(moved, rect, col.geom(page)), rect };
}
const size = (d) => [Math.abs(d.x2 - d.x1), Math.abs(d.y2 - d.y1)];

test("from one page to the next, and from the next back to the previous", () => {
  const a = drag(NB, 0, img(), 20, 260);                          // bottom of page 1 -> well into page 2
  assert.equal(a.page, 1);
  assert.ok(a.item.y1 >= 0 && a.item.y2 <= 842 && a.item.x1 >= 0 && a.item.x2 <= 595, JSON.stringify(a.item));
  const b = drag(NB, 1, a.item, -10, -300);                       // and back up
  assert.equal(b.page, 0);
});
test("the position is the same place on the page: the image does not jump when it changes page", () => {
  const d = img({ y1: 700, y2: 800 }), g0 = NB.geom(0), g1 = NB.geom(1);
  const r = drag(NB, 0, d, 0, 300);                               // top ends at document y 1000 = 146 below the top of page 2
  assert.equal(r.page, 1);
  assert.ok(Math.abs(r.item.y1 - (700 + 300 - (g1[1] - g0[1]))) < 0.01 && Math.abs(r.item.y1 - 146) < 0.01, JSON.stringify(r.item));
  assert.equal(r.item.x1, 100);                                    // same column
});
test("across several pages in one drag: 1 -> 4, then 4 -> 2", () => {
  const down = drag(NB, 0, img(), 0, 3 * (842 + GAP) - 300);
  assert.equal(down.page, 3);
  const up = drag(NB, 3, down.item, 0, -2 * (842 + GAP));
  assert.equal(up.page, 1);
});
test("size, aspect ratio, picture data and id never change", () => {
  const d = img({ x1: 40.25, y1: 700.5, x2: 337.75, y2: 790.5 }), before = size(d);
  for (const [dx, dy] of [[0, 300], [500, 400], [-500, 900], [3, 1500], [0, -900]]) {
    const r = drag(NB, 0, d, dx, dy), s = size(r.item);
    assert.ok(Math.abs(s[0] - before[0]) < 0.011 && Math.abs(s[1] - before[1]) < 0.011, [dx, dy, s, before]);
    assert.equal(r.item.data, d.data); assert.equal(r.item.id, d.id); assert.equal(r.item.t, "image");
  }
});
test("near the boundary: the page it covers most wins; an exact tie stays where it came from", () => {
  // image 100 high, top at document y T: page 1 ends at 842, page 2 starts at 854. Share on page 1 = 842 - T, on page 2 = T + 100 - 854.
  const d = img({ y1: 700, y2: 800 }), at = (T, prefer) => drag(NB, 0, d, 0, T - 700, prefer).page;
  assert.equal(at(784, 0), 0);                                    // 58 on page 1, 30 on page 2: stays
  assert.equal(at(824, 0), 1);                                    // 18 on page 1, 70 on page 2: moves
  assert.equal(at(798, 0), 0);                                    // 44 / 44: a tie stays on the page it came from
  assert.equal(at(798, 1), 1);                                    // ...and the same tie goes to the other page when that is the preferred one
});
test("an image dragged into the gap, or beyond the first / last page, lands on the nearest page and stays inside it", () => {
  const inGap = docRect(img({ y1: 842 + 1, y2: 842 + 11 }), NB.W / 2 - 100, 0);
  assert.ok([0, 1].includes(dropPage(inGap, { ...NB, prefer: 0 })));
  const above = drag(NB, 0, img({ y1: 10, y2: 110 }), 0, -2000);                    // far above the first page
  assert.equal(above.page, 0); assert.ok(above.item.y1 >= 0, JSON.stringify(above.item));
  const below = drag(NB, 3, img(), 0, 5000);                                         // far below the last
  assert.equal(below.page, 3); assert.ok(below.item.y2 <= 842, JSON.stringify(below.item));
});
test("corners: pulled beyond a corner or a side, the image is kept fully inside the page (and keeps its size)", () => {
  for (const [dx, dy] of [[-5000, -5000], [5000, -5000], [-5000, 5000], [5000, 5000], [-400, 0], [400, 0]]) {
    const r = drag(NB, 1, img({ x1: 10, y1: 10, x2: 210, y2: 110 }), dx, dy), g = NB.geom(r.page), s = size(r.item);
    assert.ok(r.item.x1 >= 0 && r.item.y1 >= 0 && r.item.x2 <= g[2] + 0.01 && r.item.y2 <= g[3] + 0.01, [dx, dy, JSON.stringify(r.item)]);
    assert.ok(Math.abs(s[0] - 200) < 0.02 && Math.abs(s[1] - 100) < 0.02);
  }
  const corner = drag(NB, 0, img({ x1: 380, y1: 740, x2: 580, y2: 840 }), 15, 30);     // bottom-right corner of page 1, dragged out a little
  assert.equal(corner.page, 0); assert.ok(corner.item.x2 <= 595 && corner.item.y2 <= 842);
});
test("pages of different sizes (a PDF): the position is converted through each page's own origin", () => {
  const col = column([[595, 842], [842, 595], [420, 595]]);                           // portrait, landscape (wider: centred), small
  const d = img({ x1: 50, y1: 700, x2: 250, y2: 800 });
  const r = drag(col, 0, d, 100, 200);
  assert.equal(r.page, 1);
  const g1 = col.geom(1), g0 = col.geom(0);
  const docX = g0[0] + 150, docY = g0[1] + 900;                                        // where the image's top-left was dropped, in document space
  const expectX = Math.min(Math.max(docX - g1[0], 0), g1[2] - 200), expectY = Math.min(Math.max(docY - g1[1], 0), g1[3] - 100);
  assert.ok(Math.abs(r.item.x1 - expectX) < 0.02 && Math.abs(r.item.y1 - expectY) < 0.02, [r.item, expectX, expectY]);
  const small = drag(col, 1, r.item, 0, 700);                                          // to the small page: clamped inside its 420 width
  assert.equal(small.page, 2); assert.ok(small.item.x2 <= 420.01 && small.item.x1 >= 0);
});
test("a picture larger than its page is kept covering it, so it can still be grabbed", () => {
  const big = img({ x1: 0, y1: 0, x2: 700, y2: 900 }), r = drag(NB, 0, big, 300, 300);
  assert.ok(r.item.x1 <= 0 && r.item.x2 >= 595 && r.item.y1 <= 0 && r.item.y2 >= 842, JSON.stringify(r.item));
});
test("a flipped image (x2 < x1) keeps its orientation", () => {
  const r = drag(NB, 0, img({ x1: 300, x2: 100, y1: 700, y2: 600 }), 0, 400);
  assert.ok(r.item.x1 > r.item.x2 && r.item.y1 > r.item.y2);
});
test("a tiny move never changes page, wherever the image is", () => {
  for (const y1 of [0, 400, 742, 800]) assert.equal(drag(NB, 2, img({ y1, y2: Math.min(842, y1 + 100) }), 0.4, 0.4).page, 2);
});
test("moving with several pages visible or not is the same decision (geometry is in document units, zoom only converts the pointer)", () => {
  // The panel converts the pointer with screenToPage (existing code); here the document delta is what matters: the same document drag gives the same page at any zoom.
  const docDrag = 3 * (842 + GAP) - 250;
  for (const zoom of [0.2, 0.5, 1, 2, 4]) { const screen = docDrag * zoom, back = screen / zoom; assert.equal(drag(NB, 0, img(), 0, back).page, 3); }
});
test("saving and reopening: the moved image is on its new page with the same size, picture and id", () => {
  const moved = drag(NB, 0, img({ x1: 40, y1: 600, x2: 340, y2: 750 }), 30, 400);       // page 1 -> page 2
  const pages = [{ paper: "lined", items: [] }, { paper: "lined", items: [moved.item] }, { paper: "lined", items: [] }];
  const back = M.parseNotebook(M.notebookToJson(pages));
  assert.equal(back[0].items.length, 0); assert.equal(back[1].items.length, 1);
  const it = back[1].items[0];
  assert.equal(it.t, "image"); assert.equal(it.data, PNG); assert.equal(it.id, "imgA");
  assert.deepEqual([it.x1, it.y1, it.x2, it.y2], [moved.item.x1, moved.item.y1, moved.item.x2, moved.item.y2]);
  // and it can be moved again after reopening
  const again = drag(NB, 1, it, 0, -(842 + GAP) - 100);
  assert.equal(again.page, 0);
});
