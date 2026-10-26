// Auto-sized text boxes (g: true): the width follows the text, from an anchor, up to the room the surface gives; no browser needed (every character is size / 2 wide).
import test from "node:test"; import assert from "node:assert/strict";
import { useStubMeasure, text } from "./helpers.mjs";
import * as M from "../../js/model.js";
const R = useStubMeasure();
const near = (a, b, m = "") => assert.ok(Math.abs(a - b) < 0.011, `${m} expected ${b}, got ${a}`);
const box = (o = {}) => text({ x: 100, y: 44, w: 20, g: true, size: 10, dir: "ltr", align: "left", ...o });   // pad 4 + 4, letters 5 wide
const G = { a: 100, lo: 12, hi: 583 };

test("an empty box is small; it widens with the text and stays anchored at its left edge", () => {
  const e = R.growBox(box({ text: "" }), G); assert.ok(e.w < 30); near(e.x, 100);
  let last = 0;
  for (const t of ["abc", "abcdef", "abcdef ghijk", "abcdef ghijk lmnop"]) { const b = R.growBox(box({ text: t }), G); assert.ok(b.w > last, t); near(b.x, 100); last = b.w; }
  near(R.growBox(box({ text: "abcdefghij" }), G, true).w, 8 + 50 + 0.02, "settled: exactly the text (+ a hair so float noise cannot wrap it)");
});
test("right-aligned boxes grow leftwards from their right edge, centred boxes in both directions", () => {
  const r = R.growBox(box({ text: "abcdefghij", align: "right", dir: "rtl" }), { a: 300, lo: 12, hi: 583 }); near(r.x + r.w, 300);
  const r2 = R.growBox(box({ text: "abcdefghijklmnopqrst", align: "right", dir: "rtl" }), { a: 300, lo: 12, hi: 583 }); near(r2.x + r2.w, 300); assert.ok(r2.w > r.w);
  const c = R.growBox(box({ text: "abcdefghij", align: "center" }), { a: 300, lo: 12, hi: 583 }); near(c.x + c.w / 2, 300);
});
test("it never grows beyond the surface: the text wraps at the edge and the box is as wide as its widest line", () => {
  const long = "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt uuu vvv www xxx yyy zzz ".repeat(3);
  const b = R.growBox(box({ text: long }), { a: 100, lo: 12, hi: 300 });
  assert.ok(b.x + b.w <= 300 + 1e-6 && b.x + b.w > 300 - 25, "reaches the edge");
  assert.ok(R.layoutRich(b).lines.length > 3, "wrapped");
  const l = R.growBox(box({ text: long, align: "right", dir: "rtl" }), { a: 300, lo: 200, hi: 583 }); assert.ok(l.x >= 200 - 1e-6 && near(l.x + l.w, 300) === undefined);
  const cc = R.growBox(box({ text: long, align: "center" }), { a: 150, lo: 100, hi: 400 }); assert.ok(cc.x >= 100 - 1e-6 && cc.x + cc.w <= 200 + 1e-6, "centre: the nearer edge limits both sides");
});
test("the lines of the grown box are the lines the surface allows (growing / settling never re-wraps)", () => {
  const t = "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt uuu";
  const hi = 140, a = R.growBox(box({ text: t }), { a: 100, lo: 12, hi: 240 }), s = R.growBox(box({ text: t }), { a: 100, lo: 12, hi: 240 }, true);
  const lines = (d) => R.layoutRich(d).lines.map((l) => [l.start, l.end]);
  assert.deepEqual(lines(a), lines(s)); void hi;
  assert.deepEqual(lines(s), lines(R.growBox(s, { a: 100, lo: 12, hi: 240 }, true)), "settling twice changes nothing");
});
test("spaces typed at the end keep their room (the caret walks over them); settled boxes do not keep it", () => {
  const a = R.growBox(box({ text: "ab" }), G), b = R.growBox(box({ text: "ab" + " ".repeat(8) }), G);
  assert.ok(b.w >= a.w + 8 * 5 - 1e-6);
  near(R.growBox(box({ text: "ab" + " ".repeat(8) }), G, true).w, 8 + 10 + 0.02);
  assert.ok(R.caretAt(b, 10).x <= b.x + b.w, "the caret is inside the box");
});
test("lists and several paragraphs: the widest line decides", () => {
  const b = R.growBox(box({ text: "ab\nabcdefgh", lists: ["b", ""] }), G, true), l = R.layoutRich(b);
  near(b.w, 8 + Math.max(l.lines[0].indent + 10, 40) + 0.02);
});
test("sanitizing keeps g only on a text box that has a width and a format; resizing the width by hand drops it", () => {
  assert.equal(M.sanitizeItem({ t: "text", x: 1, y: 2, w: 50, text: "a", size: 12, color: "#000000", dir: "ltr", align: "left", g: true }).g, true);
  assert.equal(M.sanitizeItem({ t: "text", x: 1, y: 2, text: "a", size: 12, color: "#000000", g: true }).g, undefined);
  assert.equal(M.sanitizeItem({ t: "text", x: 1, y: 2, w: 50, text: "a", size: 12, color: "#000000", dir: "ltr", align: "left", g: "yes" }).g, undefined);
  const d = box({ text: "abcd", w: 48 }), tb = [d.x, d.y, d.x + d.w, d.y + 14];
  assert.equal(M.resizeItem(d, "e", d.x + 90, d.y + 5, tb).g, undefined, "a side handle sets the width by hand");
  assert.equal(M.resizeItem(d, "se", d.x + 90, d.y + 30, tb).g, true, "a corner handle scales the whole box: still auto-sized");
});
