"""A link never outlives what it connects: when either end is deleted, the link is deleted too (data model level, not only the UI).
Covers: every surface (notebook, 2nd notebook, both boards, annotations of both PDFs), the Delete key, mind-map branches, deleting a page, closing / replacing a PDF,
Undo / Redo of a deletion, save + reopen (workspace file and session backup), files that already hold orphaned links, and that nothing is deleted by mistake
(editing, moving, restyling, reflowing a long text, opening a workspace)."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

PDF_JS = """async ([key, tag]) => {
  const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 6; i++) { const p = doc.addPage([595, 842]); p.drawText('Page ' + i + ' network security basics ' + tag, { x: 60, y: 760, size: 18, font: f }); p.drawText('Filler text number ' + i, { x: 60, y: 700, size: 14, font: f }); }
  const bytes = await doc.save(); return await noteflow.panels[key].openPdfBytes(bytes, key + '.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); kb = a.page.keyboard
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=30000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    def layout(keys): P("async (k) => { await noteflow.setLayout(k, false); }", keys); a.page.wait_for_timeout(350)
    def mk(key, text, y=100, page=None):                          # a text item on the current page of a panel, with a stable id (as when it is linked) -> its anchor
        return P("""([k, t, y, pg]) => { const p = noteflow.panels[k]; p.commit([...p.items, { t: 'text', x: 60, y, text: t, color: '#1a1a1a', size: 16 }]); return noteflow.links.itemAnchor(p, p.items.length - 1, p.cur); }""", [key, text, y, page])
    def link(x, y): return P("([x, y]) => !!noteflow.links.store.add(x, y)", [x, y])
    def delete(key, text):                                         # select it and delete it like the Delete key does
        return P("([k, t]) => { const p = noteflow.panels[k]; p.setTool('select'); p.selected = p.items.findIndex((d) => d.text === t); return p.deleteSelected(); }", [key, text])
    def has(key, text): return P("([k, t]) => noteflow.panels[k].pages.some((pg) => pg.items.some((d) => d.text === t))", [key, text])
    def n(): return P("() => noteflow.links.store.size")
    def clean(): return P("() => noteflow.links.store.all().every((l) => noteflow.links.resolve(l.a).state === 'ok' && noteflow.links.resolve(l.b).state === 'ok')")
    def no_leftovers(): return P("() => noteflow.links.store.size === 0 && noteflow.links.store.index.size === 0")
    def reset(): P("() => { noteflow.links.store.clear(); }")
    def pdfa(key, page): return P("([k, p]) => noteflow.links.pdfAnchor(noteflow.panels[k], p)", [key, page])
    SAVE_REOPEN = """async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const buf = await blob.arrayBuffer();
      const z = await JSZip.loadAsync(buf); const lf = z.file('links.json'), raw = lf ? JSON.parse(await lf.async('string')) : { links: [] }; const ws = await WS.readWorkspace(buf);
      const before = noteflow.links.store.size; await noteflow.restore(ws);
      return { saved: raw.links.length, savedItems: raw.links.flatMap((l) => [l.a, l.b]).filter((x) => x.k === 'item').map((x) => x.pv), before, after: noteflow.links.store.size,
               ok: noteflow.links.store.all().every((l) => noteflow.links.resolve(l.a).state === 'ok' && noteflow.links.resolve(l.b).state === 'ok') }; }"""

    layout(["pdf", "nb", "board"])
    P(PDF_JS, ["pdf", "A"]); until("() => noteflow.panels.pdf.pages.length === 6 && noteflow.panels.pdf.pdf.hash")
    P("() => noteflow.panels.nb.zoomBy(0.5)")

    # ================================================================= 1. the real UI: type a note, link it to a PDF page, press Delete
    P("() => noteflow.panels.nb.setTool('text')"); a.click_page(100, 150); kb.type("Delete me with the key"); kb.press("Escape"); a.page.wait_for_timeout(200)
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = p.items.findIndex((d) => d.text === 'Delete me with the key'); p.render(); noteflow.setActive(p); }")
    a.page.locator('.topbar button[title^="Link two things"]').click(); a.page.wait_for_timeout(150)
    P("async () => { await noteflow.panels.pdf.goto(3); }"); a.page.wait_for_timeout(600)
    x, y = P("([k, i, x, y]) => { const p = noteflow.panels[k], r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }", ["pdf", 3, 300, 500])
    a.page.mouse.click(x, y); a.page.wait_for_timeout(300)
    C.check("(setup) a note typed by hand is linked to PDF page 4 through the Link button", n() == 1 and clean())
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = p.items.findIndex((d) => d.text === 'Delete me with the key'); noteflow.setActive(p); p.render(); }")
    kb.press("Delete"); a.page.wait_for_timeout(300)
    C.check("pressing Delete on the linked note deletes the note AND its link (nothing left in the list or in the index)", not has("nb", "Delete me with the key") and no_leftovers())
    C.check("…the PDF page no longer shows a link mark", P("() => { const p = noteflow.panels.pdf; p.render(); return p.linkHits.length; }") == 0)

    # ================================================================= 2. nothing is deleted by mistake
    A = mk("nb", "Stays linked: edit, move, style", 140); B = mk("board", "Board idea that stays", 100); link(A, B)
    P("() => { const p = noteflow.panels.nb; const i = p.items.findIndex((d) => d.text.startsWith('Stays')); const it = p.items.slice(); it[i] = { ...it[i], text: 'Stays linked: edited text now', x: 90, y: 200, color: '#d32f2f', size: 20 }; p.commit(it); }")
    P("() => { const p = noteflow.panels.nb; const i = p.items.findIndex((d) => d.text.startsWith('Stays')); p.setTool('select'); p.selected = i; p.startEdit(i); }"); a.page.wait_for_timeout(150)
    kb.type(" and typed"); kb.press("Escape"); a.page.wait_for_timeout(300)
    C.check("editing, moving, recolouring and typing into a linked note keep its link (the id travels with the item)", n() == 1 and clean() and has("nb", "Stays linked: edited text now and typed"), P("() => noteflow.panels.nb.items.map((d) => d.text)"))
    LONG = "\n".join("Line %d of a very long linked text that has to continue on the next pages of the notebook" % i for i in range(120))
    P("""([t]) => { const p = noteflow.panels.nb; const i = p.items.findIndex((d) => d.text.startsWith('Stays')); const it = p.items.slice(); it[i] = { ...it[i], text: t, y: 60 }; p.commit(it, { flowIdx: i }); }""", [LONG])
    a.page.wait_for_timeout(300)
    C.check("a linked text that is made so long that it continues on the next pages keeps its link", P("() => noteflow.panels.nb.pages.length") > 1 and n() == 1 and clean(), P("() => noteflow.panels.nb.pages.length"))
    P("() => { noteflow.panels.nb.undo(); noteflow.panels.nb.undo(); noteflow.panels.nb.undo(); noteflow.panels.nb.undo(); noteflow.panels.nb.redo(); }"); a.page.wait_for_timeout(200)
    C.check("undo / redo of edits does not lose it either", n() == 1 and clean())
    reset(); P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }], null); await noteflow.panels.board.setBoard({ paper: 'white', grid: false, items: [] }, null); }")

    # ================================================================= 3. every surface, either end
    layout(["nb", "nb2", "board2"])
    P(PDF_JS, ["pdf2", "B"]); until("() => noteflow.panels.pdf2.pages.length === 6 && noteflow.panels.pdf2.pdf.hash")
    P("async () => { await noteflow.panels.nb2.setNotebook([{ paper: 'lined', items: [] }], null); await noteflow.panels.board2.setBoard({ paper: 'white', grid: false, items: [] }, null); }")
    SURF = ["nb", "nb2", "board", "board2", "pdf", "pdf2"]
    P("() => { for (const k of ['nb2', 'board2']) { const p = noteflow.panels[k]; p.root.hidden = false; } }")
    pairs = [(s, t) for i, s in enumerate(SURF) for t in SURF[i + 1:]]
    bad = []
    for k, (s, t) in enumerate(pairs):
        for end in (0, 1):
            reset()
            ts, tt = "S-%s-%d-%d" % (s, k, end), "T-%s-%d-%d" % (t, k, end)
            X = mk(s, ts, 100 + 40 * (k % 8)); Y = mk(t, tt, 100 + 40 * (k % 8))
            link(X, Y)
            gone = (ts, s, tt, t) if end == 0 else (tt, t, ts, s)
            delete(gone[1], gone[0])
            if not (no_leftovers() and has(gone[3], gone[2])): bad.append((s, t, end, n(), has(gone[3], gone[2])))
    C.check("for every pair of surfaces (notebook, 2nd notebook, 2 boards, annotations of 2 PDFs) deleting either end deletes the link and only the link", not bad, bad[:4])
    reset()
    hub = mk("nb", "Hub note", 100); spokes = [mk(s, "Spoke " + s, 160) for s in ("nb2", "board", "board2", "pdf")]
    for sp in spokes: link(hub, sp)
    C.check("(setup) one note linked to four others", n() == 4)
    delete("board", "Spoke board"); C.check("deleting one of the four removes exactly its link", n() == 3 and clean())
    delete("nb", "Hub note"); C.check("deleting the note that all the others are linked to removes all its links", no_leftovers() and has("pdf", "Spoke pdf"))

    # ================================================================= 4. mind map: a deleted branch takes the links of all its nodes
    reset(); layout(["board", "nb"])
    P("""() => { const b = noteflow.panels.board; const n1 = { t: 'node', id: 'nroot', x1: 100, y1: 100, x2: 220, y2: 148, text: 'Root idea', color: '#1a1a1a', size: 16 }, n2 = { t: 'node', id: 'nkid', x1: 300, y1: 100, x2: 420, y2: 148, text: 'Child idea', color: '#1a1a1a', size: 16 },
      c = { t: 'conn', from: 'nroot', to: 'nkid' }; b.commit([n1, n2, c]); }""")
    kid = P("() => { const b = noteflow.panels.board; return noteflow.links.itemAnchor(b, b.items.findIndex((d) => d.id === 'nkid'), 0); }")
    note = mk("nb", "Note about the child", 100); link(note, kid)
    P("() => { const b = noteflow.panels.board; b.setTool('select'); b.selected = b.items.findIndex((d) => d.id === 'nroot'); b.deleteBranch(); }")
    C.check("deleting a mind-map branch deletes the links of the nodes below it", no_leftovers() and has("nb", "Note about the child"))
    P("() => noteflow.panels.board.undo()"); a.page.wait_for_timeout(200)
    C.check("…and Undo brings the branch and the link back together", n() == 1 and clean())

    # ================================================================= 5. Undo / Redo of a deletion
    reset(); layout(["pdf", "nb"])
    P("async () => { await noteflow.panels.pdf.goto(2); }")
    N1 = mk("nb", "Undo me", 100); link(N1, pdfa("pdf", 2)); id0 = P("() => noteflow.links.store.all()[0].id")
    delete("nb", "Undo me")
    C.check("deleting the note removes the link", no_leftovers())
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(250)
    C.check("Undo restores the note and its link (the same link)", n() == 1 and clean() and P("() => noteflow.links.store.all()[0].id") == id0)
    P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(250)
    C.check("Redo (the note is deleted again) removes the link again", no_leftovers())
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(250)
    C.check("…and Undo again restores it", n() == 1 and clean())
    reset()

    # ================================================================= 6. deleting a whole page
    P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }, { paper: 'lined', items: [] }], null); await noteflow.panels.nb.goto(1); }"); a.page.wait_for_timeout(300)
    P1 = mk("nb", "Note on page two", 100)
    P("async () => { await noteflow.panels.nb.goto(0); }"); a.page.wait_for_timeout(200)
    P0 = mk("nb", "Note on page one", 100); link(P0, P1); link(P1, pdfa("pdf", 1))
    P("async () => { await noteflow.panels.nb.goto(1); }"); a.page.wait_for_timeout(300)
    P("() => { noteflow.panels.nb.deletePage(); }"); a.page.wait_for_timeout(300)
    a.page.get_by_role("button", name="Delete", exact=True).click(); a.page.wait_for_timeout(400)
    C.check("deleting a page deletes the links of everything on it (to a note and to a PDF page); the note on the other page stays", P("() => noteflow.panels.nb.pages.length") == 1 and no_leftovers() and has("nb", "Note on page one"))
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(300)
    C.check("Undo of the page deletion brings the page and both links back", P("() => noteflow.panels.nb.pages.length") == 2 and n() == 2 and clean())
    reset()

    # ================================================================= 7. the PDF: closed, replaced, still open elsewhere
    P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }], null); }")
    Q1 = mk("nb", "Note A for the PDF", 100); Q2 = mk("nb", "Note B for the notes", 160); Q3 = mk("board", "Board note", 100)
    link(Q1, pdfa("pdf", 4)); link(Q2, Q3)
    P("() => noteflow.panels.pdf.clearPdf()"); a.page.wait_for_timeout(300)
    C.check("closing the PDF deletes the links to its pages; links between notes are not touched", n() == 1 and clean() and has("nb", "Note A for the PDF"))
    P(PDF_JS, ["pdf", "A"]); until("() => noteflow.panels.pdf.pages.length === 6 && noteflow.panels.pdf.pdf.hash"); a.page.wait_for_timeout(300)
    C.check("opening the same PDF again does not bring the old link back (it was deleted)", n() == 1)
    link(Q1, pdfa("pdf", 4)); link(Q2, pdfa("pdf", 5))
    P(PDF_JS, ["pdf", "DIFFERENT"]); until("() => noteflow.panels.pdf.pdf && noteflow.panels.pdf.pdf.hash"); a.page.wait_for_timeout(500)
    C.check("replacing the PDF with a different file deletes the links to the old one", n() == 1 and clean(), P("() => noteflow.links.store.all().map((l) => [l.a.k, l.b.k])"))
    P("""async () => { const b = noteflow.panels.pdf.pdf.source; await noteflow.panels.pdf2.openPdfBytes(b, 'same.pdf'); }"""); until("() => noteflow.panels.pdf2.pdf && noteflow.panels.pdf2.pdf.hash")
    link(Q1, pdfa("pdf", 2)); P("() => noteflow.panels.pdf.clearPdf()"); a.page.wait_for_timeout(300)
    C.check("a PDF that is still open in the other PDF panel keeps its links", n() == 2 and clean())
    P("() => noteflow.panels.pdf2.clearPdf()"); a.page.wait_for_timeout(300)
    C.check("…until that one is closed too", n() == 1 and clean())
    reset()

    # ================================================================= 8. saving and reopening
    layout(["pdf", "nb", "board"])
    P(PDF_JS, ["pdf", "A"]); until("() => noteflow.panels.pdf.pages.length === 6 && noteflow.panels.pdf.pdf.hash")
    P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }], null); await noteflow.panels.board.setBoard({ paper: 'white', grid: false, items: [] }, null); await noteflow.panels.pdf.goto(1); }"); a.page.wait_for_timeout(300)
    K1 = mk("nb", "Keep one", 100); K2 = mk("nb", "Keep two", 160); K3 = mk("board", "Keep three", 100); K4 = mk("pdf", "PDF annotation", 100)
    link(K1, pdfa("pdf", 1)); link(K2, K3); link(K3, K4)
    r = P(SAVE_REOPEN); a.page.wait_for_timeout(500)
    C.check("a workspace with working links saves and reopens with all of them (nothing deleted by mistake while it loads)", r["saved"] == 3 and r["after"] == 3 and r["ok"], r)
    delete("board", "Keep three")
    r = P(SAVE_REOPEN); a.page.wait_for_timeout(500)
    C.check("delete a linked note, save, reopen: the file holds no link to it, and none comes back", r["saved"] == 1 and r["after"] == 1 and r["ok"] and "Keep three" not in r["savedItems"], r)
    delete("nb", "Keep one"); delete("nb", "Keep two")
    r = P(SAVE_REOPEN); a.page.wait_for_timeout(500)
    C.check("…delete the rest: a saved workspace without links", r["saved"] == 0 and r["after"] == 0, r)
    P("() => noteflow.panels.nb.undo(); ")
    # the session backup (what the browser keeps for a reload) is clean too
    reset(); K1 = mk("nb", "Backup one", 100); K2 = mk("nb", "Backup two", 160); link(K1, pdfa("pdf", 1)); link(K1, K2); delete("nb", "Backup two")
    P("async () => { await noteflow.autosave(true); }")
    rec = P("async () => { const rec = await noteflow.idb.get('session'); return rec.links.links.map((l) => [l.a.pv, l.b.pv]); }")
    C.check("the session backup holds only the link whose both ends exist", len(rec) == 1 and "Backup two" not in str(rec), rec)
    P("async () => { await noteflow.restoreAutosave(); }"); a.page.wait_for_timeout(600)
    C.check("…and restoring that backup keeps it", n() == 1 and clean())

    # ================================================================= 9. a file that already holds orphaned links (saved by an older version)
    reset(); K1 = mk("nb", "Alive note", 100); good = link(K1, pdfa("pdf", 1))
    r = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer());
      const J = noteflow.links.store.toJSON(), real = J.links[0], ghost = { k: 'item', id: 'ighost', slot: 'nb', pv: 'ghost' }, ghost2 = { k: 'item', id: 'ighost2', slot: 'board', pv: 'ghost2' }, gpdf = { k: 'pdf', doc: 'f'.repeat(64), name: 'gone.pdf', page: 0, pv: 'p' };
      ws.links = { ...J, links: [real, { id: 'lo1', a: ghost, b: real.b, t: 1 }, { id: 'lo2', a: real.a, b: gpdf, t: 1 }, { id: 'lo3', a: ghost, b: ghost2, t: 1 }] };
      await noteflow.restore(ws); return { n: noteflow.links.store.size, ids: noteflow.links.store.all().map((l) => l.id), ok: noteflow.links.store.all().every((l) => noteflow.links.resolve(l.a).state === 'ok' && noteflow.links.resolve(l.b).state === 'ok'), idx: noteflow.links.store.index.size }; }""")
    C.check("opening a file with 3 orphaned links (deleted note, missing PDF, both ends gone) drops them and keeps the good one", r["n"] == 1 and r["ok"] and "lo1" not in r["ids"], r)

    # ================================================================= 10. Smart linking and the cleanup together
    reset()
    P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }], null); }")
    TXT = "The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK"
    P("""async ([t]) => { const pdfdoc = await import('./js/pdftext.js'); const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 3; i++) { const p = doc.addPage([595, 842]); p.drawText(i === 2 ? t + '.' : 'Filler paragraph number ' + i + ' about vegetable gardening, compost and watering schedules for beginners.', { x: 60, y: 700, size: 13, font: f, maxWidth: 470, lineHeight: 17 }); }
      await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'tcp.pdf'); await noteflow.panels.pdf.goto(1);
      const nb = noteflow.panels.nb; nb.commit([{ t: 'text', x: 60, y: 120, text: t, color: '#1a1a1a', size: 16 }]); }""", [TXT])
    P("() => { noteflow.smart.snoozed.clear(); noteflow.smart.scannedSig = null; noteflow.smart.seenSig = null; noteflow.smart.setMode('auto', { silent: true }); }")
    until("() => noteflow.links.store.countSrc('auto') >= 1")
    C.check("(setup) auto mode linked the note on its own", n() == 1 and P("() => noteflow.smart.suggestions.length") == 0)
    P("() => noteflow.smart.setMode('off', { silent: true })")
    delete("nb", TXT)
    C.check("deleting a note that Smart linking linked removes the automatic link as well", no_leftovers())
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
