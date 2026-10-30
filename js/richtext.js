// Rich text content model (pure, no DOM). A text box keeps its plain text in `text` (so older versions still read it) plus optional formatting:
//   runs   [{s: "chars", b?: 1, i?: 1, u?: 1, z?: size, c?: "#rrggbb"}, ...]   the text cut into styled pieces; the pieces joined are exactly `text`
//   lists  ["b" | "n" | "", ...]                                 per paragraph (paragraphs are separated by "\n"): bullet / numbered
// "content" below = {text, runs: array|null, lists: array|null}. Nothing here modifies its arguments.
const STYLE_KEYS = ["b", "i", "u", "z", "c"];
export const MAX_RUN_SIZE = 400, MIN_RUN_SIZE = 4;
const roundZ = (z) => Math.round(Math.min(MAX_RUN_SIZE, Math.max(MIN_RUN_SIZE, z)) * 10) / 10;
/** A text colour as "#rrggbb" (lower case), or null when it is not one. */
export const normColor = (v) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v ?? "").trim()); if (!m) return null; let h = m[1].toLowerCase(); if (h.length === 3) h = [...h].map((x) => x + x).join(""); return "#" + h; };
const sameStyle = (a, b) => STYLE_KEYS.every((k) => (k === "z" ? a.z === b.z : (a[k] || 0) === (b[k] || 0)));
const styleOf = (r) => { const o = {}; if (r.b) o.b = 1; if (r.i) o.i = 1; if (r.u) o.u = 1; if (r.z !== undefined && r.z !== null) o.z = roundZ(+r.z); const c = normColor(r.c); if (c) o.c = c; return o; };
export const isPlain = (st) => !st || (!st.b && !st.i && !st.u && (st.z === undefined || st.z === null) && !normColor(st.c));

