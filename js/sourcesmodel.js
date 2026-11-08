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
