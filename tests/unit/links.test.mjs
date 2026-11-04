import test from "node:test"; import assert from "node:assert/strict";
import * as M from "../../js/model.js";
import { LinkStore, sanitizeAnchor, anchorKey, anchorShape, LINKS_FORMAT } from "../../js/links.js";

const H1 = "a".repeat(64), H2 = "b".repeat(64);
const item = (id, slot = "nb") => ({ k: "item", id, slot, pv: "my note" });
const page = (n, extra = {}, doc = H1) => ({ k: "pdf", doc, name: "net.pdf", page: n, pv: "Page " + (n + 1), ...extra });

test("a link joins two anchors and is found from either end; several links can meet at one place", () => {
  const s = new LinkStore();
  const { link } = s.add(item("i1"), page(19)); s.add(item("i2"), page(19)); s.add(item("i1"), page(7, { rect: [10, 10, 100, 50] }));
  assert.equal(s.size, 3);
  assert.deepEqual(s.forItem("i1").length, 2);
  assert.equal(s.forPdfPage(H1, 19).length, 2);                       // two notes on page 20
  assert.equal(s.forPdfPage(H1, 7).length, 1);
  assert.equal(s.otherEnd(link, item("i1")).page, 19); assert.equal(s.otherEnd(link, page(19)).id, "i1");
  assert.equal(anchorKey(page(19, { rect: [1, 2, 3, 4] })), anchorKey(page(19)));       // regions / passages are found through their page
});
test("the same connection is not made twice (either direction); a link to itself is refused", () => {
  const s = new LinkStore(); const a = s.add(item("i1"), page(3)), b = s.add(page(3), item("i1"));
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(b.link.id, a.link.id); assert.equal(s.size, 1);
  assert.equal(s.add(item("i1"), item("i1")), null);
  assert.equal(s.add(page(3), page(3)), null);
  assert.notEqual(s.add(page(3, { rect: [0, 0, 5, 5] }), item("i1")), null);           // another place on the same page IS another link
});
test("anchor shapes: item, page, region, text passage", () => {
  assert.deepEqual([item("x"), page(1), page(1, { rect: [0, 0, 1, 1] }), page(1, { quote: { text: "hello", rects: [[0, 0, 1, 1]] } })].map(anchorShape), ["item", "page", "region", "text"]);
});
test("removing a link updates both ends; clear empties everything", () => {
  const s = new LinkStore(), { link } = s.add(item("i1"), page(1));
  assert.equal(s.remove(link.id), true); assert.equal(s.forItem("i1").length, 0); assert.equal(s.hasKey("p:" + H1 + ":1"), false); assert.equal(s.remove("nope"), false);
  s.add(item("i1"), page(1)); s.clear(); assert.equal(s.size, 0);
});
test("save and load round trip; invalid / hostile entries are dropped, nothing throws", () => {
  const s = new LinkStore(); s.add(item("i1"), page(19, { quote: { text: "TCP handshake", rects: [[1, 2, 3, 4]] } })); s.add(item("i2", "board"), page(2, { rect: [0, 0, 9, 9] }, H2));
  const json = JSON.stringify(s.toJSON()), t = new LinkStore();
  assert.equal(t.load(json), 0); assert.deepEqual(t.toJSON().links.map((l) => [l.a, l.b]), s.toJSON().links.map((l) => [l.a, l.b]));
  const bad = { format: LINKS_FORMAT, version: 1, links: [null, 5, { a: item("x") }, { a: item("x"), b: item("x") }, { id: "q", a: { k: "pdf", doc: "zz", page: 1 }, b: item("y") },
    { a: { k: "pdf", doc: H1, page: -1 }, b: item("y") }, { a: item("ok"), b: page(1, { rect: [1, 2, "x", 4] }) }] };
  const u = new LinkStore(); assert.equal(u.load(bad), 6); assert.equal(u.size, 1); assert.equal(u.all()[0].b.rect, undefined);       // the bad rect is dropped, the link kept
  assert.equal(new LinkStore().load("not json"), 0); assert.equal(new LinkStore().load({ format: "other" }), 0);
  assert.equal(sanitizeAnchor({ k: "item", id: "x".repeat(100), pv: "p".repeat(999) }).id.length, 40);
});
test("duplicate ids in a file get fresh ones", () => {
  const raw = { format: LINKS_FORMAT, version: 1, links: [{ id: "L", a: item("a"), b: page(1) }, { id: "L", a: item("b"), b: page(2) }] };
  const s = new LinkStore(); s.load(raw); assert.equal(s.size, 2); assert.equal(new Set(s.all().map((l) => l.id)).size, 2);
});
test("listeners are told about every change", () => {
  const s = new LinkStore(); let n = 0; const off = s.onChange(() => n++);
  const { link } = s.add(item("i1"), page(1)); s.remove(link.id); s.add(item("i1"), page(1)); assert.equal(n, 3); off(); s.clear(); assert.equal(n, 3);
});

