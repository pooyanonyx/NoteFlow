import { test } from "node:test";
import assert from "node:assert/strict";
import { RARITY_MIN_PASSAGES, contentTokens, numbersOf, numbersClash, conceptsOf, passagesOf, noteUnits, findMatches } from "../../js/similar.js";
import { isConfident, AUTO_AT, AUTO_AT_SMALL, SUGGEST_AT } from "../../js/smartlink.js";
import * as CAL from "./smartlink-corpus.mjs";
import * as HOLD from "./smartlink-holdout.mjs";

// The labelled notes (English and Persian) run through the real scorer and the real decision, as the app does. The assertions are about RATES and about the things that must
// never happen, so that a future change of scoring or lexicon has to keep the balance: flexible suggestions, selective automatic links.
async function run(set) {
  const out = [];
  for (const [page, label, note, at] of set.CASES) {
    const text = set.PAGES[page], u = noteUnits(note);
    const r = (u.length ? await findMatches(u, passagesOf(text), { floor: 0 }) : []).sort((a, b) => b.score - a.score)[0];
    const right = !!(r && (!at || at.test(text.slice(r.passage.s, r.passage.e))));
    out.push({ label, note, r, right, auto: !!(r && right && isConfident(r)), sug: !!(r && r.score >= SUGGEST_AT) });
  }
  return out;
}
const of = (rows, l) => rows.filter((x) => x.label === l), n = (a, f) => a.filter(f).length;

// (minAuto / minHeavy / maxJunk are the measured levels with a little room: ~97% / 60% / 1 on the calibration notes, ~71% / 38% / 3 on the held-out notes the scorer was never tuned on)
for (const [name, set, minAuto, minHeavy, maxJunk] of [["calibration notes", CAL, 0.9, 0.5, 2], ["held-out notes", HOLD, 0.65, 0.3, 3]]) {
  test(`${name}: rewordings of the same statement are linked, and every one is at least suggested at the right place`, async () => {
    const rows = await run(set), a = of(rows, "auto");
    assert.ok(n(a, (x) => x.auto) / a.length >= minAuto, `auto rate ${n(a, (x) => x.auto)}/${a.length}`);
    const missed = a.filter((x) => !(x.right && x.sug)).map((x) => x.note.slice(0, 50));
    assert.deepEqual(missed, []);
  });
  test(`${name}: heavy rewordings are suggested when the vocabulary allows (a third to a half of them)`, async () => {
    const s = of(await run(set), "suggest");
    assert.ok(n(s, (x) => x.right && x.sug) / s.length >= minHeavy, `${n(s, (x) => x.right && x.sug)}/${s.length}`);
  });
  test(`${name}: same-topic other facts, lexical traps and unrelated notes are never linked on their own`, async () => {
    const rows = await run(set);
    assert.deepEqual(rows.filter((x) => ["related", "trap", "none"].includes(x.label) && x.auto).map((x) => x.note.slice(0, 50)), []);
  });
  test(`${name}: unrelated notes and lexical traps are (almost) never even suggested`, async () => {
    const rows = await run(set), bad = rows.filter((x) => ["trap", "none"].includes(x.label) && x.sug);
    assert.ok(bad.length <= maxJunk, JSON.stringify(bad.map((x) => x.note.slice(0, 50))));
    assert.deepEqual(of(rows, "none").filter((x) => x.r && x.r.score >= SUGGEST_AT + 0.1), []);                      // an unrelated note is not even close to the line
  });
}

test("notes are not suggested on the wrong page: every note against a page of other content scores below the suggestion floor", async () => {
  const lang = { cs: "en", sci: "en", mix: "en", fa1: "fa", fa2: "fa", fa5: "fa" }, bad = [];
  for (const [page, label, note] of CAL.CASES) {
    if (label === "none" || !lang[page]) continue;
    for (const other of Object.keys(lang)) {
      if (other === page || lang[other] !== lang[page]) continue;
      const r = (await findMatches(noteUnits(note), passagesOf(CAL.PAGES[other]), { floor: SUGGEST_AT }))[0];
      if (r && !isConfident(r) === false) bad.push(note.slice(0, 40));                                              // (never linked)
    }
  }
  assert.deepEqual(bad, []);
});

