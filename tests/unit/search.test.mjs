import test from "node:test"; import assert from "node:assert/strict";
import { runSearch, segmentsOf, findAll, snippet, locate } from "../../js/search.js";
import { buildPageText, rectsForRange } from "../../js/pdftext.js";

const T = (text, o = {}) => ({ t: "text", x: 10, y: 50, text, color: "#000000", size: 16, ...o });
const prov = (id, kind, pages, extra = {}) => ({ id, kind, title: () => id, count: () => pages.length, items: (i) => pages[i], ...extra });
const run = (provs, q, o) => runSearch(provs, q, o);

test("finds text in notebook pages, text boxes, notes, mind map nodes and connector labels; order = page, then top to bottom", async () => {
  const nb = prov("nb", "nb", [[T("Network basics", { y: 300 }), { t: "note", x: 5, y: 20, w: 100, h: 50, text: "my network note", color: "#fff59d", size: 14 }], [T("nothing")],
    [{ t: "node", id: "n1", x1: 0, y1: 0, x2: 10, y2: 10, text: "Network", color: "#000000", w: 2, size: 18 }, { t: "conn", from: "n1", to: "n1", label: "network link" }]]);
  const r = (await run([nb], "NETWORK")).results;
  assert.deepEqual(r.map((x) => [x.page, x.kind]), [[0, "note"], [0, "text"], [2, "node"], [2, "label"]]);
  assert.equal(r[0].snippet.match, "network"); assert.equal(r[0].docTitle, "nb");
});
test("partial words by default, whole words on request", async () => {
  const nb = prov("nb", "nb", [[T("network networking subnetwork")]]);
  assert.equal((await run([nb], "network")).results.length, 3);
  assert.equal((await run([nb], "network", { whole: true })).results.length, 1);
});
test("Persian: letter forms, ZWNJ, digits and marks do not matter; RTL text is found", async () => {
  const nb = prov("nb", "nb", [[T("شبکه‌های کامپیوتری"), T("صفحه ۲۰ کتاب"), T("علي رفت")]]);
  assert.equal((await run([nb], "شبکههای")).results.length, 1);          // ZWNJ typed or not
  assert.equal((await run([nb], "صفحه 20")).results.length, 1);          // Latin digits find Persian digits
  assert.equal((await run([nb], "علی")).results.length, 1);              // Persian yeh finds Arabic yeh
  assert.equal((await run([nb], "کامپیوتری", { whole: true })).results.length, 1);
});
test("several matches in one text are separate results with their own position in the ORIGINAL text", async () => {
  const src = "Net  work: network, NETWORK";
  const r = (await run([prov("nb", "nb", [[T(src)]])], "network")).results;
  assert.equal(r.length, 2); assert.deepEqual(r.map((x) => x.occ), [0, 1]);
  assert.deepEqual(r.map((x) => src.slice(x.a, x.b)), ["network", "NETWORK"]);
  assert.equal(new Set(r.map((x) => x.key)).size, 2);
});
test("results always follow the current content: edited / deleted / moved pages, no duplicates", async () => {
  const p1 = [T("alpha network")], p2 = [T("beta")];
  const pages = [p1, p2], nb = prov("nb", "nb", pages);
  assert.equal((await run([nb], "network")).results.length, 1);
  pages[1] = [T("beta network")];                                       // page 2 edited (a new items array, as the app always does)
  let r = (await run([nb], "network")).results; assert.deepEqual(r.map((x) => x.page), [0, 1]);
  pages.splice(0, 1);                                                   // page 1 deleted
  r = (await run([nb], "network")).results; assert.deepEqual(r.map((x) => x.page), [0]);
  assert.equal(r[0].item.text, "beta network");
  pages.reverse(); pages.push([T("network")]); r = (await run([nb], "network")).results; assert.equal(r.length, 2);
});
test("unchanged pages are not indexed again", async () => {
  const items = [T("one network")]; segmentsOf(items);
  assert.equal(segmentsOf(items), segmentsOf(items));
});
test("PDF text: pages come from the store; pages not read yet are reported as pending", async () => {
  const store = { pages: ["Intro to network security", "Firewalls", undefined, "شبکه امن"], get(i) { return this.pages[i]; } };
  const pdf = prov("pdf", "pdf", [[], [], [], []], { store });
  let r = await run([pdf], "network"); assert.deepEqual(r.results.map((x) => [x.page, x.kind]), [[0, "pdf"]]); assert.equal(r.pending, 1);
  assert.equal((await run([pdf], "شبکه")).results[0].page, 3);
  store.pages[2] = "a network again"; r = await run([pdf], "network"); assert.deepEqual(r.results.map((x) => x.page), [0, 2]); assert.equal(r.pending, 0);
});
test("annotations on a PDF page (text boxes written on the PDF) are found too, next to the PDF's own text", async () => {
  const store = { pages: ["network"], get(i) { return this.pages[i]; } };
  const r = (await run([prov("pdf", "pdf", [[T("my network note")]], { store })], "network")).results;
  assert.deepEqual(r.map((x) => x.kind).sort(), ["pdf", "text"]);
});
test("scopes limit where to look; an empty query finds nothing; the result list is capped", async () => {
  const a = prov("nb", "nb", [[T("x network")]]), b = prov("board", "board", [[T("y network")]]);
  assert.deepEqual((await run([a, b], "network", { scopes: new Set(["board"]) })).results.map((x) => x.doc), ["board"]);
  assert.equal((await run([a], "   ")).results.length, 0);
  const big = prov("nb", "nb", Array.from({ length: 700 }, () => [T("hit")]));
  const r = await run([big], "hit"); assert.equal(r.results.length, 500); assert.equal(r.truncated, true);
});
test("a search can be cancelled", async () => {
  const big = prov("nb", "nb", Array.from({ length: 150000 }, (_, i) => [T("text number " + i)]));
  const r = await runSearch([big], "number", {}, { cancelled: () => true });          // (the scan yields every ~10 ms; the first yield sees the cancel)
  assert.equal(r.cancelled, true); assert.ok(r.results.length < 150000);
});
test("snippet and locate", () => {
  const s = snippet("a ".repeat(40) + "NETWORK" + " b".repeat(40), 80, 87);
  assert.equal(s.match, "NETWORK"); assert.ok(s.before.startsWith("…") && s.after.endsWith("…") && s.before.length < 50);
  assert.deepEqual(locate("x NETwork y network z", "network", {}, 0), [2, 9]);
  assert.deepEqual(locate("x NETwork y network z", "network", {}, 1), [12, 19]);
  assert.equal(locate("x Net  work", "network"), null);                            // (a space inside a word is not ignored)
  assert.equal(locate("none", "network"), null);
  assert.deepEqual(findAll("aaaa", "aa"), [0, 2]);
});

