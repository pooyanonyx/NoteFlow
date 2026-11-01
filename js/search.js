// Global search (pure logic, no DOM): what is searchable, how it is indexed, how a query is run.
//
// Indexing strategy
//   The text of every page is folded once (textnorm.js) and kept as a "segment" list. Pages are never edited in place (an edit makes a new
//   items array, see model.js), so the segments of a page are cached by the identity of its items array: an unchanged page costs nothing, a
//   changed page is re-indexed alone, a deleted / moved page is simply not looked at / looked at in its new place. PDF pages come from a
//   PdfTextStore (pdftext.js), folded once per page and cached the same way. Nothing here needs to be "invalidated" by hand, and results are
//   always computed from the current content, so they can never be out of date or duplicated.
//   A query is a substring search over the folded segments, in small time slices so the page stays responsive on a big document, and can be
//   cancelled (the user typed another letter).
//
// A "document provider" (the app makes one per panel) is { id, kind: "nb" | "board" | "pdf", title(), count(), items(i), store? }.
import { normalize, normalizeWithMap, originalRange, isWholeWord } from "./textnorm.js";

export const KIND_LABEL = { text: "Text box", note: "Note", node: "Mind map", label: "Link label", pdf: "PDF text" };
const MAX_RESULTS = 500, MAX_PER_SEGMENT = 25, SLICE_MS = 10;

const segCache = new WeakMap();                       // items array -> segments
/** The searchable texts of one page: [{ item, kind, orig, norm, top, left }] in reading order (top to bottom, then left to right). */
export function segmentsOf(items) {
  let segs = segCache.get(items);
  if (segs) return segs;
  segs = [];
  for (const d of items) {
    let kind = null, orig = "";
    if (d.t === "text") { kind = "text"; orig = d.text; }
    else if (d.t === "note") { kind = "note"; orig = d.text; }
    else if (d.t === "node") { kind = "node"; orig = d.text; }
    else if (d.t === "conn" && d.label) { kind = "label"; orig = d.label; }
    if (!kind || typeof orig !== "string" || !orig.trim()) continue;
    const norm = normalize(orig);
    if (!norm) continue;
    segs.push({ item: d, kind, orig, norm, top: d.y ?? d.y1 ?? 0, left: d.x ?? d.x1 ?? 0 });
  }
  segs.sort((a, b) => a.top - b.top || a.left - b.left);
  segCache.set(items, segs);
  return segs;
}

const pdfNorms = new WeakMap();                       // PdfTextStore -> folded text per page
function pdfSegment(store, i) {
  const orig = store.get(i);
  if (typeof orig !== "string" || !orig) return null;
  let arr = pdfNorms.get(store);
  if (!arr) pdfNorms.set(store, (arr = []));
  if (!arr[i] || arr[i].orig !== orig) arr[i] = { orig, norm: normalize(orig) };
  return arr[i].norm ? { item: null, kind: "pdf", orig, norm: arr[i].norm } : null;
}

/** Start indexes of the matches of the folded query q in the folded text t (whole = on word boundaries only). */
export function findAll(t, q, whole = false, max = MAX_PER_SEGMENT) {
  const out = [];
  if (!q) return out;
  for (let at = t.indexOf(q); at >= 0 && out.length < max; at = t.indexOf(q, at + Math.max(1, q.length))) {
    if (!whole || isWholeWord(t, at, at + q.length)) out.push(at);
  }
  return out;
}

/** A short piece of the original text around [a, b): { before, match, after } (white space collapsed, cut between words, "…" where cut). */
export function snippet(orig, a, b, ctx = 38) {
  const clean = (s) => s.replace(/\s+/g, " ");
  let s0 = Math.max(0, a - ctx), s1 = Math.min(orig.length, b + ctx);
  if (s0 > 0) { const sp = orig.indexOf(" ", s0); if (sp >= 0 && sp < a) s0 = sp + 1; }
  if (s1 < orig.length) { const sp = orig.lastIndexOf(" ", s1); if (sp > b) s1 = sp; }
  return { before: (s0 > 0 ? "…" : "") + clean(orig.slice(s0, a)).replace(/^ /, ""), match: clean(orig.slice(a, b)),
    after: clean(orig.slice(b, s1)).replace(/ $/, "") + (s1 < orig.length ? "…" : "") };
}

/** Find the n-th match of the query in a text again (used when a result is opened: works on the CURRENT text of the item / PDF page). -> [start, end) in the original or null */
export function locate(orig, query, { whole = false } = {}, occ = 0) {
  const q = normalize(query), nm = normalizeWithMap(orig), hits = findAll(nm.t, q, whole, occ + 1);
  return hits.length > occ ? originalRange(nm, hits[occ], hits[occ] + q.length) : null;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
/**
 * Run a query. providers: [provider]; options: { whole, scopes: Set of "nb" | "board" | "pdf" }; ctl: { cancelled(): bool }.
 * -> { results, truncated, pending } where pending = pages of PDFs that are not read yet (the search will be run again as they arrive).
 * A result: { key, doc, docKind, docTitle, page, kind, item, occ, a, b, snippet }
 */
export async function runSearch(providers, query, { whole = false, scopes = null } = {}, ctl = { cancelled: () => false }) {
  const q = normalize(query), results = [];
  let truncated = false, pending = 0, t0 = performance.now();
  if (!q) return { results, truncated, pending };
  for (const prov of providers) {
    if (scopes && !scopes.has(prov.kind)) continue;
    const n = prov.count();
    for (let i = 0; i < n; i++) {
      if (performance.now() - t0 > SLICE_MS) { await tick(); if (ctl.cancelled()) return { results, truncated, pending, cancelled: true }; t0 = performance.now(); }
      const segs = [];
      if (prov.kind === "pdf" && prov.store) { const s = pdfSegment(prov.store, i); if (s) segs.push(s); else if (prov.store.get(i) === undefined) pending++; }
      const items = prov.items(i);
      if (items && items.length) segs.push(...segmentsOf(items));
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        if (seg.norm.length < q.length) continue;
        const hits = findAll(seg.norm, q, whole);
        if (!hits.length) continue;
        const nm = normalizeWithMap(seg.orig);                                   // (the map back to the original text is only made for texts that match)
        hits.forEach((h, occ) => {
          if (results.length >= MAX_RESULTS) { truncated = true; return; }
          const [a, b] = originalRange(nm, h, h + q.length);
          results.push({ key: `${prov.id}|${i}|${seg.kind}|${si}|${occ}|${a}`, doc: prov.id, docKind: prov.kind, docTitle: prov.title(), page: i,
            kind: seg.kind, item: seg.item, occ, a, b, snippet: snippet(seg.orig, a, b) });
        });
        if (truncated) return { results, truncated, pending };
      }
    }
  }
  return { results, truncated, pending };
}
