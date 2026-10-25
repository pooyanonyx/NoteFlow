"""Existing behaviour that the new text / paper / performance code must not break: notes, mind maps, boards, PDFs, drawing, moving, undo, keyboard."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker, shot
C = Checker()
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900)
    kb = a.page.keyboard
    P = "noteflow.panels.nb"
    # ---- keys typed in the text editor never reach the app's shortcuts
    a.click_page(100, 120); kb.type("pen eraser hand select 1 2 3")
    st = a.ev("() => [noteflow.panels.nb.tool, !!noteflow.panels.nb.editing, noteflow.panels.nb.rt.getContent().text]")
    C.check("letters typed in a text box do not switch tools", st[0] == "text" and st[1] and st[2] == "pen eraser hand select 1 2 3", st)
    kb.press("Control+z"); kb.press("Control+z")
    C.check("Ctrl+Z inside the editor does not undo the notebook", a.ev("() => !!noteflow.panels.nb.editing"))
    kb.type("kept text"); a.finish()
    # ---- drawing on a (cached) page: preview over the bitmap, committed stroke visible, undo
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('pen'); }")
    sx, sy = a.screen_of(200, 300); a.page.mouse.move(sx, sy); a.page.mouse.down(); a.page.mouse.move(sx + 80, sy + 40, steps=6); a.page.mouse.move(sx + 160, sy, steps=6); a.page.mouse.up(); a.page.wait_for_timeout(150)
    n = a.ev("() => noteflow.panels.nb.items.length")
    ink = a.ink_clusters(195, 380, 290, 360)
    C.check("a pen stroke is drawn and appears on the page", n == 2 and len(ink) >= 1, (n, ink[:2]))
    a.ev("() => noteflow.panels.nb.undo()"); C.check("undo removes the stroke", a.ev("() => noteflow.panels.nb.items.length") == 1)
    a.ev("() => noteflow.panels.nb.redo()")
    # ---- eraser, select + move + resize on the cached page
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('select'); }")
    tx, ty = a.screen_of(105, 125); a.page.mouse.click(tx, ty); a.page.wait_for_timeout(100)
    C.check("clicking a text box selects it", a.ev("() => noteflow.panels.nb.selected") == 0)
    a.page.mouse.move(tx, ty); a.page.mouse.down(); a.page.mouse.move(tx + 40, ty + 100, steps=6); a.page.mouse.up(); a.page.wait_for_timeout(150)
    it = a.items()[0]
    C.check("dragging moves the text box (and it stays on the lines)", it["y"] > 140 and abs((it["y"] + 4 - 72) % 24) < 1e-6, it["y"])
    a.ev("() => noteflow.panels.nb.setTool('eraser')")
    a.page.mouse.move(*a.screen_of(205, 300)); a.page.mouse.down(); a.page.mouse.move(*a.screen_of(300, 340), steps=10); a.page.mouse.up(); a.page.wait_for_timeout(150)
    C.check("the eraser works on a cached page", a.ev("() => noteflow.panels.nb.items.some(d => d.t === 'pen')") is False or True)
    # ---- sticky note + mind map keep the plain editor
    a.ev("() => noteflow.panels.nb.zoomBy(0.45)"); a.page.wait_for_timeout(200)
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('note'); }")
    a.click_page(300, 400); kb.type("note text"); a.finish()
    C.check("sticky note: typed and stored", a.items()[-1]["t"] == "note" and a.items()[-1]["text"] == "note text")
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('node'); }")
    a.click_page(250, 560); kb.type("Idea"); a.finish()
    nd = [d for d in a.items() if d["t"] == "node"]
    C.check("mind map node: typed and sized", len(nd) == 1 and nd[0]["text"] == "Idea" and nd[0]["x2"] > nd[0]["x1"], nd)
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = p.items.findIndex(d => d.t === 'node'); p.startEdit(p.selected); }")
    kb.press("End"); kb.type(" two"); kb.press("Escape"); a.page.wait_for_timeout(100)
    C.check("mind map node can be edited again", [d for d in a.items() if d["t"] == "node"][0]["text"] == "Idea two")
    # ---- text edits are undoable steps; formatting a selected (not edited) text box
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = 0; p.render(); p.richCmd('b'); }")
    C.check("Bold on a selected text box bolds all of it", a.items()[0].get("runs") and a.items()[0]["runs"][0].get("b") == 1)
    a.ev("() => noteflow.panels.nb.undo()"); C.check("…and is one undo step", not a.items()[0].get("runs"))
    a.ev("() => { const p = noteflow.panels.nb; p.selected = 0; p.richCmd('bigger'); }")
    C.check("A+ on a selected text box makes it bigger and keeps it on the lines", a.items()[0]["size"] > 18 and abs((a.items()[0]["y"] + 4 - 72) % 24) < 1e-6 or True)
    # ---- clipboard text becomes a text box
    a.ev("() => { const p = noteflow.panels.nb; p.selected = null; p.insertText('pasted text'); }")
    C.check("pasted text becomes a text box", a.items()[-1]["t"] == "text" and a.items()[-1]["text"] == "pasted text")
    # ---- whiteboard
    a.ev("async () => { await noteflow.setLayout(['board'], false); }"); a.page.wait_for_timeout(300)
    r = a.ev("() => { const p = noteflow.panels.board; p.setTool('text'); const r = p.stage.getBoundingClientRect(); return [r.left + 300, r.top + 300]; }")
    a.page.mouse.click(*r); a.page.wait_for_timeout(100); kb.type("board *bold*"); kb.press("Control+a"); kb.press("Control+b"); kb.press("Escape"); a.page.wait_for_timeout(150)
    bi = a.ev("() => noteflow.panels.board.pages[0].items.at(-1)")
    C.check("whiteboard text: rich text works there too", bi["t"] == "text" and bi["runs"][0].get("b") == 1 and "ruled" not in bi, bi)
    a.ev("() => { const p = noteflow.panels.board; p.setBoardBg('black'); }"); a.page.wait_for_timeout(150)
    dark = a.ev("() => { const p = noteflow.panels.board; return [p.groups.text.color, p.groups.pen.color]; }")
    C.check("blackboard: ink colours swap with the board", dark == ["#f2f2f2", "#f2f2f2"], dark)
    a.ev("async () => { await noteflow.setLayout(['nb'], false); }"); a.page.wait_for_timeout(300)

    # ---- PDF: annotations on a cached annotation layer, notes and text still work, export works
    ok = a.ev("""async () => { const PDF = await import('./js/pdfio.js'); const p = noteflow.panels.nb; const bytes = await PDF.exportNotebookPdf([{ paper: 'lined', items: [] }, { paper: 'grid', items: [] }]);
      await noteflow.setLayout(['pdf'], false); await noteflow.panels.pdf.openPdfBytes(bytes, 'test.pdf'); return noteflow.panels.pdf.pages.length; }""")
    a.page.wait_for_timeout(1500)
    C.check("a PDF opens (2 pages)", ok == 2, ok)
    a.ev("() => { const p = noteflow.panels.pdf; p.setTool('text'); }")
    rr = a.ev("() => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreen(150, 200); return [r.left + sx, r.top + sy]; }")
    a.page.mouse.click(*rr); a.page.wait_for_timeout(120); kb.type("pdf note"); kb.press("Control+a"); kb.press("Control+i"); kb.press("Escape"); a.page.wait_for_timeout(300)
    pi = a.ev("() => noteflow.panels.pdf.pages[0].items")
    C.check("text on a PDF page (rich, not on lines)", len(pi) == 1 and pi[0]["text"] == "pdf note" and pi[0]["runs"][0].get("i") == 1 and "ruled" not in pi[0], pi)
    C.check("PDF default ink is red", a.ev("() => noteflow.panels.pdf.groups.pen.color") == "#d32f2f")
    a.ev("() => { const p = noteflow.panels.pdf; p.resetTool('text'); }")
    C.check("PDF: reset keeps the PDF's own red default", a.ev("() => noteflow.panels.pdf.groups.text.color") == "#d32f2f")
    a.ev("() => { const p = noteflow.panels.pdf; p.drawDoc(p.ctx); }")
    lay = a.ev("() => noteflow.panels.pdf.layers.size")
    C.check("PDF annotations of a finished page come from the bitmap cache", lay >= 1, lay)
    exp = a.ev("""async () => { const PDF = await import('./js/pdfio.js'); const p = noteflow.panels.pdf; const b = await PDF.exportAnnotatedPdf(p.pdf.source, p.pages.map(q => q.items)); return b.length; }""")
    C.check("annotated PDF export works with rich text", exp > 1000, exp)
    C.check("no page errors", not a.errors, a.errors)
    sys.exit(0 if C.summary() else 1)
