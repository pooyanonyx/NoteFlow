import test from "node:test"; import assert from "node:assert/strict";
import * as S from "../../js/selection.js";
import * as R from "../../js/render.js";

const rect = (x1, y1, x2, y2, extra = {}) => ({ t: "rect", x1, y1, x2, y2, color: "#000000", w: 2, ...extra });
const b = (d) => [Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.max(d.x1, d.x2), Math.max(d.y1, d.y2)];

test("a rectangle drawn over items selects those it touches (or only those it contains)", () => {
  const list = [rect(0, 0, 10, 10), rect(50, 50, 60, 60), rect(100, 0, 110, 10)];
  assert.deepEqual(S.itemsInRect(list, [5, 5, 55, 55], b), [0, 1]);
  assert.deepEqual(S.itemsInRect(list, [55, 55, 5, 5], b), [0, 1], "any corner order");
  assert.deepEqual(S.itemsInRect(list, [-5, -5, 65, 65], b, { contain: true }), [0, 1]);
  assert.deepEqual(S.itemsInRect(list, [5, 5, 55, 55], b, { contain: true }), []);
});
test("a group move is clamped so that the whole group stays on the page", () => {
  const box = [10, 10, 60, 40];
  assert.deepEqual(S.clampDelta(box, -50, 5, 200, 200), [-10, 5]);
  assert.deepEqual(S.clampDelta(box, 500, 500, 200, 200), [140, 160]);
  assert.deepEqual(S.clampDelta(box, 20, 20, 200, 200), [20, 20]);
  assert.deepEqual(S.unionBounds([[0, 0, 5, 5], null, [3, -2, 9, 4]]), [0, -2, 9, 5]);
  assert.equal(S.unionBounds([]), null);
});
test("a group is the set of objects that are still on the page", () => {
  const a = rect(0, 0, 1, 1), c = rect(2, 2, 3, 3), d = rect(4, 4, 5, 5);
  const g = new Set([a, c]);
  assert.deepEqual(S.groupIndices([a, d, c], g), [0, 2]);
  assert.deepEqual(S.groupIndices([a, { ...c }, d], g), [0], "an edited item is a new object: it left the group");
  assert.deepEqual(S.groupIndices([d], g), []);
  assert.deepEqual(S.toggleIn([0, 2], 1), [0, 1, 2]); assert.deepEqual(S.toggleIn([0, 1, 2], 1), [0, 2]);
});
test("copies get new ids, connectors follow their copied nodes, a connector without both nodes is dropped, the original is untouched", () => {
  const n1 = { t: "node", id: "nA", kind: "round", x1: 0, y1: 0, x2: 90, y2: 44, text: "A", color: "#000000", w: 2, size: 18 };
  const n2 = { ...n1, id: "nB", x1: 200, x2: 290 };
  const c = { t: "conn", from: "nA", to: "nB", style: "curve", arrow: false, color: "#000000", w: 2 };
  const note = { t: "text", id: "iLinked", x: 5, y: 5, w: 40, text: "x", color: "#000000", size: 18 };
  const copies = S.cloneItems([n1, n2, c, note], 10, 20);
  assert.equal(copies.length, 4);
  const [m1, m2, cc, nt] = copies;
  assert.notEqual(m1.id, "nA"); assert.notEqual(m2.id, "nB"); assert.equal(cc.from, m1.id); assert.equal(cc.to, m2.id);
  assert.notEqual(nt.id, "iLinked"); assert.equal(nt.x, 15); assert.equal(nt.y, 25); assert.equal(m1.x1, 10);
  assert.equal(n1.id, "nA"); assert.equal(n1.x1, 0); assert.equal(note.x, 5, "the original is not changed");
  assert.equal(S.cloneItems([n1, c], 0, 0).length, 1, "a connector whose second node was not copied is left out");
});
test("the copy buffer: a paste whose clipboard still holds the marker pastes the items; other text does not", () => {
  const marker = S.setBuffer([rect(0, 0, 1, 1)], "nb");
  assert.ok(S.isMarker(marker)); assert.equal(S.bufferFor(marker).items.length, 1); assert.equal(S.bufferFor("hello"), null);
  const again = S.setBuffer([rect(0, 0, 2, 2)], "nb"); assert.equal(S.bufferFor(marker), null, "an older marker no longer matches");
  assert.equal(S.bufferFor(" " + again + "\n").items[0].x2, 2);
  S.clearBuffer(); assert.equal(S.bufferFor(again), null);
});
