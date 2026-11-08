// Runs the text matching of Smart linking off the main thread (see matcher.js): cutting a PDF page into passages and comparing every note with every passage can take
// a noticeable time on a big page or a slow device, and must never make typing or scrolling stutter.
import { passagesOf, findMatches } from "./similar.js";

self.onmessage = async (e) => {
  const { id, A, B, text, floor } = e.data;
  try {
    const bUnits = typeof text === "string" ? passagesOf(text) : B;                  // a PDF page arrives as its text; other surfaces as ready units
    const res = await findMatches(A, bUnits, { floor });
    self.postMessage({ id, ok: true, res: res.map((r) => ({ ...r, note: { _i: r.note._i }, passage: { s: r.passage.s, e: r.passage.e, toks: r.passage.toks, nums: r.passage.nums, narrowed: r.passage.narrowed, _i: r.passage._i } })) });
  } catch (err) { self.postMessage({ id, ok: false, error: String((err && err.message) || err) }); }
};
