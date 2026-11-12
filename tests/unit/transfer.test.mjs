import test from "node:test"; import assert from "node:assert/strict";
import { transferItems } from "../../js/transfer.js";
import { placeGroup, unionRect, dropPage } from "../../js/pagemove.js";

const rect = (x1, y1, x2, y2, extra = {}) => ({ t: "rect", x1, y1, x2, y2, color: "#d32f2f", w: 3, ...extra });
const node = (id, x1) => ({ t: "node", id, kind: "round", x1, y1: 10, x2: x1 + 90, y2: 54, text: id, color: "#000000", w: 2, size: 18 });
const conn = (from, to) => ({ t: "conn", from, to, style: "curve", arrow: false, color: "#000000", w: 2 });

test("every kind of item keeps all its properties; only the position changes, by the same amount for all", () => {
  const items = [rect(0, 0, 10, 10, { fill: "#ffeb3b" }), { t: "text", id: "i1", x: 20, y: 30, w: 80, text: "hello", runs: [{ s: "hello", b: 1 }], color: "#1a1a1a", size: 18, dir: "ltr", align: "left", alpha: 255, bright: 0 },
    { t: "pen", pts: [[1, 1, 0.4], [9, 9, 0.8]], color: "#000000", w: 3 }, { t: "note", x: 5, y: 5, w: 100, h: 80, text: "n", color: "#fff59d", size: 16 }, { t: "image", x1: 0, y1: 0, x2: 50, y2: 40, data: "AAAA" }];
  const r = transferItems(items, [0, 1, 2, 3, 4], 100, 200);
  assert.equal(r.rest.length, 0); assert.equal(r.moved.length, 5);
  assert.equal(r.moved[0].fill, "#ffeb3b"); assert.equal(r.moved[0].x1, 100); assert.equal(r.moved[0].y2, 210);
  assert.equal(r.moved[1].id, "i1"); assert.deepEqual(r.moved[1].runs, [{ s: "hello", b: 1 }]); assert.equal(r.moved[1].x, 120); assert.equal(r.moved[1].y, 230);
  assert.deepEqual(r.moved[2].pts, [[101, 201, 0.4], [109, 209, 0.8]]);
  assert.equal(r.moved[3].x, 105); assert.equal(r.moved[4].data, "AAAA");
  assert.equal(items[0].x1, 0, "the originals are untouched");
});
test("only the chosen items move; the others stay, in order", () => {
  const items = [rect(0, 0, 1, 1), rect(2, 2, 3, 3), rect(4, 4, 5, 5)]; const r = transferItems(items, [1], 10, 10);
  assert.deepEqual(r.rest, [items[0], items[2]]); assert.equal(r.moved.length, 1); assert.equal(r.moved[0].x1, 12);
});
test("a connector travels with its nodes when both move; one with a single end moving is dropped; others stay", () => {
  const items = [node("a", 0), node("b", 200), node("c", 400), conn("a", "b"), conn("b", "c"), conn("c", "c")];
  const r = transferItems(items, [0, 1], 0, 500);
  assert.deepEqual(r.moved.map((d) => d.t + (d.id || d.from + d.to)), ["nodea", "nodeb", "connab"]);
  assert.deepEqual(r.dropped.map((d) => d.from + d.to), ["bc"]); assert.deepEqual(r.rest.map((d) => d.t + (d.id || d.from + d.to)), ["nodec", "conncc"]);
});
test("text that is a piece of a chain across pages: the whole chain is detached (nothing else changes)", () => {
  const t = (id, fl, extra = {}) => ({ t: "text", id, x: 10, y: 10, w: 100, text: id, color: "#000000", size: 18, fl, ...extra });
  const items = [t("p1", "F"), t("p2", "F", { cont: true, ns: 3 }), t("other", undefined)];
  const r = transferItems(items, [1], 0, 0);
  assert.equal(r.detached, 2); assert.equal(r.moved[0].fl, undefined); assert.equal(r.moved[0].cont, undefined); assert.equal(r.moved[0].ns, undefined); assert.equal(r.rest[0].fl, undefined);
  assert.equal(r.moved[0].text, "p2"); assert.equal(r.rest[1].id, "other");
  assert.equal(transferItems([t("x", undefined)], [0], 1, 1).detached, 0);
});
test("a group dropped on a page keeps its relative positions and stays inside the page", () => {
  const g = [0, 1000, 600, 800];
  assert.deepEqual(placeGroup([100, 1100, 300, 1200], g), [100, 100]);
  assert.deepEqual(placeGroup([-50, 900, 150, 1000], g), [0, 0], "dragged past the top-left corner");
  assert.deepEqual(placeGroup([500, 1700, 700, 1900], g), [400, 600], "past the bottom-right corner");
  assert.deepEqual(placeGroup([0, 1000, 900, 1900], g), [0, 0], "larger than the page: kept covering it");
  assert.deepEqual(unionRect([[0, 0, 5, 5], null, [3, -2, 9, 4]]), [0, -2, 9, 5]); assert.equal(unionRect([]), null);
});
test("the page a group lands on is the one it covers most", () => {
  const pg = { count: 3, geom: (i) => [0, i * 900, 600, 842], pageAt: (y) => Math.floor(y / 900), pageNearest: (y) => Math.round(y / 900), prefer: 0 };
  assert.equal(dropPage([100, 1000, 300, 1100], pg), 1); assert.equal(dropPage([100, 700, 300, 1000], pg), 0, "a tie goes to the page it came from");
});