test("Persian verbs: the می‌ prefix and the personal ending do not make two forms of one verb different words", () => {
  const stems = (t) => contentTokens(t).map((x) => x.t);
  assert.deepEqual(stems("می‌سازد"), stems("می‌سازند"));
  assert.deepEqual(stems("نمی‌سازیم"), stems("می‌سازد"));
  assert.ok(!stems("رمزنگاری از داده‌ها محافظت می‌کند").some((t) => t.startsWith("می")));                 // no glued junk word
  assert.deepEqual(stems("کالایی"), stems("کالا"));                                                       // indefinite ending
  assert.deepEqual(stems("تولیدکنندگان"), stems("تولیدکننده"));
  assert.deepEqual(stems("قیمت‌هاست"), stems("قیمت‌ها"));
});
test("synonyms: words of one meaning share a concept in both languages, unrelated words do not", () => {
  const same = (a, b) => { const x = conceptsOf(contentTokens(a)[0].t), y = conceptsOf(contentTokens(b)[0].t); return !!(x && y && x.some((i) => y.includes(i))); };
  assert.ok(same("toppled", "overthrew") && same("increase", "climbs") && same("organize", "arranged") && same("شروع", "آغاز") && same("خریداران", "مصرف‌کنندگان"));
  assert.ok(!same("increase", "decrease") && !same("inspect", "track") && !same("شروع", "پایان"));
});
test("a word and its negation are not forms of one word (state / stateless), a real form still is (encrypt / encryption)", async () => {
  const text = "The firewall keeps the state of every connection and decides which packets may pass. Unrelated text about gardens, compost heaps and vegetable seedlings in spring.";
  const stateless = await findMatches(noteUnits("A stateless filter looks at every packet and every connection"), passagesOf(text), { floor: 0 });
  assert.equal((stateless[0] || { fuzzy: 0 }).fuzzy, 0);
  const forms = await findMatches(noteUnits("Encryption of every connection protects packets in transit between hosts"), passagesOf("Data in transit between hosts is protected when each connection is encrypted and every packet is checked."), { floor: 0 });
  assert.ok(forms[0] && forms[0].fuzzy >= 1);
});
test("numbers: digits, English and Persian number words and ordinals are compared as numbers; a clash is only when both name some and share none", () => {
  assert.deepEqual([...numbersOf("Type 2 diabetes, three steps, the fourth law, 1789")].sort(), ["1789", "2", "3", "4"]);
  assert.deepEqual([...numbersOf("مرحله سوم و ۱۷۸۹ و دو قطب")].sort(), ["1789", "2", "3"]);
  assert.equal(numbersClash(numbersOf("type 1"), numbersOf("type two")), true);
  assert.equal(numbersClash(numbersOf("three steps"), numbersOf("3 steps")), false);
  assert.equal(numbersClash(numbersOf("no numbers here"), numbersOf("type 2")), false);
  assert.equal(numbersClash(numbersOf("one of them"), numbersOf("type 2")), false);
});
test("thresholds: automatic links are more selective than suggestions by a clear distance", () => {
  assert.ok(AUTO_AT - SUGGEST_AT >= 0.2 && SUGGEST_AT <= 0.35 && AUTO_AT <= 0.6);
});

test("a very short page (nothing to tell distinctive words from ordinary ones) needs a stricter bar for linking on its own, not for suggesting", async () => {
  const page = "The TCP handshake establishes a reliable connection between two hosts using three steps: the client sends SYN, the server answers with SYN-ACK, and the client confirms with ACK.";
  const other = await findMatches(noteUnits("TCP connection teardown: each side sends FIN and the other side replies with ACK, hosts then close the connection"), passagesOf(page), { floor: 0 });
  assert.equal(other[0].pool < RARITY_MIN_PASSAGES, true);
  assert.ok(other[0].score >= SUGGEST_AT && other[0].score < AUTO_AT_SMALL && !isConfident(other[0]), JSON.stringify(other[0].score));     // suggested, not linked
  assert.equal(isConfident({ score: AUTO_AT + 0.01, exact: 5, syn: 0, second: 0, pool: 3 }), false);
  assert.equal(isConfident({ score: AUTO_AT_SMALL, exact: 5, syn: 0, second: 0, pool: 3 }), true);
  assert.equal(isConfident({ score: AUTO_AT, exact: 5, syn: 0, second: 0, pool: 40 }), true);
  const same = await findMatches(noteUnits("The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK"), passagesOf(page), { floor: 0 });
  assert.ok(isConfident(same[0]));                                                                          // a real paraphrase still links on a one-sentence page
});
