"""Linked notes (notebook <-> PDF) and global search, driven through the real UI.
Links: made in pick mode (item / page / region / text passage, either order), kept by stable identity (item id, PDF content hash), followed from either end,
survive layout changes, saving and reopening, and say so when a PDF is replaced / missing or a note was deleted.
Search: notebooks, text boxes, notes, mind maps, PDF text; partial / whole words, Persian + English, live updates, highlight on arrival."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

PDF_JS = """async ([tag]) => {
  const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 25; i++) { const p = doc.addPage([595, 842]); p.drawText('Page ' + i + ' network security basics ' + tag, { x: 60, y: 760, size: 18, font: f });
    p.drawText(i === 20 ? 'The TCP handshake has three steps' : 'Filler text number ' + i, { x: 60, y: 700, size: 14, font: f }); }
  const bytes = await doc.save(); return await noteflow.panels.pdf.openPdfBytes(bytes, 'net.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); kb = a.page.keyboard
    P = lambda js, arg=None: a.ev(js, arg)
    a.ev("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(400)
    P(PDF_JS, ["A"]); a.page.wait_for_timeout(700)
    P("() => noteflow.panels.nb.zoomBy(0.5)")
    def link_btn(key):                                                                   # the Link button is in the top bar: it starts from the ACTIVE panel's selection
        P("(k) => noteflow.setActive(noteflow.panels[k])", key)
        return a.page.locator('.topbar button[title^="Link two things"]')
    def screen(key, i, x, y):
        return P("([k, i, x, y]) => { const p = noteflow.panels[k], r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }", [key, i, x, y])
    def links(): return P("() => noteflow.links.store.toJSON().links")
    def badge(key):                                  # first pressable link mark of a panel (screen position)
        h = P("(k) => { const p = noteflow.panels[k]; p.render(); return null; }", "nb")
        a.page.wait_for_timeout(120)
        return P("(k) => { const p = noteflow.panels[k], h = p.linkHits[0]; if (!h) return null; const r = p.stage.getBoundingClientRect(); return [r.left + h.sx, r.top + h.sy, p.linkHits.length]; }", key)
    def write_note(y, text):
        P("() => noteflow.panels.nb.setTool('text')"); a.click_page(100, y); kb.type(text); kb.press("Escape"); a.page.wait_for_timeout(200)
    def select_note(text):
        P("([t]) => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = p.items.findIndex((d) => d.text === t); p.render(); }", [text])

    def S(q):                                         # type a query and wait until THAT search has finished (no fixed sleeps: slow machines)
        before = P("() => noteflow.search.runs"); a.page.fill(".sinput", q)
        a.page.wait_for_function("([b, q]) => noteflow.search.runs > b && noteflow.search.last && noteflow.search.last.q === q", arg=[before, q], timeout=60000)
    def until(js, arg=None, timeout=30000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    C.check("a PDF with 25 pages is open and has an identity (SHA-256)", P("() => noteflow.panels.pdf.pages.length") == 25 and P("() => noteflow.panels.pdf.pdf.hash.length") == 64)

    # ================================================================= LINKED NOTES
    write_note(150, "TCP notes"); select_note("TCP notes")
    link_btn("nb").click(); a.page.wait_for_timeout(150)
    pk = P("() => noteflow.links.pick")
    C.check("Link with a note selected: it is the first end at once, and a guide card shows the steps", pk and pk["a"]["k"] == "item" and pk["a"]["pv"] == "TCP notes" and P("() => !document.querySelector('.linkguide:not(.snipcard)').hidden"), pk)
    g = a.page.locator(".linkguide:not(.snipcard)").inner_text()
    C.check("the guide says which step it is, shows the first end that was chosen, and tells what to do next", "Step 2 of 2" in g and "TCP notes" in g and "PDF page" in g, g)
    P("async () => { await noteflow.panels.pdf.goto(19); }"); a.page.wait_for_timeout(700)
    x, y = screen("pdf", 19, 300, 500); a.page.mouse.click(x, y); a.page.wait_for_timeout(300)
    L = links()
    C.check("tapping the PDF page makes a link: note (by id) <-> PDF page 20 (by content hash)", len(L) == 1 and L[0]["a"]["k"] == "item" and L[0]["b"]["k"] == "pdf" and L[0]["b"]["page"] == 19
            and L[0]["b"]["doc"] == P("() => noteflow.panels.pdf.pdf.hash") and not P("() => noteflow.links.picking"), L)
    item = [d for d in a.items() if d.get("text") == "TCP notes"][0]
    C.check("the note got a stable id, and it is the one in the link", item.get("id") == L[0]["a"]["id"], item.get("id"))
    C.check("both panels show the link mark", badge("nb") is not None and badge("pdf") is not None)

    # ---- editing the note keeps the link (the id travels with the item)
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); p.startEdit(p.items.findIndex((d) => d.text === 'TCP notes')); }"); a.page.wait_for_timeout(150)
    kb.press("End"); kb.type(" more"); kb.press("Escape"); a.page.wait_for_timeout(250)
    it2 = [d for d in a.items() if d.get("text") == "TCP notes more"]
    C.check("after editing the text the item has the same id and the link still resolves", it2 and it2[0].get("id") == L[0]["a"]["id"] and P("() => noteflow.links.resolve(noteflow.links.store.all()[0].a).state") == "ok")
    # ---- undo does not lose the id
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(100); P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(100)
    C.check("undo / redo keep the link working", P("() => noteflow.links.resolve(noteflow.links.store.all()[0].a).state") == "ok")

    # ---- go from the note to the PDF
    P("async () => { await noteflow.panels.pdf.goto(2); }"); a.page.wait_for_timeout(500)
    bx, by, n = badge("nb"); a.page.mouse.click(bx, by); until("() => noteflow.panels.pdf.vp === 19 && noteflow.panels.pdf.marks.some((m) => m.kind === 'flash')")
    st = P("() => { const p = noteflow.panels.pdf; return { vp: p.vp, cur: p.cur, marks: p.marks.map((m) => [m.kind, m.page]) }; }")
    C.check("pressing the note's link mark opens PDF page 20 and flashes it", st["vp"] == 19 and ["flash", 19] in st["marks"], st)
    # ---- and from the PDF back to the note
    P("async () => { await noteflow.panels.nb.goto(0); noteflow.panels.nb.clearMarks(); }")
    P("() => noteflow.panels.pdf.setTool('select')")                                     # (marks answer to Select / Hand, or Ctrl+click: a drawing tool never gets hijacked)
    bx, by, n = badge("pdf"); a.page.mouse.click(bx, by); until("() => noteflow.panels.nb.marks.some((m) => m.kind === 'flash')")
    mk = P("() => noteflow.panels.nb.marks.map((m) => [m.kind, m.page, m.rects.length])")
    C.check("pressing the mark on the PDF page goes to the note and highlights it", ["flash", 0, 1] in mk, mk)

    # ---- several notes on one page; a region; a text passage
    write_note(250, "Handshake summary"); select_note("Handshake summary")
    link_btn("nb").click(); a.page.wait_for_timeout(100)
    P("async () => { await noteflow.panels.pdf.goto(19); }"); a.page.wait_for_timeout(600)
    x, y = screen("pdf", 19, 62, 140); x2, y2 = screen("pdf", 19, 260, 140)             # drag across the words "The TCP handshake" (starts ON a word)
    a.page.mouse.move(x, y); a.page.mouse.down(); a.page.mouse.move((x + x2) / 2, y, steps=4); a.page.mouse.move(x2, y2, steps=4)
    prev = P("() => noteflow.panels.pdf.pickPrev && [noteflow.panels.pdf.pickPrev.kind, noteflow.panels.pdf.pickPrev.rects.length]")
    a.page.mouse.up(); a.page.wait_for_timeout(300)
    L = links(); q = [l for l in L if l["b"].get("quote")]
    C.check("dragging across text while picking selects a passage (preview while dragging), stored with its text and boxes",
            prev and prev[0] == "text" and len(q) == 1 and "TCP" in q[0]["b"]["quote"]["text"] and len(q[0]["b"]["quote"]["rects"]) >= 1, (prev, q))
    C.check("two notes are now linked to page 20 (one to the page, one to a passage on it)", P("() => noteflow.links.store.forPdfPage(noteflow.panels.pdf.pdf.hash, 19).length") == 2)
    write_note(350, "Diagram idea"); select_note("Diagram idea")
    link_btn("nb").click(); a.page.wait_for_timeout(100)
    P("async () => { await noteflow.panels.pdf.goto(2); }"); a.page.wait_for_timeout(600)
    x, y = screen("pdf", 2, 300, 450); x2, y2 = screen("pdf", 2, 450, 560)                  # empty area: a REGION
    a.page.mouse.move(x, y); a.page.mouse.down(); a.page.mouse.move(x2, y2, steps=6); a.page.mouse.up(); a.page.wait_for_timeout(300)
    reg = [l for l in links() if l["b"].get("rect")]
    C.check("dragging over empty page area while picking links a region of the page", len(reg) == 1 and reg[0]["b"]["page"] == 2 and 140 < reg[0]["b"]["rect"][2] - reg[0]["b"]["rect"][0] < 160, reg)
    # ---- a PDF item (a highlight made on the PDF) can be an end, too; pick from the PDF side first
    P("() => { const p = noteflow.panels.pdf; p.setTool('select'); p.commit([...p.items, { t: 'rect', x1: 100, y1: 100, x2: 200, y2: 160, color: '#d32f2f', w: 2 }]); p.selected = 0; p.render(); }")
    link_btn("pdf").click(); a.page.wait_for_timeout(120)
    P("() => noteflow.panels.nb.setTool('select')"); select_note("Diagram idea")
    nx, ny = screen("nb", 0, 120, P("() => noteflow.panels.nb.items.find((d) => d.text === 'Diagram idea').y + 8")); a.page.mouse.click(nx, ny); a.page.wait_for_timeout(300)
    both = [l for l in links() if l["a"]["k"] == "item" and l["b"]["k"] == "item"]
    C.check("links also work started from the PDF side and between an annotation on the PDF and a note (item <-> item)", len(both) == 1 and {both[0]["a"]["slot"], both[0]["b"]["slot"]} == {"pdf", "nb"}, both)
    dup = P("() => { const s = noteflow.links.store, l = s.all()[0]; const r = s.add(l.a, l.b); return [r.created, s.size]; }")
    C.check("making the same link again does not duplicate it", dup[0] is False and dup[1] == len(links()), dup)
    P("() => noteflow.panels.pdf.selected = null")

    # ---- the list when several links meet in one place
    P("async () => { await noteflow.panels.pdf.goto(19); }"); a.page.wait_for_timeout(600)
    P("() => { const p = noteflow.panels.pdf; p.setTool('select'); p.render(); }"); a.page.wait_for_timeout(150)
    hit = P("() => { const p = noteflow.panels.pdf, h = p.linkHits.map((q) => q.group.links.length); return h; }")
    C.check("on page 20 the page mark counts the page's links and the passage has its own mark", sorted(hit) in ([1, 1], [2]) and len(hit) >= 1, hit)

    # ================================================================= layouts, saving
    P("async () => { await noteflow.setLayout(['nb'], false); }"); a.page.wait_for_timeout(500)
    P("async () => { await noteflow.panels.nb.goto(0); }"); a.page.wait_for_timeout(300)
    h0 = badge("nb"); a.page.mouse.click(h0[0], h0[1]); until("() => noteflow.order.includes('pdf') && noteflow.panels.pdf.vp === 19")
    C.check("with a layout that has no PDF, following a link brings the PDF panel back and opens the page", "pdf" in P("() => noteflow.order") and P("() => noteflow.panels.pdf.vp") == 19, P("() => noteflow.order"))
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }")
    ws = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const buf = await blob.arrayBuffer();
      const JSZ = await JSZip.loadAsync(buf); const names = Object.keys(JSZ.files); const ws = await WS.readWorkspace(buf); const n = noteflow.links.store.size;
      await noteflow.restore(ws); return { names, n, after: noteflow.links.store.size, states: noteflow.links.store.all().map((l) => [noteflow.links.resolve(l.a).state, noteflow.links.resolve(l.b).state]) }; }""")
    C.check("saving the workspace writes links.json; reopening restores every link and all of them resolve", "links.json" in ws["names"] and ws["after"] == ws["n"] == 4 and all(s == ["ok", "ok"] for s in ws["states"]), ws)
    P("async () => { await noteflow.setLayout(['nb','pdf'], false); }"); a.page.wait_for_timeout(300)
    C.check("after swapping the panels the links are unchanged and still resolve", P("() => noteflow.links.store.all().every((l) => noteflow.links.resolve(l.a).state === 'ok' && noteflow.links.resolve(l.b).state === 'ok')"))
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }")
    old = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace({ ...noteflow.collect(), links: null }); const ws = await WS.readWorkspace(await blob.arrayBuffer());
      await noteflow.restore(ws); return noteflow.links.store.size; }""")
    C.check("a workspace without links (older file) opens fine and has none", old == 0)
    # restore the links for the next checks (a fresh workspace with the same PDF)
    P(PDF_JS, ["A"]); a.page.wait_for_timeout(500)

    # ================================================================= PDF replaced / missing, note deleted
    P("""async () => { noteflow.links.store.load(null); await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }], null); }""")
    a.ev("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(200)
    write_note(150, "Persistent note"); select_note("Persistent note"); link_btn("nb").click(); a.page.wait_for_timeout(100)
    P("async () => { await noteflow.panels.pdf.goto(4); }"); a.page.wait_for_timeout(500)
    x, y = screen("pdf", 4, 300, 500); a.page.mouse.click(x, y); a.page.wait_for_timeout(300)
    lk = links()[0]
    P(PDF_JS, ["B"]); a.page.wait_for_timeout(700)                                                # same name, different content = the linked PDF is gone
    C.check("replacing the PDF by a different file deletes the links to the old one (no orphan is left, in the list or in the index)", P("() => noteflow.links.store.size") == 0 and P("() => noteflow.links.store.index.size") == 0)
    # A stale link can no longer be made through the UI, but one in the store (a hand-edited file ...) is still explained, never followed blindly:
    P("(l) => { noteflow.links.store.add(l.a, l.b); }", lk)
    r = P("() => noteflow.links.resolve(noteflow.links.store.all()[0].b).state")
    C.check("a link to a PDF that was replaced by a different file is detected (not silently followed)", r == "pdf-replaced", r)
    a.ev("() => { noteflow.links.go(noteflow.links.store.all()[0].b, { link: noteflow.links.store.all()[0] }); }"); a.page.wait_for_timeout(300)
    dlg = a.page.locator(".dialog").inner_text()
    C.check("following it explains the problem and offers to open the page anyway or remove the link", "changed" in dlg.lower() and "anyway" in dlg.lower() and "Remove link" in dlg, dlg[:120])
    a.page.get_by_role("button", name="Cancel").click(); a.page.wait_for_timeout(150)
    P("() => noteflow.panels.pdf.clearPdf()"); a.page.wait_for_timeout(200)
    C.check("closing the PDF deletes the links to it", P("() => noteflow.links.store.size") == 0 and P("() => noteflow.links.store.index.size") == 0)
    P("(l) => { noteflow.links.store.add(l.a, l.b); }", lk)
    r = P("() => noteflow.links.resolve(noteflow.links.store.all()[0].b).state")
    C.check("a stale link to a PDF that is not open says so", r == "pdf-missing", r)
    a.ev("() => { noteflow.links.go(noteflow.links.store.all()[0].b, { link: noteflow.links.store.all()[0] }); }"); a.page.wait_for_timeout(300)
    C.check("…and can be removed from that message", "not open" in a.page.locator(".dialog").inner_text())
    a.page.get_by_role("button", name="Remove link").click(); a.page.wait_for_timeout(200)
    C.check("removing it leaves no link and no leftovers", P("() => noteflow.links.store.size") == 0 and P("() => noteflow.links.store.index.size") == 0)
    P(PDF_JS, ["A"]); a.page.wait_for_timeout(600)
    select_note("Persistent note"); link_btn("nb").click(); a.page.wait_for_timeout(100)
    P("async () => { await noteflow.panels.pdf.goto(1); }"); a.page.wait_for_timeout(500)
    x, y = screen("pdf", 1, 300, 500); a.page.mouse.click(x, y); a.page.wait_for_timeout(300)
    C.check("(setup) the note is linked to the PDF again", P("() => noteflow.links.store.size") == 1)
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = p.items.findIndex((d) => d.text === 'Persistent note'); p.deleteSelected(); }"); a.page.wait_for_timeout(200)
    C.check("deleting the note deletes its link: nothing is left to find and remove by hand", P("() => noteflow.links.store.size") == 0 and P("() => noteflow.links.store.index.size") == 0)
    P("async () => { await noteflow.panels.pdf.goto(1); }"); a.page.wait_for_timeout(500)
    a.ev("() => { noteflow.links.manage(); }"); a.page.wait_for_timeout(300)
    C.check("the list of links has nothing broken to show", "broken" not in a.page.locator(".dialog").inner_text().lower() and "Needs attention" not in a.page.locator(".dialog").inner_text())
    a.page.locator(".dialog").get_by_role("button", name="Close", exact=True).click(); a.page.wait_for_timeout(150)
    # the manual 'Remove broken' button stays as a fallback for a stale link that came from outside (a hand-edited file)
    P("() => { const L = noteflow.links; L.store.add({ k: 'item', id: 'inope', slot: 'nb', pv: 'gone' }, L.pdfAnchor(noteflow.panels.pdf, 1)); }")
    a.ev("() => { noteflow.links.manage(); }"); a.page.wait_for_timeout(300)
    C.check("a stale link from outside is shown as broken and can be removed in one click", "Remove 1 broken" in a.page.locator(".dialog").inner_text())
    a.page.get_by_role("button", name="Remove 1 broken").click(); a.page.wait_for_timeout(250)
    C.check("…which removes it", P("() => noteflow.links.store.size") == 0)

    # ================================================================= GLOBAL SEARCH
    P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'lined', items: [] }, { paper: 'lined', items: [] }], null); }")
    a.ev("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(200)
    write_note(150, "my network notes"); write_note(250, "شبکه‌های کامپیوتری و امنیت"); write_note(330, "unrelated text")
    P("""() => { const p = noteflow.panels.nb; p.pages[1].items = [{ t: 'note', x: 40, y: 60, w: 190, h: 100, text: 'Second page NETWORK sticky', color: '#fff59d', size: 14 }]; p.render(); }""")
    a.page.keyboard.press("Control+Shift+F"); a.page.wait_for_timeout(300)
    C.check("Ctrl+Shift+F opens the search panel with the cursor in it", a.page.locator(".searchpanel").is_visible() and P("() => document.activeElement.className") == "sinput")
    until("() => noteflow.panels.pdf.pdf.text.complete", timeout=90000); S("network")
    res = P("() => noteflow.search.results.map((r) => [r.doc, r.page, r.kind])")
    pdf_pages = sorted({r[1] for r in res if r[0] == "pdf" and r[2] == "pdf"})
    C.check("'network' is found on every PDF page, in the text box, and in the note on notebook page 2", pdf_pages == list(range(25)) and ["nb", 0, "text"] in res and ["nb", 1, "note"] in res, (len(res), pdf_pages[:3]))
    C.check("each result says where it is: document, page, kind, and a preview with the match", all(r["snippet"]["match"].lower() == "network" for r in P("() => noteflow.search.results")) and "p. 1" in a.page.locator(".sitem").first.inner_text())
    st = a.page.locator(".sstatus").inner_text(); C.check("the status line counts the results", "result" in st, st)
    cached = P("async () => { const v = await noteflow.idb.get('ptxt:' + noteflow.panels.pdf.pdf.hash); return v ? [v.pages.length, v.pages[19].includes('TCP handshake')] : null; }")
    C.check("the PDF text is remembered on this device (read once, instant next time)", cached == [25, True], cached)
    # partial vs whole
    S("networ"); n_part = P("() => noteflow.search.results.length")
    b0 = P("() => noteflow.search.runs"); a.page.locator(".sopts input[type=checkbox]").check(); until("(b) => noteflow.search.runs > b", b0); n_whole = P("() => noteflow.search.results.length")
    C.check("partial words are found by default; 'Whole words' needs the whole word", n_part > 20 and n_whole == 0, (n_part, n_whole))
    S("network"); b0 = P("() => noteflow.search.runs"); a.page.locator(".sopts input[type=checkbox]").uncheck(); until("(b) => noteflow.search.runs > b", b0)
    # Persian
    S("شبکههای")
    fa = P("() => noteflow.search.results.map((r) => [r.doc, r.kind])")
    C.check("Persian: found although typed without the ZWNJ", fa == [["nb", "text"]], fa)
    S("کامپيوتري")                           # Arabic yeh / Arabic letter forms
    C.check("Persian: Arabic forms of letters (ي) find the Persian text", len(P("() => noteflow.search.results")) == 1)
    S("tcp")
    C.check("case-insensitive: 'tcp' finds 'TCP' on PDF page 20", [r for r in P("() => noteflow.search.results") if r["page"] == 19 and r["kind"] == "pdf"] != [])
    # go to a PDF result
    P("async () => { await noteflow.panels.pdf.goto(0); }"); a.page.wait_for_timeout(300)
    a.page.locator(".sitem", has_text="handshake").first.click() if a.page.locator(".sitem", has_text="handshake").count() else a.page.locator(".sitem").first.click()
    until("() => noteflow.panels.pdf.vp === 19 && noteflow.panels.pdf.marks.some((m) => m.kind === 'search')")
    pm = P("() => { const p = noteflow.panels.pdf; return { vp: p.vp, marks: p.marks.map((m) => [m.kind, m.page, m.rects.length, m.rects[0].map(Math.round)]) }; }")
    C.check("clicking a PDF result opens that page and highlights the matching text", pm["vp"] == 19 and any(m[0] == "search" and m[1] == 19 and m[2] >= 1 for m in pm["marks"]), pm)
    r0 = [m for m in pm["marks"] if m[0] == "search"][0][3]
    C.check("…the highlight is on the right word ('TCP' after 'The ' on the line at y about 130-146, only that word wide)", 80 <= r0[0] <= 95 and 120 <= r0[1] <= 150 and 15 <= r0[2] - r0[0] <= 30, r0)
    until("() => !noteflow.panels.pdf.marks.some((m) => m.kind === 'flash')"); a.page.wait_for_timeout(250)      # (the short "you are here" flash is over and repainted; what stays is the highlight)
    img = a.page.screenshot(clip=a.ev("() => { const r = noteflow.panels.pdf.stage.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }"))
    from PIL import Image; import io, numpy as np
    arr = np.array(Image.open(io.BytesIO(img)).convert("RGB")).astype(int)
    amber = int(((abs(arr[:, :, 0] - 255) < 40) & (abs(arr[:, :, 1] - 225) < 45) & (arr[:, :, 2] < 170)).sum())
    C.check("…and it is really drawn on the page (amber highlight pixels)", amber > 200, amber)
    # notebook result
    S("unrelated"); P("async () => { await noteflow.panels.nb.goto(1); }"); a.page.wait_for_timeout(300)
    a.page.locator(".sitem").first.click(); until("() => noteflow.panels.nb.marks.some((m) => m.kind === 'search')")
    nm = P("() => ({ vp: noteflow.panels.nb.vp, marks: noteflow.panels.nb.marks.map((m) => [m.kind, m.page]) })")
    C.check("clicking a notebook result opens its page and highlights the text", nm["vp"] == 0 and ["search", 0] in nm["marks"], nm)
    # live update
    S("network"); before = P("() => noteflow.search.results.filter((r) => r.doc === 'nb').length")
    P("""() => { const p = noteflow.panels.nb; p.commit([...p.items, { t: 'text', x: 60, y: 400, text: 'one more network line', color: '#1a1a1a', size: 18 }]); }"""); until("(n) => noteflow.search.results.filter((r) => r.doc === 'nb').length === n", before + 1)
    after = P("() => noteflow.search.results.filter((r) => r.doc === 'nb').length")
    C.check("results follow the content: a new text box with the word appears without searching again", after == before + 1, (before, after))
    P("""() => { const p = noteflow.panels.nb; p.commit(p.items.filter((d) => !String(d.text).includes('one more'))); }"""); until("(n) => noteflow.search.results.filter((r) => r.doc === 'nb').length === n", before)
    C.check("…and a deleted one disappears; no duplicates", P("() => noteflow.search.results.filter((r) => r.doc === 'nb').length") == before and len({r["key"] for r in P("() => noteflow.search.results")}) == len(P("() => noteflow.search.results")))
    # mind map on the board
    P("""async () => { await noteflow.setLayout(['pdf','nb','board'], false); const b = noteflow.panels.board; b.commit([{ t: 'node', id: 'nodeA', kind: 'round', x1: 100, y1: 100, x2: 220, y2: 150, text: 'Network topology', color: '#1a1a1a', w: 2, size: 18 }]); }""")
    S("topology")
    bd = P("() => noteflow.search.results.map((r) => [r.doc, r.kind])")
    C.check("mind map node text is found", bd == [["board", "node"]], bd)
    a.page.locator(".sitem").first.click(); until("() => noteflow.panels.board.marks.some((m) => m.kind === 'search')")
    C.check("…and the board shows where (highlight on the node)", P("() => noteflow.panels.board.marks.some((m) => m.kind === 'search')"))
    S("network"); b0 = P("() => noteflow.search.runs"); a.page.locator(".sopts select").select_option("pdf"); until("(b) => noteflow.search.runs > b", b0)
    C.check("the scope selector limits where it looks (PDFs only)", {r["doc"] for r in P("() => noteflow.search.results")} == {"pdf"})
    b0 = P("() => noteflow.search.runs"); a.page.locator(".sopts select").select_option("all"); until("(b) => noteflow.search.runs > b", b0)
    # keyboard
    S("network"); a.page.focus(".sinput")
    kb.press("ArrowDown"); kb.press("ArrowDown"); until("() => noteflow.search.active === 1"); a.page.wait_for_timeout(700)
    C.check("arrow keys step through the results and open them while the cursor stays in the box", P("() => noteflow.search.active") == 1 and P("() => document.activeElement.className") == "sinput")
    kb.press("Escape"); a.page.wait_for_timeout(200)
    C.check("Escape closes the search and removes the highlights", not a.page.locator(".searchpanel").is_visible() and not P("() => Object.values(noteflow.panels).some((p) => p.marks.some((m) => m.kind === 'search'))"))

    # ---- speed on a big notebook
    a.page.keyboard.press("Control+Shift+F"); a.page.wait_for_timeout(300)
    t = P("""async () => { const pages = Array.from({ length: 400 }, (_, i) => ({ paper: 'lined', items: Array.from({ length: 25 }, (_, k) => ({ t: 'text', x: 40, y: 60 + k * 24, text: 'row ' + k + ' of page ' + i + (k === 7 && i % 50 === 0 ? ' network' : ''), color: '#1a1a1a', size: 12 })) }));
      noteflow.panels.nb.setNotebook(pages, null); const S = noteflow.search; S.input.value = 'network'; const t0 = performance.now(); await S.run(); const first = performance.now() - t0;
      const t1 = performance.now(); S.input.value = 'netwo'; await S.run(); const again = performance.now() - t1; return { first, again, n: S.results.filter((r) => r.doc === 'nb').length }; }""")
    C.check("10 000 text boxes in 400 pages: first search is quick, the next ones (cached index) are quicker", t["n"] == 8 and t["first"] < 1500 and t["again"] < t["first"] + 50, t)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
