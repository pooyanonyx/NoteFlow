// Text similarity for Smart linking (pure, no DOM, no network, no models): "is this note about that passage of the PDF?"
//
// Conventional information-retrieval techniques, all local:
//   1. TOKENS   fold the text (textnorm.js: case, Persian / Arabic letter forms, digits, ZWNJ ...), split into words, drop stop words (English and Persian),
//               reduce each word to a light STEM (networks / networking -> network; شبکه‌ها -> شبکه). Stemming is deliberately conservative.
//   2. WEIGHTS  every word gets an IDF weight computed from the texts being compared (a word found in every passage says nothing; a rare long word says a lot).
//   3. SCORE    how much of the NOTE's weighted content is found in the PASSAGE (containment, so a short note inside a long passage still scores), where a
//               word counts fully when the stems are equal and partly when they share a long prefix (encrypt / encryption), times a focus factor that
//               lowers the score of a passage much bigger than what matched.
//   4. GUARDS   a note needs at least 4 content words; at least 3 words must match (2 of them exactly); the best passage must stand out from the next best,
//               unrelated one. These guards, not the threshold alone, are what keep wrong suggestions rare.
// What it cannot do: it compares WORDS. A note that means the same thing in entirely different words, handwriting, images, formulas and text in another
// language than the passage are not recognised.
import { normalize } from "./textnorm.js";

const EN_STOP = ("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from " +
  "further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the " +
  "their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours also etc via per eg ie may might must shall " +
  "one two three use used using like get got make made many much new").split(" ");
const FA_STOP = ("و در به از که این را با است برای آن یک هم تا یا اگر چه می شود شده های ها بر خود همه ما من تو او آنها ان اين اینکه همین بود باشد باید دارد دارند نیز هر پس بین روی زیر بعد قبل " +
  "کرد کنند کند کرده شدند شد بی تر ترین آنچه چون ولی اما نه مگر هیچ بسیار برخی دیگر همان چنین وی خواهد داشت دو سه یا هنگام طی طریق مانند مثل").split(" ");
const STOP = new Set([...EN_STOP, ...FA_STOP].map((w) => normalize(w)));
const WORD = /[\p{L}\p{N}]+/gu, ARABIC = /[\u0600-\u06FF]/;

