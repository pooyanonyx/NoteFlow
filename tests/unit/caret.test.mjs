// Caret, selection and hit testing are computed from the same layout that draws the text (render.js), so they can be tested without a browser.
// The stub measurer makes every character size / 2 wide: positions are exact numbers.
import test from "node:test"; import assert from "node:assert/strict";
import { useStubMeasure, text } from "./helpers.mjs";
const R = useStubMeasure();
const near = (a, b, m = "") => assert.ok(Math.abs(a - b) < 1e-6, `${m} expected ${b}, got ${a}`);
const X0 = (d) => d.x + R.TEXT_PAD;                                   // left end of the text area
const AR = "\u0627\u0628\u062c\u062f";                                // four Arabic-script letters (right-to-left, 5 pt each at size 10)

test("left-aligned English: the caret is behind the letters before it", () => {
  const d = text({ size: 10, text: "hello" });
  for (let k = 0; k <= 5; k++) near(R.caretAt(d, k).x, X0(d) + k * 5, "offset " + k);
  const c = R.caretAt(d, 3); assert.ok(c.bottom > c.top); assert.equal(c.line, 0);
});
test("right-to-left text, right aligned: the caret moves left as letters are added, offset 0 is at the right edge", () => {
  const d = text({ size: 10, w: 200, dir: "rtl", align: "right", text: AR }), right = X0(d) + (200 - 8);
  for (let k = 0; k <= 4; k++) near(R.caretAt(d, k).x, right - k * 5, "offset " + k);
});
test("alignment: left / centre / right place the end of the text where the canvas draws it", () => {
  const w = 200, inner = w - 8;
  for (const [align, endX] of [["left", 4 + 20 + 25], ["right", 4 + inner], ["center", 4 + (inner - 25) / 2 + 25]]) {
    const d = text({ x: 20, size: 10, w, dir: "ltr", align, text: "abcde" });
    near(R.caretAt(d, 5).x, 20 + endX - (align === "left" ? 20 : 0), align);
  }
});
test("a wrapped line: the caret at the break belongs to the line that starts there; hanging spaces stay behind", () => {
  const d = text({ w: 88, size: 10, text: "aaa bbb ccc ddd eee" });         // line 1 = "aaa bbb ccc ddd " (16 chars), line 2 = "eee"
  assert.equal(R.caretAt(d, 16).line, 1); near(R.caretAt(d, 16).x, X0(d));
  assert.equal(R.caretAt(d, 15).line, 0); near(R.caretAt(d, 19).x, X0(d) + 15);
  const y0 = R.caretAt(d, 0).top, y1 = R.caretAt(d, 16).top; assert.ok(y1 > y0 + 10, "second line is lower");
});
test("an empty line, and the start of a paragraph", () => {
  const d = text({ size: 10, text: "ab\n\ncd" });
  assert.equal(R.caretAt(d, 3).line, 1); near(R.caretAt(d, 3).x, X0(d));
  assert.equal(R.caretAt(d, 4).line, 2); near(R.caretAt(d, 5).x, X0(d) + 5);
});
test("lists: the caret stands right of the indent", () => {
  const d = text({ size: 10, text: "ab", lists: ["b"] });
  near(R.caretAt(d, 0).x, X0(d) + R.listIndent(10)); near(R.caretAt(d, 2).x, X0(d) + R.listIndent(10) + 10);
});
test("mixed sizes: the caret is as tall as the letters before it", () => {
  const d = text({ size: 10, text: "ab", runs: [{ s: "a" }, { s: "b", z: 40 }] });
  const small = R.caretAt(d, 1), big = R.caretAt(d, 2);
  assert.equal(big.size, 40); assert.equal(small.size, 10); near(big.x, X0(d) + 5 + 20);
});
test("mixed directions: Persian inside English, positions follow the visual order", () => {
  const d = text({ size: 10, w: 400, dir: "ltr", align: "left", text: "ab " + AR + " cd" });       // ab_ ABJD _cd   (the Arabic run is reversed visually)
  const x = (k) => R.caretAt(d, k).x - X0(d);
  // visual: "ab " = 0..15, the Arabic run (reversed) = 15..35, " cd" = 35..50. The caret trails the letter before it:
  near(x(0), 0); near(x(3), 15);                                    // behind the space in front of the Arabic run
  near(x(4), 30); near(x(5), 25); near(x(6), 20); near(x(7), 15);   // each Arabic letter moves it one step LEFT, to the left end of the run
  near(x(8), 40); near(x(10), 50);                                  // then on in the English part
});
test("selection rectangles: one per line, the whole width of the selected letters", () => {
  const d = text({ w: 88, size: 10, text: "aaa bbb ccc ddd eee" });
  const r = R.selectionRects(d, 2, 18);
  assert.equal(r.length, 2); near(r[0].x0, X0(d) + 10); near(r[0].x1, X0(d) + 75); near(r[1].x0, X0(d)); near(r[1].x1, X0(d) + 10);
  assert.ok(r[1].top > r[0].top);
  assert.deepEqual(R.selectionRects(d, 5, 5), []);
});
test("selection rectangles of right-to-left text and of a selected paragraph break", () => {
  const d = text({ size: 10, w: 200, dir: "rtl", align: "right", text: AR + "\nx" }), right = X0(d) + 192;
  const r = R.selectionRects(d, 1, 3); assert.equal(r.length, 1); near(r[0].x0, right - 15); near(r[0].x1, right - 5);
  const all = R.selectionRects(d, 0, 6); assert.equal(all.length, 2); assert.ok(all[0].x0 < right - 20 - 1, "the break is shown after the last letter");
});
test("hit testing: every caret position maps back to its offset (English, Persian, mixed, wrapped)", () => {
  for (const d of [text({ size: 10, text: "hello world" }), text({ size: 10, w: 200, dir: "rtl", align: "right", text: AR + " " + AR }), text({ size: 10, w: 400, text: "ab " + AR + " cd" }), text({ w: 88, size: 10, text: "aaa bbb ccc ddd eee" })]) {
    const n = String(d.text).length;
    for (let o = 0; o <= n; o++) {
      const c = R.caretAt(d, o), back = R.offsetAtPoint(d, c.x, (c.top + c.bottom) / 2);
      near(R.caretAt(d, back).x, c.x, `${JSON.stringify(d.text)} offset ${o} -> ${back}`);
    }
  }
});
test("hit testing: below / above the text, and halfway between two letters", () => {
  const d = text({ size: 10, text: "abcd\nefgh" });
  assert.equal(R.offsetAtPoint(d, X0(d) + 100, 1000), 9); assert.equal(R.offsetAtPoint(d, X0(d) - 50, -50), 0);
  assert.equal(R.offsetAtPoint(d, X0(d) + 7, d.y + 6), 1); assert.equal(R.offsetAtPoint(d, X0(d) + 8, d.y + 6), 2);
});
test("Up / Down keep the horizontal position, Home / End stay on the line", () => {
  const d = text({ size: 10, text: "abcdefgh\nabc\nabcdefgh" });
  const x = R.caretAt(d, 7).x;
  assert.equal(R.offsetVertical(d, 7, 1, x), 12);                 // the short line: as far right as it goes
  assert.equal(R.offsetVertical(d, 12, 1, x), 20);                // and back to the far column on the next line
  assert.equal(R.offsetVertical(d, 0, -1, 0), null); assert.equal(R.offsetVertical(d, 20, 1, 0), null);
  assert.deepEqual(R.lineRange(d, 5), { start: 0, end: 8 }); assert.deepEqual(R.lineRange(d, 11), { start: 9, end: 12 });
  const w = text({ w: 88, size: 10, text: "aaa bbb ccc ddd eee" });
  assert.deepEqual(R.lineRange(w, 3), { start: 0, end: 15 });     // a wrapped line ends in front of its hanging space
});
