// Calibration report for Smart linking: runs every labelled note of tests/unit/smartlink-corpus.mjs through the real scorer and shows where each one lands.
//   node tools/calibrate-smartlink.mjs            summary + every case
//   node tools/calibrate-smartlink.mjs --summary  summary only
//   node tools/calibrate-smartlink.mjs --holdout   the held-out set (notes the thresholds were never tuned on)
// Use it before changing a threshold or the scoring: the question is always "which labelled notes move over the line, and in which direction".
import { passagesOf, noteUnits, findMatches } from "../js/similar.js";
import { isConfident, SUGGEST_AT, AUTO_AT } from "../js/smartlink.js";
import * as CAL from "../tests/unit/smartlink-corpus.mjs";
import * as HOLD from "../tests/unit/smartlink-holdout.mjs";

export async function runCorpus({ floor = 0, set = CAL } = {}) {
  const { PAGES, CASES } = set, rows = [];
  for (const [page, label, note, at] of CASES) {
    const text = PAGES[page], units = noteUnits(note);
    const res = units.length ? await findMatches(units, passagesOf(text), { floor }) : [];
    const r = res.sort((a, b) => b.score - a.score)[0];
    const found = r ? text.slice(r.passage.s, r.passage.e) : null;
    rows.push({ page, label, note, at, r, found, right: !!(r && (!at || at.test(found))), score: r ? r.score : 0 });
  }
  return rows;
}
// what the app does with it: AUTO (linked on its own in the third mode), sug (offered as a suggestion), -- (nothing)
const decision = (x) => (x.r && isConfident(x.r) && x.score >= AUTO_AT ? "AUTO" : x.r && x.score >= SUGGEST_AT ? "sug " : "--  ");
const pct = (x) => (x * 100).toFixed(0).padStart(3) + "%";
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await runCorpus({ set: process.argv.includes("--holdout") ? HOLD : CAL }), summaryOnly = process.argv.includes("--summary");
  console.log(`thresholds in the app: suggest ${SUGGEST_AT}, auto ${AUTO_AT}\n`);
  if (!summaryOnly) for (const x of rows) {
    const r = x.r;
    console.log(`${x.label.padEnd(8)} ${r ? pct(r.score) : " --"} ${r ? `ex${r.exact} fz${r.fuzzy}${r.syn !== undefined ? " sy" + r.syn : ""} 2nd${pct(r.second)}` : "(no candidate)".padEnd(18)} ${x.at && r ? (x.right ? "right " : "WRONG ") : "      "}${decision(x)} ${x.note.slice(0, 70)}`);
  }
  console.log("\nlabel      n   AUTO  sugg  nothing   (AUTO / sugg only count when the right passage was found)   score range   median");
  for (const label of ["auto", "suggest", "related", "trap", "none"]) {
    const s = rows.filter((x) => x.label === label).map((x) => (x.at && !x.right ? 0 : x.score)).sort((a, b) => a - b);
    const g = rows.filter((x) => x.label === label), right = (x) => !x.at || x.right, auto = g.filter((x) => right(x) && decision(x) === "AUTO").length, sug = g.filter((x) => right(x) && decision(x) === "sug ").length;
    console.log(`${label.padEnd(8)} ${String(s.length).padStart(3)}  ${String(auto).padStart(4)}  ${String(sug).padStart(4)}  ${String(g.length - auto - sug).padStart(7)}   ${" ".repeat(60)}${pct(s[0])} .. ${pct(s[s.length - 1])}   ${pct(s[Math.floor(s.length / 2)])}`);
  }
}
