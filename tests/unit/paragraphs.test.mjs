import test from "node:test"; import assert from "node:assert/strict";
import { paragraphBreaks, buildPageText } from "../../js/pdftext.js";
import { contentTokens, paragraphSpans, passagesOf, noteUnits, findMatches } from "../../js/similar.js";

// ------------------------------------------------------------ paragraph detection from the layout of a page
const L = (i, text, o = {}) => ({ base: 100 + i * 14 + (o.extra || 0), x0: o.x0 ?? 60, x1: o.x1 ?? 540, fh: o.fh ?? 11, rtl: !!o.rtl, text });
test("a wrapped paragraph is NOT cut at its line breaks; a blank gap starts a new paragraph", () => {
  const lines = [L(0, "The handshake opens a connection and"), L(1, "both hosts agree on the sequence numbers"), L(2, "before any data is sent at all."), L(3, "A second paragraph begins here", { extra: 12 }), L(4, "and continues on the next line.", { extra: 12 })];
  assert.deepEqual([...paragraphBreaks(lines)], [3]);
});
test("a heading (another type size) is its own block; a list marker starts a new item", () => {
  const lines = [L(0, "Some text that ends here."), L(1, "Chapter heading", { fh: 18 }), L(2, "Body text again follows."), L(3, "• first item"), L(4, "• second item"), L(5, "continues the second item")];
  assert.deepEqual([...paragraphBreaks(lines)].sort(), [1, 2, 3, 4]);
});
test("a first-line indent after a sentence end, and a short last line followed by a new sentence, start paragraphs; a continuing line does not", () => {
  const lines = [L(0, "The first paragraph is long enough to fill the line completely and then"), L(1, "ends here.", { x1: 150 }), L(2, "Next paragraph is indented.", { x0: 80 }), L(3, "and goes on across the page here without ending a sentence"), L(4, "and finally ends here.", { x1: 200 }), L(5, "Another one starts, with no indent at all but after a short line.")];
  assert.deepEqual([...paragraphBreaks(lines)].sort(), [2, 5]);
});
test("a line ending in a hyphen and a lower-case start continue the paragraph", () => {
  const lines = [L(0, "The connec-"), L(1, "tion is established by three steps. Then"), L(2, "data flows in both directions.")];
  assert.equal(paragraphBreaks(lines).size, 0);
});
test("right-to-left: the indent is on the right; a back-up on the page (another column) is a break", () => {
  const fa = (i, t, o = {}) => L(i, t, { rtl: true, ...o });
  const lines = [fa(0, "این یک بند است که تمام می‌شود."), fa(1, "بند دوم با تورفتگی آغاز می‌شود", { x1: 520 }), fa(2, "و ادامه دارد"), { ...L(0, "ستون دیگر"), base: 60 }];
  assert.deepEqual([...paragraphBreaks(lines)].sort(), [1, 3]);
});
// the extractor itself: pdf.js text items with positions
const item = (str, x, y, o = {}) => ({ str, transform: [o.fh ?? 11, 0, 0, o.fh ?? 11, x, y], width: str.length * 5, dir: o.dir || "ltr", hasEOL: false });
test("buildPageText puts a blank line between paragraphs and nowhere else, and every word box still points at its word", () => {
  const vp = [1, 0, 0, -1, 0, 842], items = [item("The handshake opens a connection", 60, 700), item("and the hosts agree.", 60, 686), item("Second paragraph starts here", 60, 660), item("and wraps to the next line.", 60, 646)];
  const { text, words } = buildPageText(items, vp);
  assert.equal(text, "The handshake opens a connection\nand the hosts agree.\n\nSecond paragraph starts here\nand wraps to the next line.");
  for (const w of words) assert.ok(/^\S+$/.test(text.slice(w.start, w.end)), JSON.stringify(text.slice(w.start, w.end)));
  assert.equal(text.slice(words.find((w) => text.slice(w.start, w.end) === "Second").start).slice(0, 6), "Second");
});