test("item ids: kept through load / save, made once, not copied onto the pieces of an erased stroke", () => {
  const d = M.sanitizeItem({ t: "text", x: 0, y: 0, text: "hi", color: "#000000", size: 12, id: "ixyz" });
  assert.equal(d.id, "ixyz");
  assert.equal(M.sanitizeItem({ t: "rect", x1: 0, y1: 0, x2: 5, y2: 5, color: "#000000", w: 2, id: "ir" }).id, "ir");
  assert.equal(M.sanitizeItem({ t: "text", x: 0, y: 0, text: "hi", color: "#000000", size: 12 }).id, undefined);       // old files stay as they are
  const a = {}; const id = M.ensureId(a); assert.equal(M.ensureId(a), id); assert.match(id, /^i[a-z0-9]+$/);
  const stroke = { t: "pen", color: "#000000", w: 2, id: "ipen", pts: [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0]] };
  const parts = M.erasePen(stroke, [24, -5], [26, 5], 1); assert.equal(parts.length, 2); assert.equal(parts[0].id, "ipen"); assert.equal(parts[1].id, undefined);
  const nb = M.parseNotebook(M.notebookToJson([{ paper: "lined", items: [d] }])); assert.equal(nb[0].items[0].id, "ixyz");
});

test("smart links: src and score are kept, only known values are accepted, manual links have neither", () => {
  const s = new LinkStore();
  const a = s.add(item("i1"), page(1), { src: "suggested", score: 0.734 }).link, b = s.add(item("i2"), page(2), { src: "auto", score: 3 }).link, c = s.add(item("i3"), page(3)).link;
  const d = s.add(item("i4"), page(4), { src: "bogus", score: 0.5 }).link;
  assert.deepEqual([a.src, a.score, b.src, b.score, c.src, c.score, d.src, d.score], ["suggested", 0.73, "auto", 1, undefined, undefined, undefined, undefined]);
  assert.equal(s.countSrc(), 2); assert.equal(s.countSrc("auto"), 1);
  const t = new LinkStore(); t.load(JSON.stringify(s.toJSON()));
  assert.deepEqual(t.all().map((l) => [l.src, l.score]).sort(), s.all().map((l) => [l.src, l.score]).sort());
  assert.equal(JSON.parse(JSON.stringify(s.toJSON())).links.find((l) => l.id === c.id).src, undefined);          // a manual link is written exactly as before
  const u = new LinkStore(); u.load({ format: LINKS_FORMAT, version: 1, links: [{ a: item("x"), b: page(1), src: "evil", score: "high" }] });
  assert.equal(u.all()[0].src, undefined); assert.equal(u.all()[0].score, undefined);
});
test("rejected suggestions are remembered, saved, bounded and cleared with the links", () => {
  const s = new LinkStore(); s.reject("abc|pdf:1:2:3"); s.reject("def");
  assert.equal(s.isRejected("abc|pdf:1:2:3"), true); assert.equal(s.isRejected("zzz"), false);
  const t = new LinkStore(); t.load(JSON.stringify(s.toJSON())); assert.equal(t.isRejected("def"), true); assert.equal(t.rejects.size, 2);
  t.load({ format: LINKS_FORMAT, version: 1, links: [], rejects: [5, null, "ok"] }); assert.deepEqual([...t.rejects], ["ok"]);
  const big = new LinkStore(); for (let i = 0; i < 3100; i++) big.reject("k" + i); assert.equal(big.rejects.size, 3000); assert.equal(big.isRejected("k0"), false); assert.equal(big.isRejected("k3099"), true);
  s.clear(); assert.equal(s.rejects.size, 0);
  assert.equal("rejects" in new LinkStore().toJSON(), false);                                                       // nothing to keep: nothing written
});

