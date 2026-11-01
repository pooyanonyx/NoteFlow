// Text normalisation for search (pure, no DOM). The SAME function folds the indexed text and the query, so what the user types matches
// what is stored however it was written:
//   - case-insensitive; accents on Latin letters are ignored (resume = résumé)
//   - Persian / Arabic: Arabic and Persian forms of the same letter are one letter (ي = ی, ك = ک, ة = ه), vowel marks (harakat), tatweel and
//     the zero-width joiner / non-joiner (ZWNJ: می‌روم = میروم) are ignored, hamza / madda forms fold to their base letter (آ = ا)
//   - digits: Arabic-Indic (٠١٢), Persian (۰۱۲) and Latin digits are the same digits
//   - compatibility forms are folded (NFKD): presentation forms that PDFs often contain (ﻓ, ﬁ, full-width letters ...) match the plain letters
//   - any run of white space (also NBSP, line breaks) is ONE space
// normalizeWithMap also returns, for every character of the result, where it came from in the original text, so a match found in the
// folded text can be shown / highlighted in the original.

const DROP = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD\u0640]/;                       // zero-width + bidi marks, soft hyphen, tatweel
const MARKS = /[\u0300-\u036F\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g;   // combining marks (Latin accents, Arabic vowel signs)
const FOLD = { "\u064A": "\u06CC", "\u0649": "\u06CC", "\u0643": "\u06A9", "\u0629": "\u0647", "\u06C0": "\u0647", "\u06D3": "\u06CC",
  "\u060C": ",", "\u061B": ";", "\u061F": "?", "\u066B": ".", "\u066C": ",", "\u2018": "'", "\u2019": "'", "\u201C": "\"", "\u201D": "\"" };
const SPACE = /\s/;

/** One original character (a code point) -> its folded form ("" = ignored). */
function foldChar(ch) {
  if (DROP.test(ch)) return "";
  if (SPACE.test(ch)) return " ";
  let s = ch.normalize("NFKD").replace(MARKS, "").toLowerCase();
  if (!s) return "";
  let out = "";
  for (const c of s) {
    const u = c.charCodeAt(0);
    if (u >= 0x660 && u <= 0x669) out += String.fromCharCode(48 + u - 0x660);                    // Arabic-Indic digits
    else if (u >= 0x6F0 && u <= 0x6F9) out += String.fromCharCode(48 + u - 0x6F0);               // Persian digits
    else out += FOLD[c] ?? c;
  }
  return out;
}

/** -> { t: folded text, map: Int32Array (index in the original of the character t[i] came from), ends: Int32Array (index in the original just after it) } */
export function normalizeWithMap(s) {
  s = String(s ?? "");
  const t = [], map = [], ends = [];
  let i = 0;
  for (const ch of s) {
    const at = i; i += ch.length;
    const f = foldChar(ch);
    if (!f) continue;
    for (const c of f) {
      if (c === " " && (t.length === 0 || t[t.length - 1] === " ")) continue;                  // one space, none at the start
      t.push(c); map.push(at); ends.push(i);
    }
  }
  while (t.length && t[t.length - 1] === " ") { t.pop(); map.pop(); ends.pop(); }              // none at the end
  return { t: t.join(""), map: Int32Array.from(map), ends: Int32Array.from(ends) };
}
/** Folded text only (the fast path used for the index and the query). */
export function normalize(s) {
  s = String(s ?? "");
  let out = "", lastSpace = true;
  for (const ch of s) {
    const f = foldChar(ch);
    if (!f) continue;
    for (const c of f) { if (c === " ") { if (lastSpace) continue; lastSpace = true; } else lastSpace = false; out += c; }
  }
  return lastSpace && out.endsWith(" ") ? out.slice(0, -1) : out;
}
/** [a, b) in the folded text -> [start, end) in the original text. */
export function originalRange(nm, a, b) {
  if (!nm.map.length) return [0, 0];
  const i = Math.min(Math.max(a, 0), nm.map.length - 1), j = Math.min(Math.max(b - 1, i), nm.map.length - 1);
  return [nm.map[i], nm.ends[j]];
}
const WORD = /[\p{L}\p{N}\p{M}]/u;
/** Is the character at index i of a (folded) text part of a word? (letters and digits of any script) */
export const isWordChar = (t, i) => i >= 0 && i < t.length && WORD.test(String.fromCodePoint(t.codePointAt(i)));
/** Does [a, b) sit on word boundaries in t? */
export const isWholeWord = (t, a, b) => !isWordChar(t, a - 1) && !isWordChar(t, b);