// ------------------------------------------------------------ paragraphs in the matcher
test("paragraph spans: blank lines; with none, a short line that ends a sentence (and not every line break)", () => {
  const hard = "One paragraph here.\nStill the first.\n\nSecond one starts.";
  assert.deepEqual(paragraphSpans(hard).map(([a, b]) => hard.slice(a, b)), ["One paragraph here.\nStill the first.", "Second one starts."]);
  const wrapped = "The quick brown fox jumps over the lazy dog and keeps running far away\nthrough the forest until the night.\nA new paragraph starts after that short line and goes on for a while longer\nand it ends well.";
  const sp = paragraphSpans(wrapped); assert.equal(sp.length, 2); assert.ok(wrapped.slice(...sp[1]).startsWith("A new paragraph"));
  assert.equal(paragraphSpans("one line only\nsecond line\nthird line").length, 1);
});
test("passages never cross a paragraph; every passage lies inside one paragraph; a short paragraph is offered whole", () => {
  const text = "Alpha one is here. Alpha two follows. Alpha three ends the paragraph.\n\nBeta one starts again. Beta two goes on. Beta three is last.\n\nGamma alone.";
  const ps = passagesOf(text), pars = ps.paragraphs; assert.equal(pars.length, 3);
  for (const p of ps) { const q = pars[p.para]; assert.ok(p.s >= q.s && p.e <= q.e, text.slice(p.s, p.e)); }
  assert.ok(!ps.some((p) => /three ends[\s\S]*Beta/.test(text.slice(p.s, p.e))));
});
test("hyphenated line ends, soft hyphens and ligatures do not break matching", () => {
  const same = (a, b) => assert.deepEqual(contentTokens(a).map((t) => t.t), contentTokens(b).map((t) => t.t));
  same("the connec-\ntion is reliable", "the connection is reliable"); same("the connec\u00ADtion", "the connection"); same("the ﬁnal oﬃce", "the final office");
  assert.notDeepEqual(contentTokens("well-\nKnown").map((t) => t.t), contentTokens("wellknown").map((t) => t.t), "an upper-case continuation is a compound, not a broken word");
});

// ------------------------------------------------------------ choosing the paragraph
const W = (n) => { let s = ""; n += 1000; while (n > 0) { s += String.fromCharCode(97 + (n % 26)); n = Math.floor(n / 26); } return s; };
const sentence = (i, extra = "") => Array.from({ length: 7 }, (_, k) => W(i * 7 + k)).join(" ") + (extra ? " " + extra : "") + ".";
const paragraph = (from, n, extra) => Array.from({ length: n }, (_, k) => sentence(from + k, extra)).join(" ");
const PAGE_PARAS = [paragraph(0, 4), paragraph(10, 4), paragraph(20, 4), paragraph(30, 4), paragraph(40, 4)];
const PAGE = PAGE_PARAS.join("\n\n");
const match = async (note, text = PAGE, floor = 0.3) => { const r = await findMatches(noteUnits(note), passagesOf(text), { floor }); return r.map((x) => ({ ...x, shown: text.slice(x.passage.s, x.passage.e) })); };
const inPara = (shown, k) => PAGE_PARAS[k].includes(shown.replace(/\n/g, " ")) || PAGE_PARAS[k].replace(/\s+/g, " ").includes(shown.replace(/\s+/g, " "));

