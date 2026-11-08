import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../../js/model.js";
import * as WS from "../../js/workspace.js";
(0, eval)(readFileSync(new URL("../../lib/jszip.min.js", import.meta.url), "utf8"));        // (the library is a plain browser script: it puts JSZip on the global object)

// Files written before the product was renamed carry the "DualNote-..." identifiers. They must keep opening; new files use the NoteFlow names.
const legacy = (o, from, to) => JSON.stringify(o).replace(from, to);
test("new files are written with NoteFlow identifiers", () => {
  assert.equal(JSON.parse(M.notebookToJson([{ paper: "lined", items: [] }])).format, "NoteFlow-notebook");
  assert.equal(JSON.parse(M.boardToJson({ paper: "white", grid: false, items: [] })).format, "NoteFlow-board");
  assert.equal(JSON.parse(M.pdfAnnotationsToJson([[]])).format, "NoteFlow-pdf-annotations");
  assert.equal(WS.WORKSPACE_FORMAT, "NoteFlow-workspace"); assert.equal(WS.EXT, ".nfws");
});
test("legacy notebook, board and PDF-annotation files are read", () => {
  const nb = JSON.parse(M.notebookToJson([{ paper: "grid", items: [{ t: "text", x: 1, y: 2, text: "hi", color: "#000000", size: 18 }] }]));
  nb.format = "DualNote-notebook"; const pages = M.parseNotebook(JSON.stringify(nb));
  assert.equal(pages[0].paper, "grid"); assert.equal(pages[0].items[0].text, "hi");
  const bd = JSON.parse(M.boardToJson({ paper: "black", grid: true, items: [] })); bd.format = "DualNote-board";
  assert.equal(M.parseBoard(JSON.stringify(bd)).paper, "black");
  const an = JSON.parse(M.pdfAnnotationsToJson([[], []])); an.format = "DualNote-pdf-annotations";
  assert.equal(M.parsePdfAnnotations(JSON.stringify(an), 2).length, 2);
  assert.throws(() => M.parseNotebook(JSON.stringify({ ...nb, format: "SomethingElse" })));
});
test("a legacy workspace (DualNote format in its manifest, notebook inside) opens; saving it again writes the new format", async () => {
  const blob = await WS.writeWorkspace({ notebook: [{ paper: "lined", items: [] }], settings: { a: 1 } });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const man = JSON.parse(await zip.file("manifest.json").async("string")); assert.equal(man.format, "NoteFlow-workspace");
  man.format = "DualNote-workspace"; zip.file("manifest.json", JSON.stringify(man));
  const nb = JSON.parse(await zip.file("notebook.json").async("string")); nb.format = "DualNote-notebook"; zip.file("notebook.json", JSON.stringify(nb));
  const old = await zip.generateAsync({ type: "uint8array" });
  const ws = await WS.readWorkspace(old);
  assert.equal(ws.notebook.length, 1); assert.deepEqual(ws.settings, { a: 1 });
  const again = await JSZip.loadAsync(await (await WS.writeWorkspace({ notebook: ws.notebook, settings: ws.settings })).arrayBuffer());
  assert.equal(JSON.parse(await again.file("manifest.json").async("string")).format, "NoteFlow-workspace");
});
test("a file of another kind is still refused with a clear message", async () => {
  const zip = new JSZip(); zip.file("manifest.json", JSON.stringify({ format: "Other", version: 1 }));
  await assert.rejects(WS.readWorkspace(await zip.generateAsync({ type: "uint8array" })), /not a NoteFlow workspace/);
});