// ---------------------------------------------------------------- orphaned links are deleted (the data model keeps itself consistent)
const alive = (ids, docs = null) => ({ hasItem: (id) => ids.includes(id), hasDoc: docs ? (h) => docs.includes(h) : null });
test("prune: deleting an item deletes its links, whichever end it was (note -> PDF, note -> note); the others stay", () => {
  const s = new LinkStore(); s.add(item("n1"), page(3)); s.add(page(5), item("n2")); s.add(item("n3"), item("n4")); s.add(item("n1"), item("n4"));
  const r = s.prune(alive(["n2", "n3", "n4"]));                                  // n1 was deleted
  assert.equal(r.removed.length, 2); assert.equal(s.size, 2);
  assert.equal(s.forItem("n1").length, 0); assert.equal(s.forPdfPage(H1, 3).length, 0);              // the index is clean too: nothing points at a removed link
  assert.equal(s.forItem("n4").length, 1); assert.equal(s.forPdfPage(H1, 5).length, 1);
  assert.equal(s.prune(alive(["n2", "n3", "n4"])).removed.length, 0);                          // nothing to do the second time
  const r2 = s.prune(alive(["n2"]));                                                    // n3 and n4 deleted
  assert.equal(r2.removed.length, 1); assert.equal(s.size, 1);
});
test("prune: a PDF that is no longer open takes the links to it along (page, region and quote links alike); links to another PDF stay", () => {
  const s = new LinkStore(); s.add(item("n1"), page(1)); s.add(item("n2"), page(2, { rect: [1, 1, 9, 9] })); s.add(item("n3"), page(3, { quote: { text: "hello", rects: [] } }, H2)); s.add(item("n1"), item("n2"));
  const r = s.prune(alive(["n1", "n2", "n3"], [H2]));
  assert.equal(r.removed.length, 2); assert.equal(s.size, 2); assert.equal(s.forPdfPage(H1, 1).length, 0); assert.equal(s.forPdfPage(H2, 3).length, 1);
});
test("prune: with hasDoc = null the PDF ends are left alone (a PDF that is still being opened)", () => {
  const s = new LinkStore(); s.add(item("n1"), page(1)); assert.equal(s.prune(alive(["n1"])).removed.length, 0); assert.equal(s.size, 1);
});
test("prune tells the listeners once, and only when something changed", () => {
  const s = new LinkStore(); s.add(item("n1"), page(1)); s.add(item("n2"), page(2)); let n = 0; s.onChange(() => n++);
  s.prune(alive(["n1", "n2"])); assert.equal(n, 0);
  s.prune(alive([])); assert.equal(n, 1); assert.equal(s.size, 0);
});
test("undo of a deletion brings the link back (in memory only); a link lost with its PDF never comes back", () => {
  const s = new LinkStore(); s.add(item("n1"), page(1)); s.add(item("n2"), page(2));
  s.prune(alive(["n2"]), null); assert.equal(s.size, 1); assert.equal(s.graveSize, 1);
  const r = s.prune(alive(["n1", "n2"])); assert.equal(r.revived.length, 1); assert.equal(s.size, 2); assert.equal(s.graveSize, 0);    // (the note is back)
  s.prune(alive(["n2"])); s.prune(alive(["n1", "n2"]));                                      // delete, undo, ... as often as you like
  assert.equal(s.size, 2);
  const t = new LinkStore(); t.add(item("n1"), page(1));
  t.prune(alive(["n1"], [H2])); assert.equal(t.size, 0); assert.equal(t.graveSize, 0);          // PDF gone: gone for good
  t.prune(alive(["n1"], [H1])); assert.equal(t.size, 0);
});
test("a link made again while the first one waited for an Undo is not doubled; a manual removal and load() empty the waiting list", () => {
  const s = new LinkStore(); s.add(item("n1"), page(1)); s.prune(alive([]));
  s.add(item("n1"), page(1)); assert.equal(s.size, 1);                                          // the same connection, made again by hand
  s.prune(alive(["n1"])); assert.equal(s.size, 1); assert.equal(s.graveSize, 0);
  s.prune(alive([])); assert.equal(s.graveSize, 1); s.load(null); assert.equal(s.graveSize, 0);
  const u = new LinkStore(); u.add(item("n1"), page(1)); u.prune(alive([])); u.clear(); assert.equal(u.graveSize, 0);
});
test("a link that was removed for a deleted item is not saved: save -> load gives no orphan", () => {
  const s = new LinkStore(); s.add(item("n1"), page(1)); s.add(item("n2"), page(2)); s.prune(alive(["n2"]));
  const t = new LinkStore(); t.load(JSON.parse(JSON.stringify(s.toJSON()))); assert.equal(t.size, 1); assert.equal(t.forItem("n1").length, 0); assert.equal(t.graveSize, 0);
});
test("the waiting list is bounded", () => {
  const s = new LinkStore(); for (let i = 0; i < 520; i++) s.add(item("x" + i), page(i % 50 + 1000, {}, H1) );
  s.prune(alive([])); assert.ok(s.graveSize <= 500);
});
