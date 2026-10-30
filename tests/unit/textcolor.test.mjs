// Colour inside a text box: runs may carry c ("#rrggbb"); everything that cuts, joins, stores, lays out and draws runs must keep it.
import test from "node:test"; import assert from "node:assert/strict";
import * as RT from "../../js/richtext.js";
import * as M from "../../js/model.js";
import * as F from "../../js/flow.js";
import { useStubMeasure, text } from "./helpers.mjs";
const R = useStubMeasure();
const C = (t, runs = null, lists = null) => RT.makeContent(t, runs, lists);

test("a colour can be set on part of the text and taken off again", () => {
  let c = RT.applyStyle(C("hello world"), 6, 11, { c: "#D32F2F" });
  assert.deepEqual(c.runs, [{ s: "hello " }, { s: "world", c: "#d32f2f" }]);       // normalised to lower case
  c = RT.applyStyle(c, 6, 11, { c: null });
  assert.equal(c.runs, null);                                                    // back to the box colour: no formatting left
});
test("colour is a style like size: neighbours with the same colour merge, different ones stay apart", () => {
  let c = RT.applyStyle(C("abcd"), 0, 2, { c: "#112233" }); c = RT.applyStyle(c, 2, 4, { c: "#112233" });
  assert.deepEqual(c.runs, [{ s: "abcd", c: "#112233" }]);
  c = RT.applyStyle(c, 2, 4, { c: "#445566" });
  assert.deepEqual(c.runs, [{ s: "ab", c: "#112233" }, { s: "cd", c: "#445566" }]);
});
test("invalid colours are dropped when read", () => {
  assert.equal(RT.cleanRuns([{ s: "ab", c: "red" }], "ab"), null);
  assert.equal(RT.cleanRuns([{ s: "ab", c: "javascript:1" }], "ab"), null);
  assert.deepEqual(RT.cleanRuns([{ s: "ab", c: "#abc" }], "ab"), [{ s: "ab", c: "#aabbcc" }]);
  const d = M.sanitizeItem({ t: "text", x: 0, y: 0, text: "ab", color: "#000000", size: 10, runs: [{ s: "a" }, { s: "b", c: "#ff0000" }] });
  assert.deepEqual(d.runs, [{ s: "a" }, { s: "b", c: "#ff0000" }]);              // survives load / save
});
test("styleOfRange reports the colour (the box colour where none is set, null when mixed)", () => {
  const c = RT.applyStyle(C("hello world"), 6, 11, { c: "#ff0000" });
  assert.equal(RT.styleOfRange(c, 6, 11, 16, "#000000").c, "#ff0000");
  assert.equal(RT.styleOfRange(c, 0, 5, 16, "#000000").c, "#000000");
  assert.equal(RT.styleOfRange(c, 0, 11, 16, "#000000").c, null);
  assert.equal(RT.styleOfRange(c, 8, 8, 16, "#000000").c, "#ff0000");            // a caret uses the character before it
});
test("typing continues in the colour of the text before; an explicit style wins", () => {
  const c = RT.applyStyle(C("ab"), 0, 2, { c: "#ff0000" });
  assert.deepEqual(RT.replaceRange(c, 2, 2, "c").runs, [{ s: "abc", c: "#ff0000" }]);
  assert.deepEqual(RT.replaceRange(c, 2, 2, "c", { c: "#0000ff" }).runs, [{ s: "ab", c: "#ff0000" }, { s: "c", c: "#0000ff" }]);
  assert.deepEqual(RT.replaceRange(c, 2, 2, "c", {}).runs, [{ s: "ab", c: "#ff0000" }, { s: "c" }]);
});
test("slice / concat and page flow keep colours", () => {
  const c = C("one two\nthree", [{ s: "one ", c: "#ff0000" }, { s: "two\nthree" }]);
  assert.deepEqual(RT.concat(RT.slice(c, 0, 4), RT.slice(c, 4, 13), true), c);
  const item = F.withContent(text({ w: 200 }), c);
  assert.deepEqual(RT.contentOf(item).runs, c.runs);
});
test("scaling a box keeps colours", () => {
  const c = RT.scaleSizes(C("ab", [{ s: "a", z: 10, c: "#ff0000" }, { s: "b" }]), 2);
  assert.deepEqual(c.runs, [{ s: "a", z: 20, c: "#ff0000" }, { s: "b" }]);
});

