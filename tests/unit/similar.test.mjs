import test from "node:test"; import assert from "node:assert/strict";
import { contentTokens, sentenceSpans, passagesOf, noteUnits, findMatches } from "../../js/similar.js";

const PAGE = `Firewalls filter network traffic according to security rules. A stateful firewall tracks the state of active connections and decides which packets are allowed.
The TCP handshake establishes a reliable connection between two hosts using three steps: the client sends SYN, the server answers with SYN-ACK, and the client confirms with ACK.
Encryption protects data in transit. Public key cryptography lets two parties exchange secrets over an untrusted channel.
Intrusion detection systems monitor networks for suspicious activity and report policy violations.`;

async function best(note, text = PAGE, opts) {
  const notes = noteUnits(note), passages = passagesOf(text);
  const r = await findMatches(notes, passages, opts);
  return r.length ? { ...r[0], text: text.slice(r[0].passage.s, r[0].passage.e) } : null;
}

test("tokens: stop words and bare numbers go, stems unite word forms (English)", () => {
  assert.deepEqual(contentTokens("The networks are being encrypted, 2024!").map((x) => x.t), ["network", "encrypt"]);
  const a = contentTokens("networking networks network").map((x) => x.t); assert.deepEqual([...new Set(a)], ["network"]);
});
test("tokens: Persian plurals and letter forms unite", () => {
  const f = (s) => contentTokens(s).map((x) => x.t);
  assert.deepEqual(f("شبکه‌ها"), f("شبکه")); assert.deepEqual(f("شبکههای"), f("شبکه")); assert.deepEqual(f("كتاب‌ها"), f("کتاب"));
});
test("sentences and passages keep their offsets in the original text", () => {
  const sp = sentenceSpans(PAGE); assert.equal(sp.length, 6);
  for (const [s, e] of sp) assert.ok(!/^\s|\s$/.test(PAGE.slice(s, e)));
  const ps = passagesOf(PAGE); assert.ok(ps.length >= 6 && ps.every((p) => p.e > p.s && p.toks.length >= 3));
});

test("a reworded note is matched to the right passage with high confidence", async () => {
  const r = await best("The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK");
  assert.ok(r && r.score >= 0.55 && r.score < 0.85, JSON.stringify(r && r.score)); assert.match(r.text, /TCP handshake/);       // a fair paraphrase: suggested, but not "very high" (no auto link)
});
test("word forms differ (stems, prefixes) and it is still found, with a lower score than a verbatim copy", async () => {
  const fuzzy = await best("Encrypting data while transmitted: public key cryptographic exchanging secrets over untrusted channels");
  assert.ok(fuzzy && fuzzy.fuzzy >= 2 && /Public key cryptography/.test(fuzzy.text), JSON.stringify(fuzzy && [fuzzy.score, fuzzy.fuzzy]));
  const same = await best("Encryption protects data in transit. Public key cryptography lets two parties exchange secrets over an untrusted channel.");
  assert.ok(same.score > fuzzy.score && same.score > 0.9 && same.fuzzy === 0);
});
test("unrelated notes find nothing; a note about another topic that shares one word is not matched", async () => {
  assert.equal(await best("Buy milk, eggs and bread at the supermarket tomorrow evening"), null);
  assert.equal(await best("The network of my friends is growing quickly this summer"), null);
});
test("too short or too generic notes are never matched (not enough to judge)", async () => {
  assert.equal(await best("TCP handshake"), null);
  assert.equal(await best("important network security"), null);
  assert.deepEqual(noteUnits("ok yes the"), []);
});
test("ambiguity: a note that fits two passages equally well is not matched", async () => {
  const text = "Alpha servers store backup archives nightly for customers.\n\nBeta servers store backup archives nightly for customers.";
  assert.equal(await best("servers store backup archives nightly customers", text), null);
});
test("Persian note and Persian page", async () => {
  const page = "دیوار آتش ترافیک شبکه را بر اساس قوانین امنیتی فیلتر می‌کند. رمزنگاری از داده‌ها در هنگام انتقال محافظت می‌کند و کلید عمومی تبادل امن اسرار را ممکن می‌سازد. سامانه‌های تشخیص نفوذ فعالیت‌های مشکوک شبکه را پایش می‌کنند.";
  const r = await best("رمزنگاری از داده‌ها هنگام انتقال محافظت می‌کند و تبادل کلید عمومی را امن می‌سازد", page);
  assert.ok(r && r.score >= 0.6 && r.text.includes("رمزنگاری"), r && r.score);
  assert.equal(await best("امروز هوا بسیار خوب است و می‌خواهم به پارک بروم و ورزش کنم", page), null);
});
test("a long note is judged paragraph by paragraph (one match per matching paragraph)", async () => {
  const note = "Shopping list for the weekend party with many guests and plenty of snacks drinks and decorations to buy from several different stores around town " .repeat(5) + "\nThe TCP handshake uses SYN SYN-ACK and ACK between client and server";
  const units = noteUnits(note); assert.ok(units.length >= 2);
  const r = await findMatches(units, passagesOf(PAGE)); assert.equal(r.length, 1); assert.match(PAGE.slice(r[0].passage.s, r[0].passage.e), /TCP handshake/);
});
test("a page with a single paragraph still works (rarity needs no big page)", async () => {
  const page = "The TCP handshake establishes a reliable connection between two hosts using three steps: the client sends SYN, the server answers with SYN-ACK, and the client confirms with ACK.";
  const r = await best("The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK", page);
  assert.ok(r && r.score >= 0.55 && r.score < 0.88, r && r.score);
  assert.equal(await best("Buy milk, eggs and bread at the supermarket tomorrow evening", page), null);
});
test("shared words are reported (for showing why)", async () => {
  const r = await best("Public key cryptography allows exchanging secrets over untrusted channels"); assert.ok(r.shared.includes("public") && r.shared.some((w) => w.startsWith("secret")));
});
test("speed: 120 notes against 360 passages is quick, and does not block (yields)", async () => {
  const big = Array.from({ length: 200 }, (_, i) => `Sentence ${i} about topic${i % 17} with algorithm${i % 13} and protocol${i % 11} details describing module${i % 7} behaviour.`).join(" ");
  const notes = Array.from({ length: 120 }, (_, i) => noteUnits(`Note about topic${i % 17} algorithm${i % 13} protocol${i % 11} module${i % 7} behaviour details`)[0]);
  const t0 = performance.now(); const r = await findMatches(notes, passagesOf(big)); const dt = performance.now() - t0;
  assert.ok(dt < 1500, "took " + dt); assert.ok(Array.isArray(r));
});
