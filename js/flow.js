// Automatic continuation of long text across notebook pages (pure; layout and page geometry are passed in, so it runs in unit tests).
//
// When the text of a box reaches the bottom of its page, the lines that do not fit move to a new box at the top of the next page
// (a new page is added when there is none). The pieces form a "chain": every piece carries the same `fl` id, a piece that continues the
// last paragraph of the previous one has `cont: true`, and `ns` keeps a numbered list counting across the page break.
// Editing any piece joins the chain back into one text, applies the change and cuts it again, so text also flows back when lines are deleted.
import * as RT from "./richtext.js";

export const TEXT_PAD = 4;
const STRIP = ["fl", "cont", "ns"];
const bare = (d) => { const o = { ...d }; for (const k of STRIP) delete o[k]; return o; };

/** Cut a text item into the part that fits above `bottom` (page y) and the rest. Returns null when everything fits. At least one line stays. */
export function splitItem(item, layout, bottom) {
  const L = layout(item); let y = item.y + TEXT_PAD, fit = 0;
  for (const ln of L.lines) { if (fit >= 1 && y + ln.h > bottom + 0.01) break; y += ln.h; fit++; }
  if (fit >= L.lines.length) return null;
  const text = item.text, ln = L.lines[fit], off = ln.start, soft = text[off - 1] !== "\n", content = RT.contentOf(item);
  const head = RT.slice(content, 0, soft ? off : off - 1), tail = RT.slice(content, off, text.length);
  const ns = soft ? ln.num : (L.lines[fit - 1].num || 0);
  return { head, tail, soft, ns, lines: fit };
}
export const withContent = (item, c) => {
  const o = { ...item, text: c.text }; delete o.runs; delete o.lists;
  if (c.runs) o.runs = c.runs; if (c.lists) o.lists = c.lists;
  return o;
};
/** Position of the first piece of the chain that contains the item at (pi, idx). */
export function chainHead(pages, pi, idx) {
  let item = pages[pi].items[idx];
  while (item && item.fl && pi > 0) {
    const j = pages[pi - 1].items.findIndex((d) => d.t === "text" && d.fl === item.fl);
    if (j < 0) break;
    pi--; idx = j; item = pages[pi].items[idx];
  }
  return { pi, idx };
}
/** Pieces of the chain starting at (pi, idx): [{pi, idx, item}] on consecutive pages. */
export function chainPieces(pages, pi, idx) {
  const first = pages[pi].items[idx], out = [{ pi, idx, item: first }];
  if (!first || !first.fl) return out;
  for (let p = pi + 1; p < pages.length; p++) {
    const j = pages[p].items.findIndex((d) => d.t === "text" && d.fl === first.fl);
    if (j < 0) break;
    out.push({ pi: p, idx: j, item: pages[p].items[j] });
  }
  return out;
}
/**
 * Cut the text of the chain whose first piece is at (hp, hi) into pieces again.
 *   env: { layout(item), geoOf(page) -> geometry with .flow ({top, bottom} or null), .ruled, .pitch; newPage(prevPage) -> page; newId() }
 *   override: {pi, idx, item}  an item that replaces a piece (the box being edited); idx null = a new box that is not on its page yet
 * Returns {pages, pieces: [{pi, idx, start, len}], changed: [page indexes]}; pages that did not change are the same objects.
 */
export function reflowChain(pages, hp, hi, env, override = null) {
  const at = (pi, idx) => (override && override.pi === pi && override.idx === idx ? override.item : pages[pi].items[idx]);
  const old = hi === null ? [] : chainPieces(pages, hp, hi).map((c) => ({ ...c, item: at(c.pi, c.idx) }));
  const headItem = hi === null ? override.item : old[0].item;
  if (hi === null) old.push({ pi: hp, idx: null, item: headItem });
  let merged = null, prevK = -1;                                         // pieces that were emptied are left out: the text after them slides up
  const keep = old.map((c) => c.item.text.length > 0);
  if (!keep.some(Boolean)) keep[0] = true;
  old.forEach((c, k) => {
    if (!keep[k]) return;
    const content = RT.contentOf(c.item);
    merged = merged ? RT.concat(merged, content, c.item.cont === true && prevK === k - 1) : content; prevK = k;
  });
  const tpl = bare(headItem); delete tpl.text; delete tpl.runs; delete tpl.lists;
  const out = []; let item = withContent({ ...tpl }, merged), pi = hp, startAt = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const page = pi < pages.length ? pages[pi] : env.newPage(pages[pages.length - 1]);
    const geo = env.geoOf(page);
    if (pi > hp) {                                                        // a continuation piece starts at the top of its page
      const flow = geo.flow || { top: 40 };
      item = { ...item, y: tpl.ruled ? flow.top - TEXT_PAD : flow.top };
      if (tpl.ruled && geo.ruled) { if (geo.pitch === 24) delete item.rp; else item.rp = geo.pitch; }
    }
    const sp = geo.flow ? splitItem(item, env.layout, geo.flow.bottom) : null;
    if (!sp) { out.push({ pi, item, start: startAt }); break; }
    const headPiece = withContent(item, sp.head);
    out.push({ pi, item: headPiece, start: startAt });
    startAt += sp.head.text.length + (sp.soft ? 0 : 1);
    item = withContent({ ...tpl }, sp.tail); item.cont = sp.soft || undefined; if (!item.cont) delete item.cont;
    if (sp.ns) item.ns = sp.ns;
    item.fl = true;                                                       // (replaced below)
    pi++;
  }
  const fl = headItem.fl || env.newId(), many = out.length > 1;
  const result = pages.slice(), changed = new Set(), clone = (p) => { if (!changed.has(p)) { changed.add(p); result[p] = { ...result[p], items: result[p].items.slice() }; } return result[p]; };
  while (result.length < out.length + hp) { result.push(env.newPage(result[result.length - 1])); changed.add(result.length - 1); }
  const pieces = [];
  for (const o of out) {
    let it = { ...o.item }; if (many) it.fl = fl; else for (const k of STRIP) delete it[k];
    if (!many) delete it.cont;
    const oldPiece = old.find((c) => c.pi === o.pi), pg = clone(o.pi);
    let idx;
    if (oldPiece && oldPiece.idx !== null) { idx = oldPiece.idx; pg.items[idx] = it; } else { idx = pg.items.length; pg.items.push(it); }
    pieces.push({ pi: o.pi, idx, start: o.start, len: it.text.length });
  }
  const lastPi = out[out.length - 1].pi;
  for (const c of old.slice().reverse()) {                                 // pieces that are no longer needed (text got shorter)
    if (c.pi > lastPi && c.idx !== null) { const pg = clone(c.pi); pg.items.splice(c.idx, 1); }
  }
  return { pages: result, pieces, changed: [...changed].sort((a, b) => a - b), fl: many ? fl : null };
}
/** The piece that holds logical character offset `off` of the chain, and the offset inside that piece. */
export function locate(pieces, off) {
  for (let k = pieces.length - 1; k >= 0; k--) if (off >= pieces[k].start) return { piece: pieces[k], local: Math.min(pieces[k].len, off - pieces[k].start) };
  return { piece: pieces[0], local: 0 };
}
/** Logical start offset of every piece (items in chain order): a piece that continues a paragraph starts right after the previous one, else after one "\n". */
export function pieceStarts(items) {
  const out = []; let pos = 0;
  items.forEach((d, k) => { if (k) pos += items[k - 1].text.length + (d.cont === true ? 0 : 1); out.push(pos); });
  return out;
}
