// Selecting text in a PDF and quoting it: the text of a page is in READING ORDER (not in the order the PDF draws it), character boxes are exact, a selection is the range
// between two places of that text, and the quoted text keeps the selected words, their order and the paragraphs, and nothing else.
import test from "node:test"; import assert from "node:assert/strict";
import { buildPageText, caretAt, rectsForRange, quoteText } from "../../js/pdftext.js";

const VP = [1, 0, 0, -1, 0, 800];                                         // pdf.js viewport at scale 1 (y goes down)
const FH = 10, CW = 5;                                                    // type size, width of a character (a fixed width: positions are easy to reason about)
const item = (str, x, y, o = {}) => ({ str, transform: [FH, 0, 0, FH, x, 800 - y], width: o.width ?? str.length * CW, height: FH, dir: o.dir || "ltr", hasEOL: false, fontName: "f" });
/** A line of words drawn as ONE run starting at x. */
const run = (str, x, y, o) => item(str, x, y, o);
/** Select [from, to] (the texts of two words) the way the gesture does: the caret under the middle of the first / last character. */
const sel = (d, from, to) => {
  const a = d.text.indexOf(from), b = d.text.indexOf(to, a) + to.length, wa = d.words.find((w) => w.start === a), wb = d.words.find((w) => w.end === b);
  const pa = { x: (wa.cl[0] + wa.cr[0]) / 2 - 0.5, y: (wa.y0 + wa.y1) / 2 }, k = wb.cl.length - 1, pb = { x: (wb.cl[k] + wb.cr[k]) / 2 + 0.5, y: (wb.y0 + wb.y1) / 2 };
  const s = caretAt(d, pa), e = caretAt(d, pb); return quoteText(d, Math.min(s.off, e.off), Math.max(s.off, e.off));
};

