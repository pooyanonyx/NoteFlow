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
import { EN_CONCEPTS, FA_CONCEPTS, EN_GENERIC, FA_GENERIC } from "./lexicon.js";

const EN_STOP = ("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from " +
  "further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the " +
  "their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours also etc via per eg ie may might must shall " +
  "one two three use used using like get got make made many much new").split(" ");
const FA_STOP = ("و در به از که این را با است برای آن یک هم تا یا اگر چه می شود شده های ها بر خود همه ما من تو او آنها ان اين اینکه همین بود باشد باید دارد دارند نیز هر پس بین روی زیر بعد قبل " +
  "کرد کنند کند کرده شدند شد بی تر ترین آنچه چون ولی اما نه مگر هیچ بسیار برخی دیگر همان چنین وی خواهد داشت دو سه یا هنگام طی طریق مانند مثل دهد دهند دهم دهید گیرد گیرند باشند بودند شوند شوم کنم کنی کنیم کنید داشتند نمود نمایند دارم دارید رخ").split(" ");
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
  if (w.length > 5 && w.endsWith("هاست")) w = w.slice(0, -2);                                           // قیمت‌هاست -> قیمتها (the verb "is" glued on)
  if (w.length > 6 && w.endsWith("ندگان")) return w.slice(0, -5) + "نده";                               // تولیدکنندگان -> تولیدکننده (the plural of -نده words)
  for (const suf of ["های", "ها", "ات", "ان"]) if (w.length > suf.length + 2 && w.endsWith(suf)) { w = w.slice(0, -suf.length); break; }
  if (w.length > 4 && w.endsWith("ایی")) return w.slice(0, -2);                                          // کالایی -> کالا (the indefinite ending after a vowel)
  if (w.length > 3 && w.endsWith("ی")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ترین")) return w.slice(0, -4);
  if (w.length > 4 && w.endsWith("تر")) return w.slice(0, -2);                                            // گران‌تر -> گران, بالاتر -> بالا
  return w;
}
/** The stem of a present / imperfect Persian verb whose "می‌" / "نمی‌" prefix was removed: personal endings go (می‌سازد, می‌سازند -> ساز). */
function stemFaVerb(w) {
  for (const suf of ["ند", "ید", "یم", "د", "م", "ی"]) if (w.length >= suf.length + 2 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
}
const VERB_MARK = "\u01C2", FA_VERB = /(?<![\p{L}])ن?می[\u200C\u200F ]+([\u0600-\u06FF\u200C]+)/gu;       // (a rare letter that marks "this word followed می‌")
// ---- word knowledge (lexicon.js): concept groups and generic words, keyed by the same stems the text is reduced to
const stemOf = (w) => (ARABIC.test(w) ? stemFa(w) : stemEn(w));
const ckey = (t) => (t.length > 4 && t.endsWith("e") && !ARABIC.test(t) ? t.slice(0, -1) : t);              // (organize / organized -> organiz)
const CONCEPT = new Map(); let gid = 0;
for (const block of [EN_CONCEPTS, FA_CONCEPTS]) for (const line of block.split("\n")) {
  const ws = line.trim().split(/\s+/).filter(Boolean); if (ws.length < 2) continue;
  gid++;
  for (const w of ws) { const k = ckey(stemOf(normalize(w))); let a = CONCEPT.get(k); if (!a) CONCEPT.set(k, (a = [])); if (!a.includes(gid)) a.push(gid); }
}
const GENERIC = new Set([...EN_GENERIC.split(/\s+/), ...FA_GENERIC.split(/\s+/)].filter(Boolean).map((w) => stemOf(normalize(w))));
/** The concept groups a (stemmed) word belongs to, or null. */
export const conceptsOf = (t) => CONCEPT.get(ckey(t)) || null;

/** The content words of a text: [{ t: stem, raw: the word as written (folded) }] in reading order. Stop words, 1-letter words and bare numbers are dropped. */
export function contentTokens(text) {
  const out = [];
  // Persian verbs: "می‌کند", "می‌سازند" are written with a prefix that is a separate word (or joined by a ZWNJ, which the folding removes, so it would become ONE long
  // word that nothing else matches and that only dilutes the score). The prefix is dropped and the verb marked; its personal ending is dropped below.
  const src = String(text ?? "").replace(FA_VERB, (_, v) => v + VERB_MARK);
  for (const m of normalize(src).matchAll(WORD)) {
    let w = m[0], verb = false;
    if (w.endsWith(VERB_MARK)) { w = w.slice(0, -1); verb = true; }
    else if (/^ن?می./.test(w) && w.length > 4 && STOP.has(w.replace(/^ن?می/, ""))) continue;          // (glued form of a stop verb: میکند, میشود)
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    const t = ARABIC.test(w) ? (verb ? stemFa(stemFaVerb(w)) : stemFa(w)) : stemEn(w);
    if (t.length >= 2 && !STOP.has(t)) out.push({ t, raw: w });
  }
  return out;
}

// NUMBERS: "type 1" and "type 2", "three steps" and "four steps", "first law" and "second law", 1789 and 1914 are the most common way two notes that look alike say
// different things. numbersOf lists the numbers and ordinals of a text (digits, English and Persian number words, all as digits); when a note and a passage both have some
// and share none, findMatches reports clash (Smart linking then suggests but does not link on its own). "one" / یک are left out (pronoun / article).
const NUM_WORDS = (("two 2 three 3 four 4 five 5 six 6 seven 7 eight 8 nine 9 ten 10 eleven 11 twelve 12 thirteen 13 fourteen 14 fifteen 15 sixteen 16 seventeen 17 eighteen 18 nineteen 19 twenty 20 thirty 30 forty 40 fifty 50 sixty 60 seventy 70 eighty 80 ninety 90 hundred 100 thousand 1000 million 1000000 " +
  "first 1 second 2 third 3 fourth 4 fifth 5 sixth 6 seventh 7 eighth 8 ninth 9 tenth 10 " +
  "دو 2 سه 3 چهار 4 پنج 5 شش 6 هفت 7 هشت 8 یازده 11 دوازده 12 بیست 20 سی 30 چهل 40 پنجاه 50 صد 100 هزار 1000 میلیون 1000000 " +
  "اول 1 یکم 1 دوم 2 سوم 3 چهارم 4 پنجم 5 ششم 6 هفتم 7 هشتم 8 نهم 9 دهم 10").split(" ")).reduce((m, x, i, a) => (i % 2 ? m : m.set(normalize(x), a[i + 1])), new Map());
export function numbersOf(text) {
  const out = new Set();
  for (const m of normalize(text).matchAll(/\d+|[\p{L}]+/gu)) { const w = m[0]; if (/^\d/.test(w)) out.add(String(parseInt(w, 10))); else if (NUM_WORDS.has(w)) out.add(NUM_WORDS.get(w)); }
  return out;
}
/** Do two sets of numbers contradict each other (both have some, none in common)? */
export const numbersClash = (a, b) => !!a && !!b && a.size > 0 && b.size > 0 && ![...a].some((n) => b.has(n));

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
const CLAUSE_MIN_WORDS = 30, CLAUSE_PIECE = 8;
const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;
/** A long sentence cut at its clause breaks (; : , and dashes) into pieces of at least CLAUSE_PIECE words, so a passage can be narrowed below a whole sentence. null when it is short. */
function clausesOf(text, s, e) {
  const src = text.slice(s, e);
  if (wordCount(src) < CLAUSE_MIN_WORDS) return null;
  const cuts = [], re = /[;:,،؛]\s+|\s[—–-]{1,2}\s/g;
  for (let m; (m = re.exec(src)); ) cuts.push(m.index + m[0].length);
  const pieces = []; let a = 0;
  for (const c of cuts) if (wordCount(src.slice(a, c)) >= CLAUSE_PIECE) { pieces.push([a, c]); a = c; }
  if (a < src.length) { if (pieces.length && wordCount(src.slice(a)) < CLAUSE_PIECE) pieces[pieces.length - 1][1] = src.length; else pieces.push([a, src.length]); }
  if (pieces.length < 2) return null;
  return pieces.map(([x, y]) => mkPart(text, s + x, s + y));
}
const mkPart = (text, s, e) => { while (s < e && /\s/.test(text[s])) s++; while (e > s && /\s/.test(text[e - 1])) e--; const src = text.slice(s, e); return { s, e, toks: contentTokens(src), nums: numbersOf(src), words: wordCount(src) }; };
/** The sentences of text[s, e) as parts { s, e, toks, nums, words, cl } (cl = the clauses of a long sentence, else null). */
function partsOfRange(text, s = 0, e = text.length) {
  return sentenceSpans(text.slice(s, e)).map(([a, b]) => { const p = mkPart(text, s + a, s + b); p.cl = clausesOf(text, p.s, p.e); return p; });
}
/** Passages of a text: every run of 1-3 consecutive sentences up to maxWords words. [{ s, e, toks, nums, parts }] (s, e = offsets in the text; parts = its sentences, which findMatches can narrow the passage to). */
export function passagesOf(text, { maxWords = 80, maxPassages = 360 } = {}) {
  const sent = partsOfRange(text);
  const out = [];
  for (let i = 0; i < sent.length && out.length < maxPassages; i++) {
    let toks = [], words = 0; const nums = new Set();
    for (let k = i; k < Math.min(sent.length, i + 3); k++) {
      words += sent[k].words; if (words > maxWords && k > i) break;
      toks = toks.concat(sent[k].toks); for (const n of sent[k].nums) nums.add(n);
      if (toks.length >= 3) out.push({ s: sent[i].s, e: sent[k].e, toks, nums: new Set(nums), parts: sent.slice(i, k + 1) });
      if (out.length >= maxPassages) break;
    }
  }
  return out;
}
/** Units of a note's text: the text itself when it is one short block; a note of several lines (or a very long one) is judged line by line / sentence by sentence,
 *  so a note that mixes topics does not dilute the part that matches. [{ s, e, toks }] with at least 4 content words each. */
export function noteUnits(text, { maxUnits = 8 } = {}) {
  const whole = contentTokens(text), multi = /\n\s*\S/.test(text.trim());
  const withParts = (u) => { const parts = partsOfRange(text, u.s, u.e); if (parts.length > 1 || (parts[0] && parts[0].cl)) u.parts = parts; return u; };      // (so a long block can be narrowed to the sentence that matches)
  if (!(multi && whole.length > 20) && whole.length <= 90) return whole.length >= 4 ? [withParts({ s: 0, e: text.length, toks: whole, nums: numbersOf(text) })] : [];
  const out = [];
  if (multi) {
    let pos = 0;
    for (const line of text.split(/\n+/)) {
      const s = text.indexOf(line, pos); pos = s + line.length;
      const toks = contentTokens(line);
      if (toks.length >= 4) out.push(withParts({ s, e: s + line.length, toks, nums: numbersOf(line) }));
      if (out.length >= maxUnits) break;
    }
  } else for (const p of passagesOf(text, { maxWords: 60, maxPassages: maxUnits * 3 })) { if (p.toks.length >= 4) out.push(p); if (out.length >= maxUnits) break; }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const lenBoost = (t) => Math.min(1.5, 0.6 + t.length / 8);
/** Is one word the other with a negating affix (state / stateless, secure / insecure, linear / nonlinear)? Such words share a root but mean the opposite. */
const NEG = ["un", "non", "in", "im", "ir", "il", "dis", "anti"];
const negated = (t, u) => { if (t.length > u.length) [t, u] = [u, t]; return u === t + "less" || u === t + "free" || NEG.some((p) => u === p + t); };
/** Do two stems share a long enough beginning to be forms of one word (encrypt / encryption, synapse / synaptic)? Not when they are opposites (state / stateless). */
const sameRoot = (t, u) => { const m = Math.min(t.length, u.length); return m >= 4 && commonPrefix(t, u) >= Math.max(4, Math.ceil(0.66 * m)) && !negated(t, u); };
// how much a kind of match is worth, as a share of an exact match
// narrowing a passage: keep the smallest run of sentences with at least TRIM_KEEP of the best run's matched weight; a passage longer than 4 x the note's content words (at least TRIM_CAP_MIN words) is cut at clauses
const TRIM_KEEP = 0.85, TRIM_CAP_MIN = 24;
export const CREDIT = { exact: 1, concept: 0.8, root: 0.6 }, GENERIC_WEIGHT = 0.45, RARITY_MIN_PASSAGES = 8;

/** The words of `text` that the note's words found there (same stem, same meaning, or another form of the same root): [[start, end), ...] in `text`, for showing WHY a passage was suggested. */
export function matchRanges(noteToks, text) {
  const stems = new Set(), cs = new Set();
  for (const x of noteToks) { stems.add(x.t); const c = conceptsOf(x.t); if (c) for (const id of c) cs.add(id); }
  const out = [], re = /[^\s]+/gu;
  for (let m; (m = re.exec(text)); ) {
    const hit = contentTokens(m[0]).some((x) => stems.has(x.t) || (conceptsOf(x.t) || []).some((id) => cs.has(id)) || [...stems].some((t) => sameRoot(t, x.t)));
    if (hit) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/**
 * Best passage for every note. notes: [{ toks }], passages: [{ s, e, toks }] -> [{ note, passage, score, exact, syn, fuzzy, clash, pool (how many passages it was compared with), shared: [raw words], second }]
 * One entry per note that has an acceptable best passage (see GUARDS above); the caller decides with the score what to do with it.
 *   clash = the note and the passage both name numbers / ordinals and share none (type 1 / type 2): probably another fact. exact = words found as they are (same stem), syn = words found as another word of the same meaning (lexicon.js), fuzzy = words found as another form of the same root.
 * opts: { floor (lowest score worth returning, default .3), yieldMs }
 */
export async function findMatches(notes, passages, { floor = 0.3, yieldMs = 8 } = {}) {
  const out = [];
  if (!notes.length || !passages.length) return out;
  // RARITY (IDF) is measured against the PASSAGES only: how distinctive a word is on the page being compared against. (Counting the notes too would lower the weight of
  // exactly the words that are in both, which are the signal.) A word that is not on the page, but whose synonym is, weighs what the synonym weighs. With very few passages
  // there is nothing to measure, so every word weighs the same. Generic words weigh less (lexicon.js).
  const df = new Map(), dfC = new Map(), N = passages.length;
  for (const u of passages) {
    for (const t of new Set(u.toks.map((x) => x.t))) df.set(t, (df.get(t) || 0) + 1);
    const ids = new Set(); for (const x of u.toks) { const c = conceptsOf(x.t); if (c) for (const id of c) ids.add(id); }
    for (const id of ids) dfC.set(id, (dfC.get(id) || 0) + 1);
  }
  const rarity = (t) => { let d = df.get(t) || 0; if (!d) { const c = conceptsOf(t); if (c) for (const id of c) d = Math.max(d, dfC.get(id) || 0); } return Math.log(1 + (N + 1) / (d + 1)); };
  const w = (t) => (N < RARITY_MIN_PASSAGES ? 1 : rarity(t)) * lenBoost(t) * (GENERIC.has(t) ? GENERIC_WEIGHT : 1);
  const vec = (toks) => {
    const m = new Map(); let tot = 0;
    for (const x of toks) if (!m.has(x.t)) { const v = { w: w(x.t), raw: x.raw, c: conceptsOf(x.t) }; m.set(x.t, v); tot += v.w; }
    return { m, tot };
  };
  const P = passages.map((p) => ({ p, ...vec(p.toks) }));
  /** What the note's words find in one passage q (a vec with its concept set and prefix index): the credit and how each word was found. */
  const credit = (A, q) => {
    let sw = 0, exact = 0, syn = 0, fuzzy = 0; const shared = [];
    for (const [t, a] of A.m) {
      if (q.m.has(t)) { sw += a.w; exact++; shared.push(a.raw); continue; }
      if (a.c && a.c.some((id) => q.cs.has(id))) { sw += CREDIT.concept * a.w; syn++; shared.push(a.raw); continue; }
      const bucket = q.pre.get(t.slice(0, 4));
      if (bucket && bucket.some((u) => sameRoot(t, u))) { sw += CREDIT.root * a.w; fuzzy++; shared.push(a.raw); }
    }
    return { sw, exact, syn, fuzzy, shared };
  };
  const indexed = (q) => { q.pre = new Map(); q.cs = new Set(); for (const [t, v] of q.m) { const k = t.slice(0, 4); (q.pre.get(k) || q.pre.set(k, []).get(k)).push(t); if (v.c) for (const id of v.c) q.cs.add(id); } return q; };
  /** A span of consecutive parts as a passage-like object, with its own credit for the note. */
  const span = (A, parts, a, b) => {
    const toks = [], nums = new Set(); let words = 0;
    for (let k = a; k <= b; k++) { toks.push(...parts[k].toks); for (const n of parts[k].nums) nums.add(n); words += parts[k].words; }
    const q = indexed(vec(toks));
    return { a, b, s: parts[a].s, e: parts[b].e, toks, nums, words, q, ...credit(A, q) };
  };
  /** The smallest run of consecutive parts that still carries (nearly) all that the note finds in the best run: dropping a sentence only when what it adds is marginal.
   *  strict (sentence level): a run never contains a part that matches nothing, so two separate relevant sentences are not glued together across unrelated ones. */
  const narrow = (A, parts, strict) => {
    const own = parts.map((_, k) => credit(A, indexed(vec(parts[k].toks))).sw);
    const runs = [];
    for (let a = 0; a < parts.length; a++) for (let b = a; b < parts.length; b++) {
      if (strict && own.slice(a, b + 1).some((x) => x <= 0)) break;
      runs.push(span(A, parts, a, b));
    }
    if (!runs.length) return null;
    const top = Math.max(...runs.map((r) => r.sw));
    return runs.filter((r) => r.sw >= TRIM_KEEP * top).sort((x, y) => x.words - y.words || y.sw - x.sw || x.a - y.a)[0];
  };
  /** The part of the winner that is the answer: sentences first, then (when that is still long for a short note) the clauses of a long sentence, with a little context kept. */
  const refine = (A, note, bp, floorScore) => {
    if (!bp.parts || !bp.parts.length) return null;
    const noteLen = note.toks.length, cap = Math.max(TRIM_CAP_MIN, noteLen * 4), ctx = Math.max(8, Math.ceil(noteLen * 1.2));
    let parts = bp.parts, r = narrow(A, parts, true);
    if (!r) return null;
    if (r.words > cap && parts.slice(r.a, r.b + 1).some((x) => x.cl)) {
      const flat = parts.slice(r.a, r.b + 1).flatMap((x) => x.cl || [x]), r2 = narrow(A, flat, false);
      if (r2) {
        let { a, b } = r2, words = r2.words;
        while (words < ctx && (a > 0 || b < flat.length - 1)) {                                // keep enough around it to read as a statement: grow towards the side that matches more
          const l = a > 0 ? credit(A, indexed(vec(flat[a - 1].toks))).sw : -1, rr = b < flat.length - 1 ? credit(A, indexed(vec(flat[b + 1].toks))).sw : -1;
          if (rr >= l) { b++; words += flat[b].words; } else { a--; words += flat[a].words; }
        }
        r = span(A, flat, a, b);
      }
    }
    if (r.exact < 1 || r.exact + r.syn + r.fuzzy < 3) return null;
    // the score describes exactly what is shown: how much of the note the narrowed range finds, and how focused it is
    const c = r.sw / A.tot, f = Math.min(1, r.sw / (0.3 * r.q.tot)), score = c * (0.7 + 0.3 * f);
    if (score < floorScore) return null;
    return { s: r.s, e: r.e, toks: r.toks, nums: r.nums, score, exact: r.exact, syn: r.syn, fuzzy: r.fuzzy, shared: r.shared };
  };
  // inverted indexes: stem -> passages, concept -> passages, 4-letter prefix -> stems (for words of one root)
  const inv = new Map(), byPre = new Map();
  const add = (k, i) => { let a = inv.get(k); if (!a) inv.set(k, (a = [])); if (a[a.length - 1] !== i) a.push(i); };
  P.forEach((q, i) => {
    q.pre = new Map(); q.cs = new Set();
    for (const [t, v] of q.m) {
      add(t, i); const k = t.slice(0, 4); (q.pre.get(k) || q.pre.set(k, []).get(k)).push(t); if (!byPre.has(k)) byPre.set(k, new Set()); byPre.get(k).add(t);
      if (v.c) for (const id of v.c) { q.cs.add(id); add("#" + id, i); }
    }
  });
  let t0 = performance.now();
  for (const note of notes) {
    if (performance.now() - t0 > yieldMs) { await tick(); t0 = performance.now(); }
    const A = vec(note.toks);
    if (A.m.size < 4) continue;
    const cand = new Map();                                                   // passage -> number of the note's words it has (exact, by meaning or by root)
    for (const [t, a] of A.m) {
      const seen = new Set();
      for (const i of inv.get(t) || []) seen.add(i);
      if (a.c) for (const id of a.c) for (const i of inv.get("#" + id) || []) seen.add(i);
      for (const u of byPre.get(t.slice(0, 4)) || []) if (u !== t && sameRoot(t, u)) for (const i of inv.get(u)) seen.add(i);
      for (const i of seen) cand.set(i, (cand.get(i) || 0) + 1);
    }
    const scored = [];
    for (const [i, hits] of cand) {
      if (hits < 3) continue;
      const q = P[i], { sw, exact, syn, fuzzy, shared } = credit(A, q);
      if (exact < 1 || exact + syn + fuzzy < 3) continue;
      const c = sw / A.tot, f = Math.min(1, sw / (0.3 * q.tot));
      scored.push({ i, score: c * (0.7 + 0.3 * f), exact, syn, fuzzy, shared });
    }
    if (!scored.length) continue;
    scored.sort((x, y) => y.score - x.score || (passages[x.i].e - passages[x.i].s) - (passages[y.i].e - passages[y.i].s));
    const best = scored[0], bp = passages[best.i];
    if (best.score < floor) continue;
    const other = scored.find((x) => passages[x.i].e <= bp.s || passages[x.i].s >= bp.e);      // the best passage that does not overlap the winner
    const second = other ? other.score : 0;
    if (best.score - second < 0.06) continue;                                   // ambiguous: it fits several places about equally (even a perfect score), so none of them is "the" place
    // the winner is a window of up to 3 sentences: narrow it to the part that is actually about the note (the score and the evidence then describe what is shown)
    const nar = refine(A, note, bp, floor), shown = nar ? { ...bp, s: nar.s, e: nar.e, toks: nar.toks, nums: nar.nums, narrowed: nar.s !== bp.s || nar.e !== bp.e } : { ...bp, narrowed: false }, fin = nar || best;
    delete shown.parts;
    out.push({ note, passage: shown, score: Math.round(fin.score * 1000) / 1000, exact: fin.exact, syn: fin.syn, fuzzy: fin.fuzzy, clash: numbersClash(note.nums, shown.nums), pool: N, shared: fin.shared.slice(0, 8), second: Math.round(second * 1000) / 1000 });
  }
  return out;
}
