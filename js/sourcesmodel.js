// What the Sources panel shows for the place the user is working in, computed from the link store only (no DOM), so it can be tested on its own.
//   - on a PDF page:      the notes linked to this page (whole page, a region or a passage), and which other pages of the document have notes
//   - on a notebook/board page: which items cite a source (and which source), backlinks included, and which text notes have no source yet
import { anchorKey, anchorShape } from "./links.js";

const NOTE_KINDS = new Set(["text", "note", "node"]);
/** Does this item carry enough text to be worth a source? (a few words, not a label) */
export const needsSource = (d, textOf) => NOTE_KINDS.has(d.t) && String(textOf(d) || "").replace(/\s+/g, " ").trim().length >= 25;

/** The notes that point at one page of a PDF. */
export function forPdfPage(store, { doc, page, pageCount = 0 }) {
  const rows = [], key = "p:" + doc + ":" + page;
  for (const link of store.forPdfPage(doc, page)) {
    const own = anchorKey(link.a) === key ? link.a : link.b, other = own === link.a ? link.b : link.a;
    rows.push({ link, own, other, shape: anchorShape(own), quote: own.quote ? own.quote.text : "" });
  }
  rows.sort((x, y) => (x.own.rect ? x.own.rect[1] : x.own.quote && x.own.quote.rects[0] ? x.own.quote.rects[0][1] : -1) - (y.own.rect ? y.own.rect[1] : y.own.quote && y.own.quote.rects[0] ? y.own.quote.rects[0][1] : -1));   // top to bottom on the page
  const counts = new Map();
  for (const l of store.all()) for (const e of [l.a, l.b]) if (e.k === "pdf" && e.doc === doc && e.page !== page && (!pageCount || e.page < pageCount)) counts.set(e.page, (counts.get(e.page) || 0) + 1);
  const others = [...counts].sort((a, b) => a[0] - b[0]).map(([p, n]) => ({ page: p, count: n }));
  return { rows, others };
}

/** The sources used by the items of a notebook / board page, and the notes still without one. */
export function forItems(store, items, { textOf = (d) => d.text, previewOf = (d) => textOf(d) } = {}) {
  const cited = [], unsourced = [];
  items.forEach((d, index) => {
    const links = d.id ? store.forItem(d.id) : [];
    if (links.length) cited.push({ item: d, index, links: links.map((link) => ({ link, other: store.otherEnd(link, { k: "item", id: d.id }) })) });
    else if (needsSource(d, textOf)) unsourced.push({ item: d, index, preview: previewOf(d) });
  });
  return { cited, unsourced };
}

// ------------------------------------------------------------------ the cards of the Sources tab
/** A link as a card: the PDF end (the source) and the note end, whichever way round it was made. A link between two notes has no source: { pdf: null, note, related }. */
export function pairOf(link) {
  const ends = [link.a, link.b], pdf = ends.find((e) => e.k === "pdf") || null;
  if (pdf) return { link, pdf, note: ends.find((e) => e !== pdf) || null, related: null };
  return { link, pdf: null, note: link.a, related: link.b };
}
const yOf = (p) => (p.pdf ? (p.pdf.rect ? p.pdf.rect[1] : p.pdf.quote && p.pdf.quote.rects[0] ? p.pdf.quote.rects[0][1] : -1) : 0);

/** Scope "PDF page": every link to that page of that PDF, top of the page first. */
export function cardsForPdfPage(store, { doc, page }) {
  return store.forPdfPage(doc, page).map(pairOf).sort((a, b) => yOf(a) - yOf(b));
}
/** Scope "Notebook page": every link of the notes (items with an id) on that page, in page order; plus the long notes that have none. */
export function cardsForItems(store, items, opts) {
  const { cited, unsourced } = forItems(store, items, opts), cards = [], seen = new Set();
  for (const c of cited) for (const { link } of c.links) if (!seen.has(link.id)) { seen.add(link.id); cards.push(pairOf(link)); }
  return { cards, unsourced };
}
/** Scope "Everything": all links, those to a PDF grouped by document and page (in page order), links between notes last. */
export function cardsForAll(store) {
  const groups = new Map(), notes = [];
  for (const l of store.all()) {
    const p = pairOf(l);
    if (!p.pdf) { notes.push(p); continue; }
    const key = p.pdf.doc + ":" + String(p.pdf.page).padStart(6, "0");
    if (!groups.has(key)) groups.set(key, { name: p.pdf.name, page: p.pdf.page, doc: p.pdf.doc, cards: [] });
    groups.get(key).cards.push(p);
  }
  const out = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, g]) => ({ ...g, cards: g.cards.sort((a, b) => yOf(a) - yOf(b)) }));
  return { groups: out, notes };
}