/** Validate runs against the text. Returns merged clean runs, or null when there is no formatting (or the runs do not match the text). */
export function cleanRuns(runs, text) {
  if (!Array.isArray(runs)) return null;
  const out = []; let len = 0;
  for (const r of runs) {
    if (!r || typeof r.s !== "string") return null;
    if (!r.s) continue;
    const o = { s: r.s, ...styleOf(r) };
    len += r.s.length;
    const last = out[out.length - 1];
    if (last && sameStyle(last, o)) last.s += o.s; else out.push(o);
  }
  if (len !== text.length || out.map((r) => r.s).join("") !== text) return null;
  return out.every((r) => isPlain(r)) ? null : out;
}
export const paragraphCount = (text) => { let n = 1; for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n++; return n; };
/** [{start, end}] of every paragraph (end excludes the "\n"). Always at least one (empty) paragraph. */
export function paragraphRanges(text) {
  const out = []; let s = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i)) { out.push({ start: s, end: i }); s = ++i; }
  out.push({ start: s, end: text.length });
  return out;
}
export const paragraphIndexAt = (text, off) => { let n = 0; for (let i = text.indexOf("\n"); i >= 0 && i < off; i = text.indexOf("\n", i + 1)) n++; return n; };
export function cleanLists(lists, text) {
  if (!Array.isArray(lists)) return null;
  const n = paragraphCount(text), out = [];
  for (let i = 0; i < n; i++) out.push(lists[i] === "b" || lists[i] === "n" ? lists[i] : "");
  return out.some(Boolean) ? out : null;
}
export const listAt = (content, p) => (content.lists && content.lists[p]) || "";
export const makeContent = (text, runs = null, lists = null) => ({ text, runs: cleanRuns(runs, text), lists: cleanLists(lists, text) });
export const contentOf = (d) => makeContent(String(d.text ?? ""), d.runs, d.lists);
/** Runs covering the whole text (a single plain run when there is no formatting). */
export function allRuns(c) {
  if (c.runs) return c.runs;
  return c.text ? [{ s: c.text }] : [];
}
/** Runs with their character ranges: [{s, start, end, b?, i?, u?, z?}] */
export function spans(c) {
  let p = 0;
  return allRuns(c).map((r) => { const o = { ...r, start: p, end: p + r.s.length }; p = o.end; return o; });
}
function sliceRuns(c, a, b) {
  const out = [];
  for (const r of spans(c)) {
    const s = Math.max(a, r.start), e = Math.min(b, r.end);
    if (s < e) out.push({ ...styleOf(r), s: r.s.slice(s - r.start, e - r.start) });
  }
  return out;
}
/** The part [a, b) of a content. Paragraph formats of the paragraphs it touches are kept. */
export function slice(c, a, b) {
  const text = c.text.slice(a, b), p0 = paragraphIndexAt(c.text, a);
  return makeContent(text, c.runs ? sliceRuns(c, a, b) : null, c.lists ? c.lists.slice(p0, p0 + paragraphCount(text)) : null);
}
/** c1 followed by c2. joined: the two are one paragraph (c2 continues c1's last paragraph); otherwise c2 starts a new paragraph. */
export function concat(c1, c2, joined = false) {
  const text = c1.text + (joined ? "" : "\n") + c2.text;
  let runs = null;
  if (c1.runs || c2.runs) {
    const r = [...allRuns(c1)];
    if (!joined) r.push({ s: "\n" });
    r.push(...allRuns(c2));
    runs = r;
  }
  let lists = null;
  if (c1.lists || c2.lists) {
    const n1 = paragraphCount(c1.text), n2 = paragraphCount(c2.text), l1 = Array.from({ length: n1 }, (_, i) => listAt(c1, i)), l2 = Array.from({ length: n2 }, (_, i) => listAt(c2, i));
    lists = joined ? [...l1, ...l2.slice(1)] : [...l1, ...l2];
  }
  return makeContent(text, runs, lists);
}
/** Style of the text [a, b): each key is true / false, or null when mixed; z = the size, c = the colour (baseColor where none is set), or null when mixed. A collapsed range uses the character before it. */
export function styleOfRange(c, a, b, baseSize = null, baseColor = null) {
  if (a === b) a = Math.max(0, a - 1), b = Math.min(c.text.length, a + 1);
  const sp = spans(c).filter((r) => r.start < b && r.end > a);
  const res = { b: false, i: false, u: false, z: baseSize, c: baseColor };
  if (!sp.length) return res;
  for (const k of ["b", "i", "u"]) { const all = sp.every((r) => r[k]), none = sp.every((r) => !r[k]); res[k] = all ? true : none ? false : null; }
  const zs = new Set(sp.map((r) => (r.z === undefined ? baseSize : r.z)));
  res.z = zs.size === 1 ? [...zs][0] : null;
  const cs = new Set(sp.map((r) => r.c || baseColor));                       // (colour: the box's colour where no run colour is set; null when mixed)
  res.c = cs.size === 1 ? [...cs][0] : null;
  return res;
}
/** Apply style changes to [a, b). patch: {b?: bool, i?: bool, u?: bool, z?: number | null (null = back to the box size), c?: "#rrggbb" | null (null = back to the box colour)}. */
export function applyStyle(c, a, b, patch) {
  if (a >= b) return c;
  const out = [];
  for (const r of spans(c)) {
    if (r.end <= a || r.start >= b) { out.push({ ...styleOf(r), s: r.s }); continue; }
    const s = Math.max(a, r.start), e = Math.min(b, r.end), st = styleOf(r);
    if (s > r.start) out.push({ ...st, s: r.s.slice(0, s - r.start) });
    const n = { ...st };
    for (const k of ["b", "i", "u"]) if (k in patch) { if (patch[k]) n[k] = 1; else delete n[k]; }
    if ("z" in patch) { if (patch.z === null || patch.z === undefined) delete n.z; else n.z = roundZ(patch.z); }
    if ("c" in patch) { const col = normColor(patch.c); if (col) n.c = col; else delete n.c; }
    out.push({ ...n, s: r.s.slice(s - r.start, e - r.start) });
    if (e < r.end) out.push({ ...st, s: r.s.slice(e - r.start) });
  }
  return makeContent(c.text, out, c.lists);
}
/** Replace [a, b) by `str` (typed with `style`, default: the style of the text before). The paragraph formats follow the paragraphs. */
export function replaceRange(c, a, b, str, style = null) {
  const text = c.text.slice(0, a) + str + c.text.slice(b), p0 = paragraphIndexAt(c.text, a), removed = paragraphCount(c.text.slice(a, b)) - 1, added = paragraphCount(str) - 1;
  const st = style || (a > 0 ? styleOfChar(c, a - 1) : {});
  let runs = null;
  if (c.runs || !isPlain(st)) {
    const parts = [...sliceRuns(c, 0, a)];
    if (str) parts.push({ ...styleOf(st), s: str });
    parts.push(...sliceRuns(c, b, c.text.length));
    runs = parts;
  }
  let lists = null;
  if (c.lists) {
    const n = paragraphCount(c.text), l = Array.from({ length: n }, (_, i) => listAt(c, i)), kind = l[p0] || "";
    l.splice(p0 + 1, removed, ...Array.from({ length: added }, () => kind));      // new paragraphs made by Enter keep the list of the paragraph they were split from
    lists = l;
  }
  return makeContent(text, runs, lists);
}
export function styleOfChar(c, i) { for (const r of spans(c)) if (i >= r.start && i < r.end) return styleOf(r); return {}; }
/** Toggle a list type on every paragraph touched by [a, b]: when all of them already have it, it is removed. */
export function toggleList(c, a, b, type) {
  const p0 = paragraphIndexAt(c.text, a), p1 = paragraphIndexAt(c.text, Math.max(a, b)), n = paragraphCount(c.text);
  const l = Array.from({ length: n }, (_, i) => listAt(c, i)), all = l.slice(p0, p1 + 1).every((x) => x === type);
  for (let p = p0; p <= p1; p++) l[p] = all ? "" : type;
  return makeContent(c.text, c.runs, l);
}
/** Set the whole box to one style (used for a selected, not edited, text box). */
export const applyAll = (c, patch) => applyStyle(c, 0, c.text.length, patch);
/** Scale every run size (resizing a text box scales its text). */
export function scaleSizes(c, k) {
  if (!c.runs) return c;
  return makeContent(c.text, c.runs.map((r) => (r.z === undefined ? r : { ...r, z: roundZ(r.z * k) })), c.lists);
}
/** Largest font size used in [a, b) (the box size where nothing is set). */
export function maxSize(c, a, b, baseSize) {
  let m = 0;
  for (const r of spans(c)) if (r.start < b && r.end > a) m = Math.max(m, r.z ?? baseSize);
  return m || baseSize;
}
