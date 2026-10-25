import test from "node:test"; import assert from "node:assert/strict";
import * as B from "../../js/bidi.js";
test("an English word inside Persian text is left-to-right and keeps its order", () => {
  const lv = Array.from(B.resolveLevels("سلام hello world دنیا", true));
  const t = "سلام hello world دنیا";
  assert.equal(lv[t.indexOf("hello")], 2); assert.equal(lv[t.indexOf("world")], 2); assert.equal(lv[0], 1); assert.equal(lv[t.indexOf("دنیا")], 1);
  assert.equal(lv[t.indexOf(" world") ], 2);                                     // the space between two English words belongs to them
});
test("digits after Persian stay a left-to-right number", () => {
  const lv = Array.from(B.resolveLevels("سال 1405", false)); assert.deepEqual(lv.slice(0, 3), [1, 1, 1]); assert.equal(lv[4], 2);
});
test("visual order reverses right-to-left runs", () => {
  const out = B.visualOrder([{ id: "a", level: 1 }, { id: "b", level: 2 }, { id: "c", level: 2 }, { id: "d", level: 1 }]);
  assert.deepEqual(out.map((x) => x.id), ["d", "b", "c", "a"]);
  assert.deepEqual(B.visualOrder([{ id: 1, level: 0 }, { id: 2, level: 0 }]).map((x) => x.id), [1, 2]);
});
