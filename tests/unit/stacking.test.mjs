import test from "node:test"; import assert from "node:assert/strict";
import { raiseToFront } from "../../js/model.js";
test("raiseToFront: moved items go to the end in their own order; the others keep theirs", () => {
  const items = ["a", "b", "c", "d", "e"], r = raiseToFront(items, [3, 1]);
  assert.deepEqual(r.items, ["a", "c", "e", "b", "d"]);
  assert.deepEqual(r.idxs, [4, 3]);                                      // d is now last, b before it: relative order b < d kept
  assert.deepEqual(r.map, [0, 3, 1, 4, 2]);
  assert.deepEqual(items, ["a", "b", "c", "d", "e"], "the input is not changed");
});
test("raiseToFront: an item already on top stays, and nothing is lost", () => {
  assert.deepEqual(raiseToFront(["a", "b"], [1]).items, ["a", "b"]);
  assert.deepEqual(raiseToFront(["a", "b", "c"], [0, 1, 2]).items, ["a", "b", "c"]);
});
