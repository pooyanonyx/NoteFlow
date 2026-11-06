import test from "node:test"; import assert from "node:assert/strict";
import { contentTokens, passagesOf, noteUnits, findMatches, matchRanges } from "../../js/similar.js";

// A page of several paragraphs about different things: a short note must come back as the specific sentence (or clause) it is about, not as the block that contains it.
const FILLER = [
  "The registry keeps the configuration of every installed service in a single hierarchical store.",
  "Backups are scheduled every night and are copied to a second location for safety.",
  "Printers are shared through a queue that serves the jobs in the order they arrive.",
  "Monitoring dashboards show the load of each server and warn the operators about disk problems.",
  "Passwords must be changed every ninety days according to the policy of the department.",
  "The cafeteria on the third floor opens at eight and serves breakfast until ten in the morning.",
];
const TARGET = "The TCP handshake establishes a reliable connection using three steps: SYN, SYN-ACK and ACK.";
const PAGE = [FILLER[0], FILLER[1], TARGET, FILLER[2], FILLER[3], FILLER[4], FILLER[5]].join(" ");
const run = async (note, text = PAGE) => { const r = await findMatches(noteUnits(note), passagesOf(text), { floor: 0.3 }); return r.map((x) => ({ ...x, text: text.slice(x.passage.s, x.passage.e) })); };

test("a short note gets the one sentence it is about, not the window of 3 sentences around it", async () => {
  const [r] = await run("TCP handshake: three steps, SYN then SYN-ACK then ACK");
  assert.ok(r, "matched"); assert.equal(r.text, TARGET); assert.ok(r.passage.narrowed || r.passage.e - r.passage.s === TARGET.length);
  assert.ok(!/registry|Backups|Printers|Monitoring/.test(r.text));
});
test("the narrowed range carries its own tokens and numbers (the evidence describes what is shown)", async () => {
  const [r] = await run("TCP handshake: three steps, SYN then SYN-ACK then ACK");
  assert.deepEqual(r.passage.toks.map((x) => x.t), contentTokens(r.text).map((x) => x.t));
  assert.equal(r.passage.parts, undefined);
});
test("a statement spread over two neighbouring sentences keeps both (enough context)", async () => {
  const text = "Logs are rotated daily. The server answers a request with a status code. The code tells the client whether the request succeeded or failed. Interns receive a badge on their first day.";
  const [r] = await run("The server answers every request with a status code that tells the client whether it succeeded or failed", text);
  assert.ok(r); assert.ok(/status code\. The code tells/.test(r.text) || /answers a request with a status code/.test(r.text));
  assert.ok(!/Interns|Logs are rotated/.test(r.text));
});
test("two separate relevant sentences are not glued together across an unrelated one", async () => {
  const text = "Encryption protects data in transit between two hosts. The cafeteria opens at eight and closes at four every weekday. Encryption keys are rotated every year by the security team. Parking is free on weekends.";
  const rs = await run("encryption keys rotated yearly by security team", text);
  assert.ok(rs.length); assert.ok(!/cafeteria/.test(rs[0].text), rs[0].text);
});
test("a long sentence is cut at its clauses when the note is short, keeping some context", async () => {
  const long = "In the early years of the project the team wrote everything by hand, the build system compiled each module separately and cached the objects on a shared disk, " +
    "and after the move to the new office the weekly meetings were held on Mondays, although nobody could remember why the day had been chosen in the first place and nobody wanted to change it.";
  const [r] = await run("build system compiled each module separately and cached objects on shared disk", long + " Other text follows here about nothing in particular at all.");
  assert.ok(r); assert.ok(r.text.length < long.length * 0.7, r.text); assert.ok(/compiled each module/.test(r.text)); assert.ok(r.text.split(/\s+/).length >= 8);
});
test("a short passage that is entirely relevant is returned whole", async () => {
  const text = "Alpha beta gamma delta. Photosynthesis converts light energy into chemical energy inside the chloroplasts of plant cells. Epsilon zeta eta theta.";
  const [r] = await run("photosynthesis converts light into chemical energy in chloroplasts", text);
  assert.ok(r); assert.equal(r.text, "Photosynthesis converts light energy into chemical energy inside the chloroplasts of plant cells.");
});
test("an item that is one long paragraph is narrowed too (other surfaces, not only PDFs)", async () => {
  const para = FILLER.slice(0, 3).join(" ") + " " + TARGET + " " + FILLER.slice(3).join(" ");
  const units = noteUnits(para); assert.ok(units.length);
  const r = await findMatches(noteUnits("TCP handshake three steps SYN SYN-ACK ACK"), units.concat(noteUnits("Totally unrelated words about gardening and tomatoes in summer weather")), { floor: 0.3 });
  assert.ok(r.length); assert.equal(para.slice(r[0].passage.s, r[0].passage.e), TARGET);
});
test("Persian: a short note finds its sentence inside a longer paragraph", async () => {
  const fa = "جدول هش جفت‌های کلید و مقدار را ذخیره می‌کند و جستجو در آن سریع است. شبکه‌های عصبی از لایه‌های متعدد نورون تشکیل شده‌اند و آموزش آنها با داده انجام می‌شود. پایگاه داده اطلاعات را در جدول‌ها نگه می‌دارد.";
  const [r] = await run("شبکه‌های عصبی از چند لایه نورون ساخته شده‌اند", fa);
  assert.ok(r); assert.ok(r.text.startsWith("شبکه‌های عصبی")); assert.ok(!/جدول هش|پایگاه/.test(r.text));
});
test("matchRanges marks the words that matched (exact, same meaning, same root), nothing else", () => {
  const note = contentTokens("the client confirms the connection with ACK");
  const text = "The client confirms with ACK and the connections open.";
  const hits = matchRanges(note, text).map(([a, b]) => text.slice(a, b));
  assert.ok(hits.includes("client") && hits.includes("confirms") && hits.includes("ACK") && hits.includes("connections"), hits.join("|"));
  assert.ok(!hits.includes("open.") && !hits.includes("and"));
});

// the case that showed the problem: the best-scoring window was three sentences long and brought a neighbouring sentence about something else along with the right one
import * as CAL from "./smartlink-corpus.mjs";
test("corpus: a note about SQL tables is not returned together with the neighbouring sentence about hash tables", async () => {
  const row = CAL.CASES.find((c) => c[2].startsWith("پایگاه داده اطلاعات را در قالب"));
  assert.ok(row); const text = CAL.PAGES[row[0]];
  const [r] = await findMatches(noteUnits(row[2]), passagesOf(text), { floor: 0.3 });
  const shown = text.slice(r.passage.s, r.passage.e);
  assert.ok(shown.includes("SQL")); assert.ok(!shown.includes("جدول هش") && !shown.includes("جستجوی دودویی"), shown);
});
