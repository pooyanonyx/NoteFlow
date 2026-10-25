import test from "node:test"; import assert from "node:assert/strict";
import { useStubMeasure, text } from "./helpers.mjs";
import * as F from "../../js/flow.js"; import * as P from "../../js/paper.js"; import * as RT from "../../js/richtext.js";
const R = useStubMeasure();
let id = 0;
const env = { layout: (d) => R.layoutRich(d), geoOf: (pg) => P.geometry(pg), newPage: (prev) => ({ paper: prev.paper, items: [] }), newId: () => "f" + ++id };
const page = (paper = "lined", items = []) => ({ paper, items });
const words = (n) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
const joinAll = (pages) => { let c = null; for (const pg of pages) for (const d of pg.items) if (d.t === "text") c = c ? RT.concat(c, RT.contentOf(d), d.cont === true) : RT.contentOf(d); return c; };

test("text that does not fit flows on to new pages; nothing is lost; lines stay on rules", () => {
  const src = text({ ruled: true, size: 16, w: 200, y: 44, text: Array.from({ length: 80 }, (_, i) => "line " + i).join("\n") });
  const pages = [page("lined", [src])];
  const r = F.reflowChain(pages, 0, 0, env);
  assert.ok(r.pages.length >= 3, "pages: " + r.pages.length);
  assert.equal(joinAll(r.pages).text, src.text);
  for (const pg of r.pages) { const d = pg.items[0]; const L = R.layoutRich(d); assert.ok(d.y + 4 + L.height <= 792 + 0.01, "fits the page"); assert.equal(Math.abs((d.y + 4 - 72) % 24), 0); }
  assert.ok(r.pages.slice(1).every((pg) => pg.items[0].y === 44 && pg.items[0].fl === r.pages[0].items[0].fl));
  assert.equal(r.pages[0].items[0].cont, undefined); assert.equal(r.pages[1].items[0].cont, undefined);   // split at "\n": new paragraphs
});
test("reflowing again changes nothing (idempotent) and a short text collapses back to one box", () => {
  const src = text({ ruled: true, w: 200, text: Array.from({ length: 80 }, (_, i) => "line " + i).join("\n") });
  const a = F.reflowChain([page("lined", [src])], 0, 0, env);
  const b = F.reflowChain(a.pages, 0, 0, env);
  assert.deepEqual(b.pages, a.pages);
  const cut = a.pages.map((pg, i) => (i === 0 ? { ...pg, items: [{ ...pg.items[0], text: "tiny" }] } : { ...pg, items: [] }));   // everything after the first piece deleted
  const c = F.reflowChain(cut, 0, 0, env);
  assert.equal(c.pages[0].items.length, 1); assert.equal(c.pages[0].items[0].fl, undefined);
  const shrunk = F.reflowChain(a.pages, 0, 0, env, { pi: 0, idx: 0, item: { ...a.pages[0].items[0], text: "line 0\nline 1" } });   // the later pieces slide up into the freed space
  assert.ok(joinAll(shrunk.pages).text.startsWith("line 0\nline 1\nline "));
});
test("a soft wrap across the page break continues the paragraph", () => {
  const src = text({ ruled: true, w: 120, size: 16, text: words(900) });
  const r = F.reflowChain([page("lined", [src])], 0, 0, env);
  assert.ok(r.pages[1].items[0].cont === true);
  assert.equal(joinAll(r.pages).text, src.text);
});
test("rich runs and lists survive the cut; numbering continues", () => {
  const n = 70, txt = Array.from({ length: n }, (_, i) => "item " + i).join("\n");
  const src = text({ ruled: true, w: 200, text: txt, lists: Array(n).fill("n"), runs: [{ s: "item 0", b: 1 }, { s: txt.slice(6) }] });
  const r = F.reflowChain([page("lined", [src])], 0, 0, env);
  const second = r.pages[1].items[0]; assert.ok(second.ns > 0);
  const L = R.layoutRich(second); assert.equal(L.lines[0].marker.text, (second.ns + 1) + ".");
  const all = joinAll(r.pages); assert.equal(all.text, txt); assert.equal(all.runs[0].b, 1); assert.equal(all.lists.length, n);
});
test("editing a later piece reflows the whole chain; the caret position can be located", () => {
  const src = text({ ruled: true, w: 200, text: Array.from({ length: 80 }, (_, i) => "line " + i).join("\n") });
  const a = F.reflowChain([page("lined", [src])], 0, 0, env);
  const head = F.chainHead(a.pages, 1, 0); assert.deepEqual(head, { pi: 0, idx: 0 });
  const li = a.pages.length - 1, edited = { ...a.pages[li].items[0], text: a.pages[li].items[0].text + "\nEND" };
  const b = F.reflowChain(a.pages, 0, 0, env, { pi: li, idx: 0, item: edited });
  assert.ok(joinAll(b.pages).text.endsWith("END"));
  const loc = F.locate(b.pieces, b.pieces.at(-1).start + 2); assert.equal(loc.piece, b.pieces.at(-1)); assert.equal(loc.local, 2);
});
test("a new, not yet placed box can be the head (typing at the bottom of a page)", () => {
  const it = text({ ruled: true, y: 740 - 4, w: 200, text: Array.from({ length: 10 }, (_, i) => "l" + i).join("\n") });
  const r = F.reflowChain([page("lined", [])], 0, null, env, { pi: 0, idx: null, item: it });
  assert.equal(r.pages.length, 2); assert.equal(r.pages[0].items.length, 1); assert.equal(joinAll(r.pages).text, it.text);
});
test("free paper uses the page margins; weekly planners do not flow", () => {
  const src = text({ y: 40, w: 200, size: 20, text: Array.from({ length: 80 }, (_, i) => "x" + i).join("\n") });
  const r = F.reflowChain([page("blank", [src])], 0, 0, env);
  assert.ok(r.pages.length > 1); const d = r.pages[0].items[0]; assert.ok(d.y + 4 + R.layoutRich(d).height <= 842 - 36 + 0.01);
  const w = F.reflowChain([page("weekly", [src])], 0, 0, env); assert.equal(w.pages.length, 1);
});