function stemEn(w) {
  const n = w.length;
  if (n > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (n > 5 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (n > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) { w = w.slice(0, -3); if (/(.)\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1); }
  else if (w.length > 4 && w.endsWith("ed")) { w = w.slice(0, -2); if (/(.)\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1); }
  else if (w.length > 5 && w.endsWith("ly")) w = w.slice(0, -2);
  return w;
}
function stemFa(w) {
  for (const suf of ["های", "ها", "ات", "ان"]) if (w.length > suf.length + 2 && w.endsWith(suf)) return w.slice(0, -suf.length);
  if (w.length > 3 && w.endsWith("ی")) return w.slice(0, -1);
  return w;
}
/** The content words of a text: [{ t: stem, raw: the word as written (folded) }] in reading order. Stop words, 1-letter words and bare numbers are dropped. */
export function contentTokens(text) {
  const out = [];
  for (const m of normalize(text).matchAll(WORD)) {
    const w = m[0];
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    const t = ARABIC.test(w) ? stemFa(w) : stemEn(w);
    if (t.length >= 2 && !STOP.has(t)) out.push({ t, raw: w });
  }
  return out;
}

/** [start, end) of the sentences of a text (also splits at blank lines; a very long "sentence" without a full stop is cut at its line breaks). */
export function sentenceSpans(text) {
  const out = [], re = /[.!?؟…。]+["')\]»”]*\s+|\n\s*\n/g;
  const push = (s, e) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e - s < 3) return;
    if (text.slice(s, e).split(/\s+/).length > 60 && text.slice(s, e).includes("\n")) {         // (no punctuation: headings, lists)
      let a = s; for (let i = s; i < e; i++) if (text[i] === "\n") { push(a, i); a = i + 1; } if (a < e && a > s) { push(a, e); return; } if (a > s) return;
    }
    out.push([s, e]);
  };
  let start = 0;
  for (let m; (m = re.exec(text)); ) { push(start, m.index + m[0].length); start = m.index + m[0].length; }
  push(start, text.length);
  return out;
}
/** Passages of a text: every run of 1-3 consecutive sentences up to maxWords words. [{ s, e, toks }] (s, e = offsets in the text). */
export function passagesOf(text, { maxWords = 80, maxPassages = 360 } = {}) {
  const sent = sentenceSpans(text).map(([s, e]) => ({ s, e, toks: contentTokens(text.slice(s, e)), words: text.slice(s, e).split(/\s+/).length }));
  const out = [];
  for (let i = 0; i < sent.length && out.length < maxPassages; i++) {
    let toks = [], words = 0;
    for (let k = i; k < Math.min(sent.length, i + 3); k++) {
      words += sent[k].words; if (words > maxWords && k > i) break;
      toks = toks.concat(sent[k].toks);
      if (toks.length >= 3) out.push({ s: sent[i].s, e: sent[k].e, toks });
      if (out.length >= maxPassages) break;
    }
  }
  return out;
}
/** Units of a note's text: the text itself when it is one short block; a note of several lines (or a very long one) is judged line by line / sentence by sentence,
 *  so a note that mixes topics does not dilute the part that matches. [{ s, e, toks }] with at least 4 content words each. */
export function noteUnits(text, { maxUnits = 8 } = {}) {
  const whole = contentTokens(text), multi = /\n\s*\S/.test(text.trim());
  if (!(multi && whole.length > 20) && whole.length <= 90) return whole.length >= 4 ? [{ s: 0, e: text.length, toks: whole }] : [];
  const out = [];
  if (multi) {
    let pos = 0;
    for (const line of text.split(/\n+/)) {
      const s = text.indexOf(line, pos); pos = s + line.length;
      const toks = contentTokens(line);
      if (toks.length >= 4) out.push({ s, e: s + line.length, toks });
      if (out.length >= maxUnits) break;
    }
  } else for (const p of passagesOf(text, { maxWords: 60, maxPassages: maxUnits * 3 })) { if (p.toks.length >= 4) out.push(p); if (out.length >= maxUnits) break; }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const lenBoost = (t) => Math.min(1.5, 0.6 + t.length / 8);

/**
 * Best passage for every note. notes: [{ toks }], passages: [{ s, e, toks }] -> [{ note, passage, score, exact, fuzzy, shared: [raw words], second }]
 * One entry per note that has an acceptable best passage (see GUARDS above); the caller decides with the score what to do with it.
 * opts: { floor (lowest score worth returning, default .5), yieldMs }
 */
export async function findMatches(notes, passages, { floor = 0.5, yieldMs = 8 } = {}) {
  const out = [];
  if (!notes.length || !passages.length) return out;
  // IDF (rarity) is measured against the PASSAGES only: how distinctive a word is on the page being compared against. (Counting the notes too would lower the weight of
  // exactly the words that are in both, which are the signal.) With very few passages there is nothing to measure, so every word weighs the same.
  const df = new Map(), N = passages.length;
  for (const u of passages) for (const t of new Set(u.toks.map((x) => x.t))) df.set(t, (df.get(t) || 0) + 1);
  const w = (t) => (N < 8 ? 1 : Math.log(1 + (N + 1) / ((df.get(t) || 0) + 1))) * lenBoost(t);
  const vec = (toks) => { const m = new Map(); for (const x of toks) if (!m.has(x.t)) m.set(x.t, { w: w(x.t), raw: x.raw }); let tot = 0; for (const v of m.values()) tot += v.w; return { m, tot, pre: null }; };
  const P = passages.map((p) => ({ p, ...vec(p.toks) }));
  // inverted index: stem -> passages, 4-letter prefix -> stems (for the fuzzy part)
  const inv = new Map(), byPre = new Map();
  P.forEach((q, i) => { q.pre = new Map(); for (const t of q.m.keys()) { (inv.get(t) || inv.set(t, []).get(t)).push(i); const k = t.slice(0, 4); (q.pre.get(k) || q.pre.set(k, []).get(k)).push(t); if (!byPre.has(k)) byPre.set(k, new Set()); byPre.get(k).add(t); } });
  let t0 = performance.now();
  for (const note of notes) {
    if (performance.now() - t0 > yieldMs) { await tick(); t0 = performance.now(); }
    const A = vec(note.toks);
    if (A.m.size < 4) continue;
    const cand = new Map();                                                   // passage -> number of the note's words it has (exact or by prefix)
    for (const t of A.m.keys()) {
      const seen = new Set();
      for (const i of inv.get(t) || []) seen.add(i);
      for (const u of byPre.get(t.slice(0, 4)) || []) if (u !== t && commonPrefix(t, u) >= Math.max(4, Math.ceil(0.75 * Math.min(t.length, u.length)))) for (const i of inv.get(u)) seen.add(i);
      for (const i of seen) cand.set(i, (cand.get(i) || 0) + 1);
    }
    const scored = [];
    for (const [i, hits] of cand) {
      if (hits < 3) continue;
      const q = P[i]; let sw = 0, exact = 0, fuzzy = 0; const shared = [];
      for (const [t, a] of A.m) {
        if (q.m.has(t)) { sw += a.w; exact++; shared.push(a.raw); continue; }
        const bucket = q.pre.get(t.slice(0, 4));
        if (bucket && bucket.some((u) => commonPrefix(t, u) >= Math.max(4, Math.ceil(0.75 * Math.min(t.length, u.length))))) { sw += 0.6 * a.w; fuzzy++; shared.push(a.raw); }
      }
      if (exact < 2 || exact + fuzzy < 3) continue;
      const c = sw / A.tot, f = Math.min(1, sw / (0.3 * q.tot));
      scored.push({ i, score: c * (0.7 + 0.3 * f), exact, fuzzy, shared });
    }
    if (!scored.length) continue;
    scored.sort((x, y) => y.score - x.score || (passages[x.i].e - passages[x.i].s) - (passages[y.i].e - passages[y.i].s));
    const best = scored[0], bp = passages[best.i];
    if (best.score < floor) continue;
    const other = scored.find((x) => passages[x.i].e <= bp.s || passages[x.i].s >= bp.e);      // the best passage that does not overlap the winner
    const second = other ? other.score : 0;
    if (best.score - second < 0.06) continue;                                   // ambiguous: it fits several places about equally (even a perfect score), so none of them is "the" place
    out.push({ note, passage: bp, score: Math.round(best.score * 1000) / 1000, exact: best.exact, fuzzy: best.fuzzy, shared: best.shared.slice(0, 8), second: Math.round(second * 1000) / 1000 });
  }
  return out;
}
