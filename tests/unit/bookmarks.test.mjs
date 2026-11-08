import test from "node:test"; import assert from "node:assert/strict";
import { Bookmarks } from "../../js/bookmarks.js";
import { outlineOf, flattenOutline } from "../../js/pdfnav.js";
const DOC = "cd".repeat(16);
test("bookmarks: add (sorted by page, one per page), rename, remove, toggle", () => {
  const b = new Bookmarks(); let n = 0; b.onChange(() => n++);
  assert.ok(b.add(DOC, 9, "Chapter 2")); assert.ok(b.add(DOC, 2)); assert.ok(!b.add(DOC, 2, "again"));
  assert.deepEqual(b.list(DOC).map((x) => [x.page, x.label]), [[2, "Page 3"], [9, "Chapter 2"]]);
  assert.ok(b.rename(DOC, 2, "  Intro  ")); assert.equal(b.list(DOC)[0].label, "Intro");
  assert.equal(b.toggle(DOC, 9), false); assert.equal(b.has(DOC, 9), false); assert.equal(b.toggle(DOC, 9, "back"), true);
  assert.ok(b.remove(DOC, 2)); assert.ok(!b.remove(DOC, 2)); assert.ok(n >= 5);
});
test("bookmarks: refused without a document identity or with a bad page; limited per document", () => {
  const b = new Bookmarks(); assert.ok(!b.add("nothex", 1)); assert.ok(!b.add(DOC, -1)); assert.ok(!b.add(DOC, 1.5));
  for (let i = 0; i < 200; i++) assert.ok(b.add(DOC, i)); assert.ok(!b.add(DOC, 500));
});
test("bookmarks: saved as plain data and read back; damaged data is dropped, not trusted", () => {
  const b = new Bookmarks(); b.add(DOC, 4, "Four"); const json = JSON.parse(JSON.stringify(b.toJSON()));
  const c = new Bookmarks(); c.load(json); assert.deepEqual(c.list(DOC), [{ page: 4, label: "Four" }]);
  c.load({ [DOC]: [{ page: "x" }, { page: 3, label: 5 }, null, { page: 3, label: "dup" }], bad: [{ page: 1 }], [DOC.replace(/c/g, "e")]: "no" });
  assert.deepEqual(c.list(DOC), [{ page: 3, label: "5" }]); c.load(undefined); assert.deepEqual(c.list(DOC), []);
});
test("outline: destinations by name or by page reference become page numbers; a broken outline gives []", async () => {
  const ref = { num: 7, gen: 0 };
  const doc = { getOutline: async () => [{ title: "Intro", dest: "d1", items: [{ title: " Sub\n title ", dest: [ref, { name: "XYZ" }], items: [] }] }, { title: "Nowhere", dest: null, items: [] }],
    getDestination: async (n) => (n === "d1" ? [{ num: 3, gen: 0 }] : null), getPageIndex: async (r) => (r.num === 3 ? 0 : r.num === 7 ? 6 : 99) };
  const flat = flattenOutline(await outlineOf(doc));
  assert.deepEqual(flat, [{ title: "Intro", page: 0, depth: 0 }, { title: "Sub title", page: 6, depth: 1 }, { title: "Nowhere", page: null, depth: 0 }]);
  assert.deepEqual(await outlineOf({ getOutline: async () => { throw new Error("x"); } }), []);
  assert.deepEqual(await outlineOf({ getOutline: async () => null }), []);
});
