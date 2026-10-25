import test from "node:test"; import assert from "node:assert/strict";
import * as P from "../../js/paper.js";

test("default lined paper is exactly the paper of older versions", () => {
  const g = P.geometry("lined", 595, 842);
  assert.equal(g.pitch, 24); assert.equal(g.lastRule, 792); assert.equal(g.side, "left"); assert.equal(g.mx, 62); assert.equal(g.ruled, true);
});
test("right-to-left pages put the margin on the right and start the week on Saturday", () => {
  const s = P.paperSpec({ paper: "lined", dir: "rtl" });
  assert.equal(s.margin, "right"); assert.equal(s.week_start, "sat");
  assert.equal(P.paperSpec({ paper: "lined", dir: "rtl", margin: "left" }).margin, "left");
  const g = P.geometry(s); assert.ok(g.x1 < 595 - 62 && g.x0 === 12);
});
test("settings are clamped and junk is dropped", () => {
  assert.deepEqual(P.sanitizePaperProps({ spacing: 1000, margin: "up", dir: "rtl", cue: "x", margin_x: 5 }), { spacing: 60, dir: "rtl", margin_x: 30 });
  assert.equal(P.paperSpec({ paper: "nope" }).paper, "blank");
  assert.equal(P.paperSpec({ paper: "grid" }).spacing, 20);
  assert.equal(P.paperSpec({ paper: "lined", spacing: 100 }).spacing, 48);
});
test("custom spacing moves the last rule and text area; cornell has its own text area", () => {
  assert.equal(P.geometry({ paper: "lined", spacing: 32 }).lastRule, 72 + 32 * 23);
  const c = P.geometry({ paper: "cornell" }); assert.equal(c.x0, 158); assert.ok(c.lastRule < 842 - 130 && c.lastRule > 842 - 130 - 30);
  const r = P.geometry({ paper: "cornell", dir: "rtl" }); assert.equal(r.side, "right"); assert.equal(r.x1, 595 - 158);
  assert.equal(P.geometry("weekly").flow, null); assert.equal(P.geometry("blank").ruled, false);
});
test("weekday order follows the week start and language", () => {
  assert.equal(P.weekDays({ dir: "ltr", week_start: "mon" })[0], "Monday"); assert.equal(P.weekDays({ dir: "ltr", week_start: "sun" })[0], "Sunday");
  assert.equal(P.weekDays({ dir: "rtl", week_start: "sat" })[0], "شنبه"); assert.equal(P.weekDays({ dir: "ltr", week_start: "sat" }).length, 7);
});
