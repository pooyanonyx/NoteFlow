import test from "node:test"; import assert from "node:assert/strict";
import * as M from "../../js/model.js";

const stroke = (pts, extra = {}) => ({ t: "pen", pts, color: "#000000", w: 4, ...extra });
test("pressure travels with the points: kept by the sanitiser, rounded and limited to 0..1", () => {
  const pages = M.parseNotebook(M.notebookToJson([{ paper: "blank", items: [stroke([[0, 0, 0.5], [10, 0, 0.9123], [20, 0, 7]])] }]));
  assert.deepEqual(pages[0].items[0].pts, [[0, 0, 0.5], [10, 0, 0.91], [20, 0, 1]]);
});
test("plain (older) strokes are unchanged: two values per point", () => {
  const pages = M.parseNotebook(M.notebookToJson([{ paper: "blank", items: [stroke([[0, 0], [10, 5]])] }]));
  assert.deepEqual(pages[0].items[0].pts, [[0, 0], [10, 5]]);
});
test("width follows pressure: the middle of the range is the nominal width, harder is thicker, lighter thinner", () => {
  assert.equal(M.pressureWidth(4, 0.5), 4); assert.ok(M.pressureWidth(4, 1) > 4); assert.ok(M.pressureWidth(4, 0.1) < 4); assert.equal(M.pressureWidth(4, undefined), 4);
});
test("moving a stroke keeps its pressure", () => {
  const d = stroke([[0, 0, 0.2], [10, 0, 0.8]]); assert.deepEqual(M.translate(d, 5, 5).pts, [[5, 5, 0.2], [15, 5, 0.8]]);
});
test("a partly erased pressure stroke keeps (and interpolates) the pressure in its pieces", () => {
  const d = stroke([[0, 0, 0.2], [100, 0, 0.8]]);
  const pieces = M.erasePen(d, [50, -20], [50, 20], 3);
  assert.equal(pieces.length, 2); assert.ok(pieces.every((p) => p.pts.every((q) => q.length === 3)));
  const left = pieces[0].pts, right = pieces[1].pts;
  assert.ok(left[left.length - 1][2] > 0.2 && left[left.length - 1][2] < 0.8 && right[0][2] > left[left.length - 1][2]);
});
test("a thick pressure stroke is hit and erased by its thickest part", () => {
  const thin = stroke([[0, 0], [100, 0]]), thick = stroke([[0, 0, 1], [100, 0, 1]]);
  assert.ok(M.penHalf(thick) > M.penHalf(thin)); assert.equal(M.penHalf(thin), 2);
});
test("resizing keeps the pressure and scales only the positions", () => {
  const d = stroke([[0, 0, 0.3], [10, 10, 0.7]]);
  const r = M.resizeItem(d, "se", 20, 20);
  assert.deepEqual(r.pts.map((q) => q[2]), [0.3, 0.7]); assert.equal(r.pts[1][0], 20);
});
