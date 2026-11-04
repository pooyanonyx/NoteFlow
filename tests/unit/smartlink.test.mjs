import test from "node:test"; import assert from "node:assert/strict";
import { passagesOf, noteUnits, findMatches } from "../../js/similar.js";
import { isConfident, AUTO_AT, SUGGEST_AT, AUTO_MIN_WORDS, AUTO_MARGIN, MODES } from "../../js/smartlink.js";

// What "link on their own when very sure" does with a note and a PDF page: the same scoring the app uses, then the decision of isConfident.
const FILL = Array.from({ length: 4 }, (_, i) => `Filler paragraph number ${i + 1} about vegetable gardening, compost, watering schedules and unrelated seasonal planting advice for beginners.`).join(" ");
async function decide(note, passage) {
  const r = (await findMatches(noteUnits(note), passagesOf(passage + " " + FILL), { floor: SUGGEST_AT }))[0];
  return r ? { score: r.score, confident: isConfident(r), exact: r.exact, second: r.second } : { score: 0, confident: false };
}

test("the third mode keeps its name, and the threshold is moderate: below near-verbatim, above the suggestion floor", () => {
  assert.deepEqual(MODES.map(([v]) => v), ["off", "suggest", "auto"]);
  assert.equal(MODES[2][1], "Suggest, and link on their own when very sure");
  assert.ok(AUTO_AT <= 0.75 && AUTO_AT >= SUGGEST_AT + 0.1, AUTO_AT);
});
test("clearly related content is linked automatically: verbatim, light and moderate rewordings", async () => {
  const pairs = [
    ["The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK", "The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK."],
    ["The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK", "The TCP handshake establishes a reliable connection between two hosts using three steps: the client sends SYN, the server answers with SYN-ACK, and the client confirms with ACK."],
    ["Mitochondria produce ATP through oxidative phosphorylation", "Most ATP in the cell is produced by the mitochondria via oxidative phosphorylation along the inner membrane."],   // .86: used to be only suggested
    ["Supply and demand determine the market price of goods", "In a market, the price of goods is determined by supply and demand."],                                         // .88
    ["Neurons receive signals through dendrites and send them along the axon", "A neuron receives signals through its dendrites and transmits them along the axon to other cells."],                    // .80
    ["شبکه‌های عصبی از لایه‌های متعدد نورون تشکیل شده‌اند", "شبکه‌های عصبی از لایه‌های متعدد نورون تشکیل شده‌اند. این مدل در یادگیری ماشین کاربرد دارد."],
  ];
  for (const [n, p] of pairs) { const d = await decide(n, p); assert.ok(d.confident, JSON.stringify([n.slice(0, 40), d])); }
});
test("content that is only loosely related, or about other facts of the same topic, is NOT linked automatically", async () => {
  const pairs = [
    ["The TCP connection teardown takes four steps: each side sends FIN and the other side replies with ACK", "The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK."],
    ["UDP is a connectionless protocol that sends datagrams without any handshake or acknowledgment", "TCP is a connection oriented protocol that uses a handshake and acknowledgment to guarantee delivery of segments."],
    ["Binary search tree insertion runs in logarithmic time on average", "An AVL tree is a self balancing binary search tree where insertion requires rotations to keep the height logarithmic."],
    ["Remember to review the project budget with the finance team before the quarterly planning meeting", "The project budget is divided between the finance team and the engineering team for each quarter of the planning cycle."],
    ["Machine learning models need training data and validation data to measure accuracy", "Deep learning models need a large amount of training data, and accuracy depends on how data is cleaned and labelled."],
    ["Buy milk eggs bread and fresh vegetables tomorrow morning", "Some unrelated text about astronomy and the orbit of distant planets around bright stars."],
    ["شبکه‌های عصبی از لایه‌های متعدد نورون تشکیل شده‌اند", "هر شبکه عصبی شامل چندین لایه است و هر لایه از نورون‌ها ساخته می‌شود."],            // Persian, other words: only a suggestion at best
  ];
  for (const [n, p] of pairs) { const d = await decide(n, p); assert.ok(!d.confident, JSON.stringify([n.slice(0, 40), d])); }
});
test("isConfident: score, words that match exactly, and a clear lead over the next best place are all required", () => {
  assert.equal(isConfident({ score: AUTO_AT, exact: AUTO_MIN_WORDS, second: 0 }), true);
  assert.equal(isConfident({ score: AUTO_AT - 0.01, exact: 9, second: 0 }), false);                       // not sure enough
  assert.equal(isConfident({ score: 0.95, exact: AUTO_MIN_WORDS - 1, second: 0 }), false);                // matches mostly by word beginnings
  assert.equal(isConfident({ score: 0.9, exact: 8, second: 0.9 - AUTO_MARGIN + 0.01 }), false);           // fits another place almost as well
  assert.equal(isConfident({ score: 0.9, exact: 8, second: 0.9 - AUTO_MARGIN }), true);
  assert.equal(isConfident(null), false);
});
