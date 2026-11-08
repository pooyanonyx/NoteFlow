import test from "node:test"; import assert from "node:assert/strict";
import { isNative, splitNative, annotationSpec, appearanceStream } from "../../js/pdfnative.js";
const pen = (pts, x = {}) => ({ t: "pen", pts, color: "#ff0000", w: 3, ...x });
const BOX = { x: 0, y: 0, width: 600, height: 800 };
test("pen and marker strokes and text highlights are native; text, shapes, images, pressure strokes, brightness-changed items are not", () => {
  assert.ok(isNative(pen([[1, 1], [5, 5]]))); assert.ok(isNative({ t: "mark", pts: [[1, 1], [9, 9]], color: "#fdd835", w: 20, alpha: 110 }));
  assert.ok(isNative({ t: "hl", x1: 10, y1: 10, x2: 80, y2: 24, color: "#ffee00" }));
  assert.ok(!isNative(pen([[1, 1, 0.3], [5, 5, 0.9]]))); assert.ok(!isNative(pen([[1, 1], [5, 5]], { bright: 40 })));
  for (const t of ["text", "rect", "ellipse", "image", "node", "note", "line"]) assert.ok(!isNative({ t, x: 0, y: 0, x1: 0, y1: 0, x2: 9, y2: 9, w: 5, text: "x" }), t);
});
test("split keeps the order inside each group; a rotated page keeps everything in the picture", () => {
  const a = pen([[0, 0], [1, 1]]), b = { t: "rect", x1: 0, y1: 0, x2: 5, y2: 5, color: "#000000", w: 2 }, c = pen([[2, 2], [3, 3]]);
  const s = splitNative([a, b, c]); assert.deepEqual(s.native, [a, c]); assert.deepEqual(s.raster, [b]);
  const r = splitNative([a, b, c], { rotated: true }); assert.equal(r.native.length, 0); assert.equal(r.raster.length, 3);
});
test("an ink annotation: page coordinates are turned upside down into PDF space, with the colour, width, opacity and a rectangle that contains the stroke", () => {
  const s = annotationSpec(pen([[10, 20], [110, 120]], { alpha: 128 }), BOX);
  assert.equal(s.kind, "Ink"); assert.deepEqual(s.ink, [10, 780, 110, 680]); assert.deepEqual(s.color, [1, 0, 0]); assert.equal(s.width, 3); assert.ok(Math.abs(s.alpha - 128 / 255) < 1e-9);
  assert.ok(s.rect[0] < 10 && s.rect[1] < 680 && s.rect[2] > 110 && s.rect[3] > 780);
  const o = annotationSpec(pen([[10, 20]]), { x: 5, y: 7, width: 600, height: 800 }); assert.equal(o.ink.length, 4, "a dot becomes a stroke of no length"); assert.equal(o.ink[0], 15); assert.equal(o.ink[1], 787);
});
test("a highlight: quad points of the box, in PDF order (top left, top right, bottom left, bottom right)", () => {
  const s = annotationSpec({ t: "hl", x1: 100, y1: 50, x2: 200, y2: 70, color: "#ffee00" }, BOX);
  assert.deepEqual(s.rect, [100, 730, 200, 750]); assert.deepEqual(s.quad, [100, 750, 200, 750, 100, 730, 200, 730]);
});
test("the appearance stream draws the same thing", () => {
  const ink = appearanceStream(annotationSpec(pen([[10, 20], [30, 40]]), BOX)); assert.match(ink, /1 0 0 RG 3 w/); assert.match(ink, /10 780 m 30 760 l S$/);
  const hl = appearanceStream(annotationSpec({ t: "hl", x1: 0, y1: 0, x2: 10, y2: 10, color: "#ffee00" }, BOX)); assert.match(hl, /re f$/);
});
