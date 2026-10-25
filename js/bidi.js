// A small, self-contained version of the Unicode bidirectional algorithm: enough to place pieces of differently styled text
// (for instance an English word in bold inside a Persian sentence) in the right visual order. Pure, no DOM.
const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const DIGIT_RE = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
const LETTER_RE = /\p{L}/u;
/** "R" right-to-left letter, "L" other letter, "N" digit, "W" neutral (space, punctuation, ...). */
export function charClass(ch) {
  if (DIGIT_RE.test(ch)) return "N";
  if (RTL_RE.test(ch)) return /[\p{L}\p{M}]/u.test(ch) ? "R" : "W";      // Arabic-script letters and their marks; Arabic punctuation is neutral
  return LETTER_RE.test(ch) ? "L" : "W";
}
/** Embedding level of every UTF-16 unit of `text` for a paragraph whose base direction is RTL (baseRtl) or LTR. */
export function resolveLevels(text, baseRtl) {
  const n = text.length, cls = new Array(n), res = new Array(n);
  for (let i = 0; i < n; i++) cls[i] = charClass(text[i]);
  let prev = baseRtl ? "R" : "L";                              // strong direction before the current char
  for (let i = 0; i < n; i++) {
    if (cls[i] === "R" || cls[i] === "L") { prev = cls[i]; res[i] = cls[i]; }
    else if (cls[i] === "N") res[i] = prev === "L" ? "L" : "N";   // a number after right-to-left text stays a (left-to-right) number inside it
    else res[i] = null;
  }
  const dirOf = (t) => (t === "L" ? "L" : "R");                // numbers behave like right-to-left letters for the neutrals around them
  let next = baseRtl ? "R" : "L";
  const nextStrong = new Array(n);
  for (let i = n - 1; i >= 0; i--) { if (res[i]) next = dirOf(res[i]); nextStrong[i] = next; }
  let before = baseRtl ? "R" : "L";
  for (let i = 0; i < n; i++) {
    if (res[i]) { before = dirOf(res[i]); continue; }
    res[i] = before === nextStrong[i] ? before : (baseRtl ? "R" : "L");      // between two letters of one direction: that direction; else the paragraph's
  }
  const levels = new Uint8Array(n);
  for (let i = 0; i < n; i++) levels[i] = baseRtl ? (res[i] === "R" ? 1 : 2) : (res[i] === "L" ? 0 : res[i] === "R" ? 1 : 2);
  return levels;
}
/** Split [0, n) into runs of equal level: [{start, end, level}] */
export function levelRuns(levels) {
  const out = [];
  for (let i = 0; i < levels.length; i++) {
    const last = out[out.length - 1];
    if (last && last.level === levels[i]) last.end = i + 1; else out.push({ start: i, end: i + 1, level: levels[i] });
  }
  return out;
}
/** Visual (left to right) order of items that have a .level (rule L2: reverse from the highest level down to the lowest odd one). */
export function visualOrder(items) {
  const a = items.slice();
  if (!a.length) return a;
  let hi = 0, lowOdd = 255;
  for (const x of a) { hi = Math.max(hi, x.level); if (x.level & 1) lowOdd = Math.min(lowOdd, x.level); }
  for (let lv = hi; lv >= lowOdd && lv > 0; lv--) {
    for (let i = 0; i < a.length;) {
      if (a[i].level < lv) { i++; continue; }
      let j = i; while (j < a.length && a[j].level >= lv) j++;
      for (let l = i, r = j - 1; l < r; l++, r--) [a[l], a[r]] = [a[r], a[l]];
      i = j;
    }
  }
  return a;
}
