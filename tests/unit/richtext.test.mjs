import test from "node:test"; import assert from "node:assert/strict";
import * as RT from "../../js/richtext.js";

const C = (text, runs = null, lists = null) => RT.makeContent(text, runs, lists);
test("runs must match the text, else they are ignored", () => {
  assert.equal(RT.cleanRuns([{ s: "ab", b: 1 }], "abc"), null);
  assert.equal(RT.cleanRuns([{ s: "abc" }], "abc"), null);                       // no formatting at all
  assert.deepEqual(RT.cleanRuns([{ s: "a", b: 1 }, { s: "b", b: 1 }, { s: "c" }], "abc"), [{ s: "ab", b: 1 }, { s: "c" }]);
});
test("applyStyle splits runs and toggles back", () => {
  let c = C("hello world");
  c = RT.applyStyle(c, 0, 5, { b: true });
  assert.deepEqual(c.runs, [{ s: "hello", b: 1 }, { s: " world" }]);
  c = RT.applyStyle(c, 3, 8, { i: true, z: 30 });
  assert.equal(c.runs.map((r) => r.s).join(""), "hello world"); assert.equal(RT.styleOfRange(c, 3, 5, 16).b, true); assert.equal(RT.styleOfRange(c, 0, 8, 16).b, null);
  assert.equal(RT.styleOfRange(c, 3, 8, 16).z, 30);
  c = RT.applyStyle(c, 0, 11, { b: false, i: false, z: null });
  assert.equal(c.runs, null);
});
test("slice and concat are inverse (also with lists and runs)", () => {
  const c = C("one two\nthree", [{ s: "one ", b: 1 }, { s: "two\nthree" }], ["n", "b"]);
  const a = RT.slice(c, 0, 4), b = RT.slice(c, 4, c.text.length);
  const back = RT.concat(a, b, true);
  assert.deepEqual(back, c);
  const parts = [RT.slice(c, 0, 7), RT.slice(c, 8, 13)];
  assert.deepEqual(RT.concat(parts[0], parts[1], false), c);
  assert.deepEqual(RT.slice(c, 8, 13).lists, ["b"]);
});
test("Enter keeps the list; deleting a break joins paragraphs", () => {
  let c = C("ab", null, ["b"]);
  c = RT.replaceRange(c, 1, 1, "\n");
  assert.equal(c.text, "a\nb"); assert.deepEqual(c.lists, ["b", "b"]);
  c = RT.replaceRange(c, 1, 2, "");
  assert.equal(c.text, "ab"); assert.deepEqual(c.lists, ["b"]);
});
test("typing continues the style of the text before the caret", () => {
  let c = RT.applyStyle(C("abc"), 0, 3, { b: true });
  c = RT.replaceRange(c, 3, 3, "d");
  assert.deepEqual(c.runs, [{ s: "abcd", b: 1 }]);
});
test("lists toggle on all touched paragraphs and off again", () => {
  let c = C("a\nb\nc");
  c = RT.toggleList(c, 0, 2, "n"); assert.deepEqual(c.lists, ["n", "n", ""]);
  c = RT.toggleList(c, 0, 2, "n"); assert.equal(c.lists, null);
  c = RT.toggleList(c, 4, 4, "b"); assert.deepEqual(c.lists, ["", "", "b"]);
});
