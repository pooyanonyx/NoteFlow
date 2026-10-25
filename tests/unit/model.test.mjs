import test from "node:test"; import assert from "node:assert/strict";
import * as M from "../../js/model.js";
import * as T from "../../js/tools.js";

test("an old notebook file loads exactly as before", () => {
  const old = JSON.stringify({ format: "DualNote-notebook", version: 1, pages: [{ paper: "lined", items: [{ t: "text", x: 1, y: 2, text: "hi", color: "#000000", size: 18, ruled: true }] }, { paper: "grid", items: [] }] });
  const p = M.parseNotebook(old);
  assert.deepEqual(p[0], { paper: "lined", items: [{ t: "text", x: 1, y: 2, text: "hi", color: "#000000", size: 18, ruled: true }] });
  assert.deepEqual(p[1], { paper: "grid", items: [] });
  assert.equal(JSON.parse(M.notebookToJson(p)).pages[0].margin, undefined);                  // nothing new is written unless it was set
});
test("page settings and rich text survive save and open", () => {
  const item = { t: "text", x: 1, y: 2, w: 200, text: "ab\ncd", color: "#000000", size: 18, runs: [{ s: "ab", b: 1 }, { s: "\ncd" }], lists: ["b", ""], fl: "q", cont: true, ns: 2, rp: 32 };
  const pages = [{ paper: "cornell", items: [item], spacing: 30, margin: "right", dir: "rtl", cue: 120, summary: 100 }, { paper: "weekly", items: [], week_start: "sun" }, { paper: "dotted", items: [], spacing: 15 }];
  const back = M.parseNotebook(M.notebookToJson(pages));
  assert.deepEqual(back, pages);
});
test("damaged rich fields are dropped but the text is kept", () => {
  const d = M.sanitizeItem({ t: "text", x: 0, y: 0, text: "abc", color: "#000000", size: 10, runs: [{ s: "zzz", b: 1 }], lists: "x", rp: "a", cont: true });
  assert.equal(d.text, "abc"); assert.equal(d.runs, undefined); assert.equal(d.lists, undefined); assert.equal(d.cont, undefined);   // cont only makes sense inside a chain
});
test("unknown paper falls back to blank; unknown page settings are ignored", () => {
  const p = M.parseNotebook(JSON.stringify({ format: "DualNote-notebook", pages: [{ paper: "x", items: [], margin: "up", spacing: "zz" }] }));
  assert.deepEqual(p[0], { paper: "blank", items: [] });
});
test("resizing a text box scales the sizes inside it", () => {
  const d = { t: "text", x: 0, y: 0, text: "ab", color: "#000000", size: 10, runs: [{ s: "a" }, { s: "b", z: 20 }] };
  const n = M.resizeItem(d, "se", 40, 40, [0, 0, 20, 20], 0, true);
  assert.ok(n.size > 10); assert.ok(Math.abs(n.runs[1].z / n.size - 2) < 0.02);
});

test("every tool starts from its own defaults, by panel kind", () => {
  assert.equal(T.toolDefaults("pdf").pen.color, "#d32f2f"); assert.equal(T.toolDefaults("nb").pen.color, "#1a1a1a"); assert.equal(T.toolDefaults("board", true).text.color, "#f2f2f2");
  assert.deepEqual(T.toolDefaults("nb").mark, { color: "#fdd835", width: 14, size: 18, alpha: 110, bright: 0 });
  const d = T.toolDefaults("nb"); d.pen.width = 9; assert.equal(T.toolDefaults("nb").pen.width, 2);       // a fresh copy every time
  assert.equal(T.TOOL_GROUP.node, T.TOOL_GROUP.link);
});
test("old workspaces: the shared draw set is copied to every tool that shared it", () => {
  const def = T.toolDefaults("nb"), san = (v, d) => M.sanitizeStyle(v, d);
  const g = T.groupsFromSaved({ groups: { draw: { color: "#0000ff", width: 5 }, erase: { width: 33 } } }, def, san);
  for (const k of T.LEGACY_DRAW_GROUPS) { assert.equal(g[k].color, "#0000ff"); assert.equal(g[k].width, 5); }
  assert.equal(g.eraser.width, 33); assert.equal(g.mark.width, 14);
  const saved = T.groupsToSaved(g), again = T.groupsFromSaved(saved, def, san);
  assert.deepEqual(again, g);
  g.pen.color = "#ff0000"; assert.equal(T.groupsFromSaved(T.groupsToSaved(g), def, san).text.color, "#0000ff");   // new files keep tools apart
});