// ---- PDF page text from pdf.js text items
const item = (str, x, y, w, extra = {}) => ({ str, transform: [12, 0, 0, 12, x, y], width: w, height: 12, ...extra });
const VP = [1, 0, 0, -1, 0, 800];                                              // pdf.js viewport at scale 1 (y goes down)
test("page text: lines, spaces between separate runs, offsets and boxes of words", () => {
  const d = buildPageText([item("Network", 50, 700, 42), item("security", 96, 700, 48), item("Second line", 50, 680, 66)], VP);
  assert.equal(d.text, "Network security\nSecond line");
  const w = d.words.find((x) => d.text.slice(x.start, x.end) === "security");
  assert.ok(w.x0 >= 95 && w.x1 <= 145 && w.y0 < 100 + 0 && w.line === 0);
  assert.equal(d.words.filter((x) => x.line === 1).length, 2);
});
test("rectsForRange: one box per line, only the matched part of a word", () => {
  const d = buildPageText([item("security", 100, 700, 80), item("tail", 100, 680, 40)], VP);
  const r = rectsForRange(d, 0, 4);                                            // "secu"
  assert.equal(r.length, 1); assert.ok(Math.abs(r[0][0] - 100) < 0.01 && Math.abs(r[0][2] - 140) < 0.01);
  assert.equal(rectsForRange(d, 3, 13).length, 2);                             // across the line break
});
test("page text: right-to-left runs and end-of-line marks", () => {
  const d = buildPageText([item("سلام", 200, 700, 40, { dir: "rtl" }), item("", 0, 0, 0, { hasEOL: true }), item("دنیا", 200, 680, 40, { dir: "rtl" })], VP);
  assert.equal(d.text, "سلام\nدنیا");
  const r = rectsForRange(d, 0, 4); assert.ok(r[0][0] >= 199 && r[0][2] <= 241);
});
test("page text: junk items never throw", () => {
  assert.deepEqual(buildPageText([null, {}, { str: 5 }, { str: "a" }], VP), { text: "", words: [] });
});