test("layout: differently coloured pieces are separate pieces, the same colour is one; lines and offsets do not depend on colour", () => {
  const plain = text({ text: "red green", size: 10 });
  const col = { ...plain, runs: [{ s: "red ", c: "#ff0000" }, { s: "green", c: "#00ff00" }] }, same = { ...plain, runs: [{ s: "red ", c: "#ff0000" }, { s: "green", c: "#ff0000" }] };
  const Lp = R.layoutRich(plain).lines[0], Lc = R.layoutRich(col).lines[0], Ls = R.layoutRich(same).lines[0];
  assert.equal(Lc.segs.length, 2); assert.deepEqual(Lc.segs.map((s) => s.st.c), ["#ff0000", "#00ff00"]);
  assert.equal(Ls.segs.length, 1);
  assert.equal(Lc.w, Lp.w); assert.equal(Lc.start, Lp.start); assert.equal(Lc.end, Lp.end);
  assert.equal(R.caretAt(col, 4).x, R.caretAt(plain, 4).x);
});
test("Persian + English in several colours: the pieces keep their colour in visual order", () => {
  const d = text({ text: "سلام hello", size: 10, dir: "rtl", align: "right", runs: [{ s: "سلام ", c: "#ff0000" }, { s: "hello", c: "#0000ff" }] }), ln = R.layoutRich(d).lines[0];
  assert.equal(ln.segs.length, 2); assert.ok(ln.vis && ln.vis.length >= 2);
  assert.deepEqual([...new Set(ln.vis.map((p) => p.seg.st.c))].sort(), ["#0000ff", "#ff0000"]);
});

// a recording canvas: which colour every piece of text is drawn with
function record(d) {
  const calls = [], ctx = new Proxy({ fillStyle: "", font: "", textAlign: "", direction: "", textBaseline: "" }, {
    get: (t, k) => (k in t ? t[k] : (...a) => { if (k === "fillText") calls.push({ text: a[0], fill: t.fillStyle }); }),
    set: (t, k, v) => { t[k] = v; return true; } });
  R.drawRichText(ctx, d); return calls;
}
test("drawing: every piece in its own colour; the box colour, opacity and brightness still apply", () => {
  const d = text({ text: "red green plain", size: 10, color: "#000000", alpha: 128, runs: [{ s: "red ", c: "#ff0000" }, { s: "green ", c: "#00ff00" }, { s: "plain" }] });
  const calls = record(d), byText = Object.fromEntries(calls.map((c) => [c.text.trim(), c.fill]));
  assert.equal(byText.red, "rgba(255,0,0,0.5020)"); assert.equal(byText.green, "rgba(0,255,0,0.5020)"); assert.equal(byText.plain, "rgba(0,0,0,0.5020)");
  const b = record({ ...d, alpha: 255, bright: 100 }); assert.ok(b.every((c) => c.fill.startsWith("rgba(255,255,255")));       // brightness +100 = white, also for coloured pieces
});
test("a list bullet takes the colour of the first piece of its line", () => {
  const calls = record(text({ text: "item", size: 10, lists: ["b"], runs: [{ s: "item", c: "#ff0000" }] }));
  assert.equal(calls[0].text, "\u2022"); assert.equal(calls[0].fill, "rgba(255,0,0,1.0000)");
});
test("blackboard: neutral run colours adapt like the box colour, others are left alone; the stored text is not changed", () => {
  const d = text({ text: "ab", color: "#1a1a1a", runs: [{ s: "a", c: "#000000" }, { s: "b", c: "#ff0000" }] }), t = R.themed(d, "dark");
  assert.deepEqual(t.runs, [{ s: "a", c: "#f2f2f2" }, { s: "b", c: "#ff0000" }]); assert.equal(t.color, "#f2f2f2");
  assert.equal(d.runs[0].c, "#000000"); assert.equal(R.themed(d, "dark"), t);        // cached copy
  assert.equal(R.themed(d, "light"), d);
});
