import test from "node:test"; import assert from "node:assert/strict";
import { normalize, normalizeWithMap, originalRange, isWholeWord } from "../../js/textnorm.js";

test("case, accents and white space", () => {
  assert.equal(normalize("  Network   SECURITY\n\tbasics "), "network security basics");
  assert.equal(normalize("Résumé Ünïcode"), "resume unicode");
  assert.equal(normalize("a\u00A0b"), "a b");                                      // no-break space
});
test("Persian and Arabic forms of the same letter are one letter", () => {
  assert.equal(normalize("علي"), normalize("علی"));                                // Arabic yeh = Persian yeh
  assert.equal(normalize("كتاب"), normalize("کتاب"));                              // Arabic kaf = Persian kaf
  assert.equal(normalize("آب"), normalize("اب"));                                  // alef with madda
  assert.equal(normalize("خانه"), normalize("خانة"));
});
test("ZWNJ, tatweel, vowel marks and bidi marks are ignored", () => {
  assert.equal(normalize("می\u200Cروم"), normalize("میروم"));
  assert.equal(normalize("سـلام"), normalize("سلام"));
  assert.equal(normalize("مَکتَب"), normalize("مکتب"));
  assert.equal(normalize("\u200Fسلام\u200E"), "سلام");
});
test("digits of all three kinds are the same digits", () => {
  assert.equal(normalize("صفحه ۱۲۳"), normalize("صفحه ١٢٣")); assert.equal(normalize("۲۰"), "20");
});
test("presentation forms and ligatures fold to the plain letters", () => {
  assert.equal(normalize("ﬁle"), "file");
  assert.equal(normalize("\uFEB3\uFEE0\uFE8E\uFEE1"), normalize("سلام"));          // isolated / initial / final forms as a PDF can give them
});
test("map: a match in the folded text points back into the original text", () => {
  const src = "Hello,  Wörld  می\u200Cروم", nm = normalizeWithMap(src);
  assert.equal(nm.t, normalize(src));
  const a = nm.t.indexOf("world"), [s, e] = originalRange(nm, a, a + 5);
  assert.equal(src.slice(s, e), "Wörld");
  const b = nm.t.indexOf("میروم"), [s2, e2] = originalRange(nm, b, b + 5);
  assert.equal(src.slice(s2, e2), "می\u200Cروم");
});
test("whole-word test works for Persian and English", () => {
  const t = normalize("network networking، شبکه شبکهها");
  const a = t.indexOf("network"); assert.equal(isWholeWord(t, a, a + 7), true);
  const b = t.indexOf("network", 1); assert.equal(isWholeWord(t, b, b + 7), false);
  const c = t.indexOf("شبکه"); assert.equal(isWholeWord(t, c, c + 4), true);
  const d = t.lastIndexOf("شبکه"); assert.equal(isWholeWord(t, d, d + 4), false);
});
test("empty / odd input never throws", () => {
  assert.equal(normalize(null), ""); assert.equal(normalize("\u200C"), ""); assert.deepEqual(normalizeWithMap("").map.length, 0);
  assert.equal(normalize("😀 ok"), "😀 ok");
});