test("a note about one sentence is matched to that sentence's paragraph and to the sentence itself, not to a neighbour", async () => {
  const [r] = await match(sentence(22).replace(".", ""));
  assert.ok(r, "matched"); assert.ok(inPara(r.shown, 2), r.shown); assert.equal(r.shown.replace(/\s+/g, " "), sentence(22));
});
test("a few shared words with the next paragraph do not pull the link there", async () => {
  const trap = PAGE_PARAS.slice(); trap[3] = paragraph(30, 4, W(21) + " " + W(22));       // paragraph 3 repeats two words of sentence 22
  const text = trap.join("\\n\\n".replace(/\\\\n/g, "\n"));
  const [r] = await match(sentence(22).replace(".", ""), trap.join("\n\n"));
  assert.ok(r); assert.ok(trap[2].replace(/\s+/g, " ").includes(r.shown.replace(/\s+/g, " ")), r.shown);
});
test("a note that paraphrases a whole paragraph links to (nearly) the whole paragraph, not to a part of it and not beyond", async () => {
  const note = PAGE_PARAS[1].replace(/\./g, "");
  const [r] = await match(note); assert.ok(r); assert.ok(inPara(r.shown, 1));
  assert.ok(r.shown.length > 0.6 * PAGE_PARAS[1].length, `${r.shown.length} of ${PAGE_PARAS[1].length}`);
});
test("the exact relevant sentence is found inside a long paragraph (not the whole paragraph)", async () => {
  const long = paragraph(50, 8), text = [PAGE_PARAS[0], long, PAGE_PARAS[2]].join("\n\n");
  const [r] = await match(sentence(54).replace(".", ""), text); assert.ok(r);
  assert.equal(r.shown.replace(/\s+/g, " "), sentence(54));
});
test("when two paragraphs say the same thing, there is no single place: no link", async () => {
  const text = [PAGE_PARAS[0], PAGE_PARAS[1], PAGE_PARAS[1], PAGE_PARAS[2]].join("\n\n");
  assert.deepEqual(await match(sentence(12).replace(".", ""), text), []);
});
test("a note whose words are scattered over paragraphs (a few words in each) is not linked", async () => {
  const note = [W(3), W(73), W(143), W(213), W(283)].join(" ");              // one word from each of the five paragraphs
  assert.deepEqual(await match(note), []);
});
test("unusual line breaks: text wrapped at 30 characters with hyphenation and no blank lines still finds the right place", async () => {
  const wrap = (t) => { let out = "", line = ""; for (const w of t.split(" ")) { if ((line + " " + w).trim().length > 30) { const cut = Math.max(3, 30 - line.length - 1); if (w.length > 8 && cut < w.length - 2 && cut > 2) { out += (line + " " + w.slice(0, cut) + "-").trim() + "\n"; line = w.slice(cut); } else { out += line + "\n"; line = w; } } else line = (line + " " + w).trim(); } return out + line; };
  const text = PAGE_PARAS.map(wrap).join("\n");                       // no blank lines at all
  const [r] = await match(sentence(32).replace(".", ""), text); assert.ok(r, "found"); const flat = r.shown.replace(/-\n/g, "").replace(/\s+/g, " ");
  assert.ok(sentence(32).includes(flat) || flat.includes(sentence(32).slice(0, 40)) || PAGE_PARAS[3].includes(flat), flat);
  assert.ok(!flat.includes(W(21 * 7)) && !flat.includes(W(40 * 7)), "nothing from paragraphs far away");
});
test("Persian: a note is matched to its own paragraph among Persian paragraphs", async () => {
  const fa = ["شبکه عصبی از لایه‌های متعدد نورون ساخته می‌شود و آموزش آن با داده انجام می‌گیرد. هر لایه ورودی را به خروجی تبدیل می‌کند.", "پایگاه داده اطلاعات را در جدول‌هایی با سطر و ستون نگه می‌دارد. زبان پرس‌وجو رکوردها را بازیابی می‌کند.", "درخت جستجوی دودویی عناصر را مرتب نگه می‌دارد و جستجو را سریع می‌کند. هر گره دو فرزند دارد."];
  const text = fa.join("\n\n"), r = await findMatches(noteUnits("پایگاه داده اطلاعات را در جدول با سطر و ستون ذخیره می‌کند"), passagesOf(text), { floor: 0.3 });
  assert.equal(r.length, 1); assert.ok(fa[1].includes(text.slice(r[0].passage.s, r[0].passage.e)), text.slice(r[0].passage.s, r[0].passage.e));
});
