import test from "node:test"; import assert from "node:assert/strict";
import { useStubMeasure, text } from "./helpers.mjs";
const R = useStubMeasure();
const lines = (d) => R.layoutRich(d).lines.map((l) => l.segs.map((s) => s.draw ?? s.text).join(""));

test("words wrap at the box width and offsets map back to the text", () => {
  const d = text({ w: 88, size: 10, text: "aaa bbb ccc ddd eee" });         // 80 px of text per line = 16 chars
  assert.deepEqual(lines(d), ["aaa bbb ccc ddd", "eee"]);
  const L = R.layoutRich(d); assert.equal(L.lines[1].start, 16); assert.equal(L.lines[0].end, 16);
});
test("a very long word is broken between letters, a hyphen is a break opportunity", () => {
  assert.deepEqual(lines(text({ w: 48, size: 10, text: "abcdefghijklmnop" })), ["abcdefgh", "ijklmnop"]);
  assert.deepEqual(lines(text({ w: 68, size: 10, text: "aaaa bbbb-cccc" })), ["aaaa bbbb-", "cccc"]);
});
test("trailing spaces hang: they never create an empty line", () => {
  assert.deepEqual(lines(text({ w: 48, size: 10, text: "abcdefgh " })), ["abcdefgh"]);
});
test("ruled text: every line takes whole rules; baseline stands on the rule", () => {
  const d = text({ ruled: true, size: 30, text: "a\nb" }), L = R.layoutRich(d);
  assert.equal(L.lines[0].h, 48); assert.equal(L.lines[0].base, 47); assert.equal(L.height, 96);
  assert.equal(R.layoutRich(text({ ruled: true, rp: 32, size: 16, text: "x" })).lines[0].h, 32);
});
test("mixed sizes: the line is as high as its biggest letters", () => {
  const d = text({ size: 10, text: "ab", runs: [{ s: "a" }, { s: "b", z: 40 }] }), L = R.layoutRich(d);
  assert.equal(L.lines[0].h, 50); assert.equal(L.lines[0].segs.length, 2); assert.ok(L.lines[0].vis.length === 2);
});
test("lists: bullets, numbering that restarts after a plain paragraph, indent", () => {
  const d = text({ text: "a\nb\nc\nd", lists: ["n", "n", "", "n"] }), L = R.layoutRich(d);
  assert.deepEqual(L.lines.map((l) => (l.marker ? l.marker.text : null)), ["1.", "2.", null, "1."]);
  assert.equal(L.lines[0].indent, R.listIndent(16));
  assert.equal(R.layoutRich(text({ text: "a", lists: ["b"] })).lines[0].marker.text, "\u2022");
});
test("a continued paragraph shows no marker and numbering carries on", () => {
  const d = text({ text: "rest\nnext", lists: ["n", "n"], cont: true, fl: "x", ns: 3 }), L = R.layoutRich(d);
  assert.deepEqual(L.lines.map((l) => (l.marker ? l.marker.text : null)), [null, "4."]);
});
test("direction per paragraph for old boxes, explicit direction when set", () => {
  const L = R.layoutRich(text({ text: "hello\nسلام" }));
  assert.deepEqual(L.lines.map((l) => l.rtl), [false, true]);
  assert.deepEqual(R.layoutRich(text({ text: "hello", dir: "rtl", align: "right" })).lines.map((l) => l.rtl), [true]);
});
test("layout is cached per item and unaffected by an unrelated copy", () => {
  const d = text({ text: "cache me" }); assert.equal(R.layoutRich(d), R.layoutRich(d));
  assert.notEqual(R.layoutRich({ ...d }), R.layoutRich(d));
});

test("a word wider than the line breaks where the SHAPED text stops fitting, not by summing single letters", async () => {
  const { useKernedMeasure } = await import("./helpers.mjs");
  const K = useKernedMeasure();
  // 10 px letters, "AV"/"VA" pairs 4 px tighter: "AVAVAVA" (7 letters) is 46 px, summing letters would say 70 px and break after 4
  const d = text({ w: 58, size: 20, text: "AVAVAVAVAVAV" }), L = K.layoutRich(d);      // inner width 50
  assert.equal(L.lines[0].segs.map((s) => s.text).join(""), "AVAVAVA");
  assert.equal(L.lines.map((l) => l.segs.map((s) => s.text).join("")).join(""), "AVAVAVAVAVAV");     // nothing lost, offsets continuous
  assert.ok(L.lines.every((l, i) => i === 0 || l.start === L.lines[i - 1].end));
  useStubMeasure();
});
test("a word that does not fit the rest of a line moves to its own line first, then breaks", () => {
  const L = R.layoutRich(text({ w: 68, size: 10, text: "ab cdefghijklmnopqrstu" }));            // inner 60 = 12 letters
  assert.deepEqual(L.lines.map((l) => l.segs.map((s) => s.draw ?? s.text).join("")), ["ab", "cdefghijklmn", "opqrstu"]);
});
test("styled pieces inside a long word keep their offsets when it breaks", () => {
  const d = text({ w: 48, size: 10, text: "abcdefghijklmnop", runs: [{ s: "abcdef" }, { s: "ghijkl", b: 1 }, { s: "mnop" }] }), L = R.layoutRich(d);
  assert.equal(L.lines.map((l) => l.segs.map((s) => s.text).join("")).join(""), "abcdefghijklmnop");
  assert.ok(L.lines.every((l) => l.segs.every((s) => d.text.slice(s.start, s.end) === s.text)));
});