test("a page drawn row by row across two columns is read column by column", () => {
  const L = ["alpha one is here and goes on", "alpha two follows now and goes on", "alpha three ends it and goes on", "alpha four is last and goes on"], R = ["beta one is here and goes on", "beta two follows now and goes on", "beta three ends it and goes on", "beta four is last and goes on"];
  const items = []; for (let i = 0; i < 4; i++) { items.push(run(L[i], 50, 100 + i * 14)); items.push(run(R[i], 300, 100 + i * 14)); }      // (drawn left, right, left, right ...)
  const d = buildPageText(items, VP);
  assert.equal(d.text, L.join("\n") + "\n" + R.join("\n"));
  assert.equal(sel(d, "two", "three"), "two follows now and goes on alpha three");                                          // inside the first column: the words in between, nothing from the other
  assert.equal(sel(d, "four", "beta"), "four is last and goes on beta");                                                    // across the columns: the end of the first, the start of the second
});
test("a heading over two columns, and a full-width line below them, keep their place", () => {
  const items = [run("A heading across the whole page here", 50, 60, { width: 400 }), run("left a1 words here", 50, 100), run("right b1 words here", 300, 100), run("left a2 words here", 50, 114), run("right b2 words here", 300, 114),
    run("left a3 words here", 50, 128), run("right b3 words here", 300, 128), run("A footer line across the whole page", 50, 180, { width: 400 })];
  const d = buildPageText(items, VP);
  assert.equal(d.text.replace(/\n+/g, "|"), "A heading across the whole page here|left a1 words here|left a2 words here|left a3 words here|right b1 words here|right b2 words here|right b3 words here|A footer line across the whole page");
});
test("words drawn in any order still make the line in the order they are on the page", () => {
  const items = [run("fox", 130, 100), run("The", 50, 100), run("quick", 70, 100), run("brown", 100, 100), run("jumps", 150, 100), run("over", 180, 100)];
  assert.equal(buildPageText(items, VP).text, "The quick brown fox jumps over");
});
test("a table is read row by row, not column by column", () => {
  const rows = [["Name", "Age", "City"], ["Ann", "31", "Oslo"], ["Bob", "27", "Rome"], ["Cy", "45", "Bern"]], items = [];
  rows.forEach((r, i) => r.forEach((c, j) => items.push(run(c, 50 + j * 90, 100 + i * 14))));
  assert.equal(buildPageText(items, VP).text, rows.map((r) => r.join(" ")).join("\n"));
});
test("the box of a character falls on the character (proportional widths) and a caret lands between the right two characters", () => {
  const widths = { i: 2, l: 2, m: 8 }, w = (ch) => widths[ch] ?? 5;
  const measure = (it) => { const cum = [0]; for (const ch of it.str) cum.push(cum[cum.length - 1] + w(ch)); return cum.map((v) => v / cum[cum.length - 1]); };
  const str = "mill film", total = [...str].reduce((a, ch) => a + w(ch), 0), d = buildPageText([item(str, 100, 100, { width: total })], VP, { measure });
  const film = d.words[1];
  assert.ok(Math.abs(film.cl[0] - (100 + w("m") + w("i") + 2 * w("l") + w(" ") + 0)) < 3.1);               // (f starts after "mill " )
  const r = rectsForRange(d, 5, 9);                                                                          // "film"
  assert.equal(r.length, 1); assert.ok(Math.abs(r[0][0] - film.cl[0]) < 0.01 && Math.abs(r[0][2] - (100 + total)) < 0.01);
  const x_i = (film.cl[1] + film.cr[1]) / 2;                                                                 // the middle of the "i" of film
  assert.equal(caretAt(d, { x: x_i - 0.4, y: 95 }).off, 6); assert.equal(caretAt(d, { x: x_i + 0.4, y: 95 }).off, 7);
});
test("a point far from any text is not a hit, but still has a caret (the end of a drag may be in the margin)", () => {
  const d = buildPageText([run("alpha beta", 100, 100), run("gamma delta", 100, 114)], VP);
  assert.equal(caretAt(d, { x: 20, y: 400 }).hit, false);
  assert.equal(caretAt(d, { x: 400, y: 100 - 3 }).off, "alpha beta".length);                                // right of the first line: its end
  assert.equal(caretAt(d, { x: 20, y: 114 - 3 }).off, "alpha beta\ngamma delta".indexOf("gamma"));          // left of the second line: its start
});
test("right-to-left: the first word is at the right, a drag from right to left selects in logical order", () => {
  const d = buildPageText([item("سلام", 200, 100, { dir: "rtl" }), item("دنیا", 150, 100, { dir: "rtl" })], VP);
  assert.equal(d.text, "سلام دنیا");
  const a = d.words[0], b = d.words[1];
  assert.ok(a.x0 > b.x0);
  const s = caretAt(d, { x: (a.cl[0] + a.cr[0]) / 2 + 0.3, y: 95 }), e = caretAt(d, { x: (b.cl[3] + b.cr[3]) / 2 - 0.3, y: 95 });
  assert.equal(s.off, 0); assert.equal(e.off, 9);
});
test("the quote: wrapped lines continue with a space, hyphenated words are joined, paragraphs and list items stay, nothing is added", () => {
  const d = { text: "The connec-\ntion is reliable and the\nsecond line ends.\n\nA new paragraph with ﬁne ﬂow.\n\n• one\n\n• two" };
  assert.equal(quoteText(d, 0, d.text.length), "The connection is reliable and the second line ends.\n\nA new paragraph with fine flow.\n\n• one\n• two");
  assert.equal(quoteText({ text: "well-\nKnown is a compound" }, 0, 25), "well- Known is a compound");                  // (an upper-case continuation is not a broken word)
  assert.equal(quoteText({ text: "a  b\u00A0c" }, 0, 6), "a b c");
  assert.equal(quoteText({ text: "x".repeat(2000) }, 0, 2000).length, 2000, "a long selection is not cut");
});
test("search still gets one text for the page: paragraph breaks, word boxes that point at their words", () => {
  const items = [run("First paragraph ends here.", 50, 100), run("More of the first one.", 50, 114), run("and more still ends here.", 50, 128), run("Second paragraph starts here", 50, 160), run("and wraps to the next line.", 50, 174)];
  const d = buildPageText(items, VP);
  for (const w of d.words) assert.ok(/^\S+$/.test(d.text.slice(w.start, w.end)));
  assert.ok(d.text.includes("\n\nSecond"));
});
