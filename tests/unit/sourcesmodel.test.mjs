import test from "node:test"; import assert from "node:assert/strict";
import { LinkStore } from "../../js/links.js";
import { forPdfPage, forItems, needsSource } from "../../js/sourcesmodel.js";

const DOC = "ab".repeat(16);
const pdf = (page, extra = {}) => ({ k: "pdf", doc: DOC, name: "net.pdf", page, pv: "p", ...extra });
const item = (id) => ({ k: "item", id, slot: "nb", pv: id });
const mk = () => {
  const s = new LinkStore();
  s.add(item("n1"), pdf(4, { quote: { text: "three way handshake", rects: [[10, 200, 100, 220]] } }));
  s.add(item("n2"), pdf(4, { rect: [10, 50, 90, 80] }));
  s.add(item("n3"), pdf(4));
  s.add(item("n4"), pdf(9)); s.add(item("n5"), pdf(9)); s.add(item("n1"), item("n6"));
  return s;
};
test("a PDF page lists the notes linked to it, top of the page first, with the passage", () => {
  const { rows } = forPdfPage(mk(), { doc: DOC, page: 4, pageCount: 20 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.shape), ["page", "region", "text"], "whole page first (-1), then by position on the page");
  assert.equal(rows[2].quote, "three way handshake"); assert.equal(rows[2].other.id, "n1");
});
test("other pages of the document that have notes are listed with their counts (not this page, not pages beyond the document)", () => {
  assert.deepEqual(forPdfPage(mk(), { doc: DOC, page: 4, pageCount: 20 }).others, [{ page: 9, count: 2 }]);
  assert.deepEqual(forPdfPage(mk(), { doc: DOC, page: 4, pageCount: 5 }).others, []);
  assert.deepEqual(forPdfPage(mk(), { doc: DOC, page: 9, pageCount: 20 }).others, [{ page: 4, count: 3 }]);
});
test("a notebook page: items that cite a source (backlinks to notes included), and long notes with no source yet", () => {
  const items = [{ t: "text", id: "n1", text: "TCP handshake notes with enough words to matter" }, { t: "text", text: "A long note without any source at all, so it is listed" }, { t: "text", text: "short" }, { t: "rect" }];
  const r = forItems(mk(), items);
  assert.equal(r.cited.length, 1); assert.equal(r.cited[0].links.length, 2);
  assert.deepEqual(r.cited[0].links.map((x) => x.other.k).sort(), ["item", "pdf"]);
  assert.equal(r.unsourced.length, 1); assert.ok(r.unsourced[0].preview.startsWith("A long note"));
});
test("what counts as a note that needs a source", () => {
  const t = (d) => d.text;
  assert.ok(needsSource({ t: "text", text: "x".repeat(30) }, t)); assert.ok(!needsSource({ t: "text", text: "short" }, t)); assert.ok(!needsSource({ t: "pen", text: "x".repeat(30) }, t));
});

import { pairOf, cardsForPdfPage, cardsForItems, cardsForAll } from "../../js/sourcesmodel.js";
test("a link is a card with a source (PDF end) and a note, whichever way round it was made", () => {
  const s = new LinkStore(); s.add(item("n1"), pdf(4)); s.add(pdf(5), item("n2")); s.add(item("n3"), item("n4"));
  const [a, b, c] = s.all().map(pairOf);
  assert.equal(a.pdf.page, 4); assert.equal(a.note.id, "n1"); assert.equal(b.pdf.page, 5); assert.equal(b.note.id, "n2");
  assert.equal(c.pdf, null); assert.equal(c.note.id, "n3"); assert.equal(c.related.id, "n4");
});
test("scope PDF page: its cards, top to bottom; scope notebook page: the cards of the notes on it (each link once) and the notes without a source; scope everything: grouped by PDF page", () => {
  const s = mk();
  assert.deepEqual(cardsForPdfPage(s, { doc: DOC, page: 4 }).map((c) => c.note.id), ["n3", "n2", "n1"], "whole page, region, passage");
  const items = [{ t: "text", id: "n1", text: "TCP handshake notes with enough words to matter" }, { t: "text", id: "n6", text: "The note that n1 is linked to, with enough words" }, { t: "text", text: "A long note without any source at all, so it is listed" }];
  const r = cardsForItems(s, items); assert.equal(r.cards.length, 2, "n1 to the PDF and n1 to n6: the n1-n6 link is counted once"); assert.equal(r.unsourced.length, 1);
  const all = cardsForAll(s); assert.deepEqual(all.groups.map((g) => [g.page, g.cards.length]), [[4, 3], [9, 2]]); assert.equal(all.notes.length, 1);
});
