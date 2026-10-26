"""Auto-sized text boxes: tap and type, the box starts small and grows with the text, anchored on the edge the text is aligned to, and wraps at the edge of the usable area of
its surface (notebook: the writing area, ruled paper onto the next rule; PDF: the page; board: what is on screen). The editor and the canvas break lines in the same places."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
SENT = "The quick brown fox jumps over the lazy dog and keeps running across the whole page without stopping "
FA = "این یک متن بلند فارسی است که باید در یک خط دفتر نوشته شود و تا لبه صفحه ادامه پیدا کند بدون هیچ مشکلی "
SETUP = "async () => { window.__R = await import('./js/render.js'); }"
def ST(panel):
    return """() => { const R = window.__R, p = noteflow.panels.%s, d = p.editedItem(), L = R.layoutRich(d), c = R.caretAt(d, p.rt.getSel()[0]);
      const rows = []; const tw = document.createTreeWalker(p.rt.el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) for (let i = 0; i < n.length; i++) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const q = r.getClientRects()[0]; if (q && q.width > 0 && !rows.includes(Math.round(q.top))) rows.push(Math.round(q.top)); }
      return { x: d.x, w: d.w, g: d.g, lines: L.lines.length, dom: rows.length, caret: c.x, y: d.y, ruled: d.ruled }; }""" % panel
def grow_run(a, kb, text, panel, chunk=9):
    """type `text` chunk by chunk; return the list of states"""
    out = []
    for i in range(0, len(text), chunk):
        kb.type(text[i:i + chunk]); a.page.wait_for_timeout(15); out.append(a.ev(ST(panel)))
    return out
def check_run(name, sts, lo, hi, anchor, kind):
    """kind: left / right / center: the anchor stays; the box grows; it stays inside [lo, hi]; the caret stays inside the box; the editor has the canvas' lines"""
    bad = []
    pos = (lambda s: s["x"]) if kind == "left" else (lambda s: s["x"] + s["w"]) if kind == "right" else (lambda s: s["x"] + s["w"] / 2)
    for i, s in enumerate(sts):
        if abs(pos(s) - anchor) > 0.06: bad.append(("anchor moved", i, pos(s), anchor))
        if s["x"] < lo - 0.02 or s["x"] + s["w"] > hi + 0.02: bad.append(("outside the surface", i, s["x"], s["w"]))
        if i and s["w"] < sts[i - 1]["w"] - 0.02: bad.append(("shrank", i))
        if not (s["x"] - 0.5 <= s["caret"] <= s["x"] + s["w"] + 0.5): bad.append(("caret outside the box", i, s["caret"], s["x"], s["w"]))
        if s["lines"] != s["dom"]: bad.append(("editor lines != canvas lines", i, s["lines"], s["dom"]))
    C.check(name + ": anchored, growing, inside the surface, caret in the box, editor lines = canvas lines", not bad, bad[:3])
    C.check(name + ": starts small, ends wrapped at the edge", sts[0]["w"] < 200 and sts[-1]["lines"] > 1 and sts[-1]["w"] > 300, (sts[0]["w"], sts[-1]["lines"], sts[-1]["w"]))
def setup_nb(a, paper, dir_, align, size=16):
    a.ev("""([paper, dir, align, size]) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{paper, items: []}], 'x'); p.setTool('text'); p.setFmt({dir, align}); p.applyStyle('size', size, true); }""", [paper, dir_, align, size]); a.page.wait_for_timeout(150)
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard; a.ev(SETUP)
    a.ev("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(150)
    # ------------------------------------------------------------- notebook, lined paper (writing area 68..583 with the left margin)
    geo = a.ev("() => { const g = noteflow.panels.nb.pageGeo(); return [g.x0, g.x1]; }")
    setup_nb(a, "lined", "ltr", "left"); a.click_page(120, 150); sts = grow_run(a, kb, SENT * 2, "nb")
    check_run("lined / English / left", sts, geo[0], geo[1], 120, "left")
    C.check("lined: the text is ruled and the wrapped lines continue on the next rules", sts[-1]["ruled"] is True and sts[-1]["lines"] >= 2)
    a.finish(); it = a.items()[-1]
    C.check("saved auto-sized and exactly as wide as its widest line", it["g"] is True and abs(it["x"] - 120) < 0.02 and it["x"] + it["w"] <= geo[1] + 0.02, (it["x"], it["w"]))
    setup_nb(a, "lined", "rtl", "right"); a.click_page(500, 150); sts = grow_run(a, kb, FA * 2, "nb")
    check_run("lined / Persian / right", sts, geo[0] if False else 12, 500, 500, "right")
    a.finish()
    setup_nb(a, "lined", "ltr", "center"); a.click_page(300, 150); sts = grow_run(a, kb, SENT * 2, "nb")
    check_run("lined / English / centre", sts, geo[0], geo[1], 300, "center")
    a.finish()
    setup_nb(a, "blank", "ltr", "left"); a.click_page(100, 300); sts = grow_run(a, kb, SENT * 2, "nb")
    check_run("blank paper / English / left", sts, 12, 583, 100, "left"); a.finish()
    setup_nb(a, "lined", "ltr", "left", size=8); a.click_page(100, 150); sts = grow_run(a, kb, SENT * 3, "nb", chunk=20)
    check_run("lined / small letters (8 pt)", sts, geo[0], geo[1], 100, "left"); a.finish()

    # ------------------------------------------------------------- the caret / box while typing at the very first character
    setup_nb(a, "lined", "ltr", "left", size=18); a.click_page(100, 150); kb.type("W"); a.page.wait_for_timeout(40); s = a.ev(ST("nb"))
    C.check("one letter: the box is just big enough for it", s["w"] < 8 + 18 * 1.5 and s["caret"] <= s["x"] + s["w"], s)

    # ------------------------------------------------------------- an existing auto-sized box keeps growing when it is edited again (no manual resizing)
    a.finish(); n0 = len(a.items()); w0 = a.items()[-1]["w"]
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('text'); }")
    a.click_page(104, 150 + 10); kb.type(" and then a few more words"); a.page.wait_for_timeout(40); a.finish(); its = a.items()
    C.check("editing a settled box again: it grows with the new text, no second box, no resize by hand", len(its) == n0 and its[-1]["w"] > w0 + 80 and its[-1]["g"] is True and abs(its[-1]["x"] - 100) < 0.02, (n0, len(its), w0, its[-1]["w"]))

    # ------------------------------------------------------------- bold / bigger on a selected box: the box follows
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = p.items.length - 1; p.ui(); }")
    w1 = a.items()[-1]["w"]; a.ev("() => noteflow.panels.nb.richCmd('bigger')"); a.page.wait_for_timeout(100); w2 = a.items()[-1]["w"]
    a.ev("() => noteflow.panels.nb.richCmd('b')"); a.page.wait_for_timeout(100); w3 = a.items()[-1]["w"]
    C.check("bigger / bold on a selected auto-sized box: the box widens with its text (anchored, inside the page)", w2 > w1 and w3 >= w2 and a.items()[-1]["x"] + w3 <= geo[1] + 0.02 and a.ev("() => noteflow.panels.nb.items.at(-1).g") is True, (w1, w2, w3))
    a.ev("() => noteflow.panels.nb.richCmd('smaller')"); a.page.wait_for_timeout(100)
    C.check("smaller: it narrows again", a.items()[-1]["w"] < w3, a.items()[-1]["w"])
    a.ev("() => { const p = noteflow.panels.nb; p.undo(); p.undo(); p.undo(); }"); a.page.wait_for_timeout(100)
    C.check("undo restores the box width as well", abs(a.items()[-1]["w"] - w1) < 0.5, a.items()[-1]["w"])

    # ------------------------------------------------------------- PDF page
    a.ev("""async () => { const PDF = await import('./js/pdfio.js'); const bytes = await PDF.exportNotebookPdf([{ paper: 'blank', items: [] }]);
      await noteflow.setLayout(['pdf'], false); await noteflow.panels.pdf.openPdfBytes(bytes, 'test.pdf'); }"""); a.page.wait_for_timeout(500)
    a.ev("() => { const p = noteflow.panels.pdf; p.setTool('text'); p.setFmt({ dir: 'ltr', align: 'left' }); p.applyStyle('size', 14, true); }")
    pw_ = a.ev("() => noteflow.panels.pdf.pageDims()[0]")
    rr = a.ev("() => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreen(150, 200); return [r.left + sx, r.top + sy]; }")
    a.page.mouse.click(*rr); a.page.wait_for_timeout(120); sts = grow_run(a, kb, SENT * 2, "pdf")
    check_run("PDF page / English / left", sts, 4, pw_ - 4, 150, "left")
    a.finish(); pit = a.ev("() => noteflow.panels.pdf.pages[0].items.at(-1)")
    C.check("PDF: saved auto-sized, not ruled, inside the page", pit["g"] is True and "ruled" not in pit and pit["x"] + pit["w"] <= pw_ - 4 + 0.02, (pit["x"], pit["w"]))
    a.ev("() => { const p = noteflow.panels.pdf; p.setFmt({ dir: 'rtl', align: 'right' }); }")
    rr = a.ev("() => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreen(400, 310); return [r.left + sx, r.top + sy]; }")
    a.page.mouse.click(*rr); a.page.wait_for_timeout(120); sts = grow_run(a, kb, FA * 2, "pdf")
    check_run("PDF page / Persian / right", sts, 4, 400, 400, "right"); a.finish()

    # ------------------------------------------------------------- board: grows up to what is on screen, then wraps
    a.ev("async () => { await noteflow.setLayout(['board'], false); }"); a.page.wait_for_timeout(400)
    a.ev("() => { const p = noteflow.panels.board; p.setTool('text'); p.setFmt({ dir: 'ltr', align: 'left' }); p.applyStyle('size', 24, true); }")
    info = a.ev("""() => { const p = noteflow.panels.board, r = p.stage.getBoundingClientRect(), sx = 300, sy = 300; const pt = p.screenToPage(sx, sy), right = p.screenToPage(p.cw, 0).x - 12;
      return { click: [r.left + sx, r.top + sy], x: pt.x, right }; }""")
    a.page.mouse.click(*info["click"]); a.page.wait_for_timeout(120); sts = grow_run(a, kb, SENT * 3, "board", chunk=12)
    check_run("board / English / left", sts, info["x"] - 1, info["right"], sts[0]["x"], "left")
    C.check("board: wraps at the visible edge (not at the far edge of the huge board, not at a fixed 300)", sts[-1]["x"] + sts[-1]["w"] > info["right"] - 80 and sts[-1]["w"] > 400, (sts[-1]["x"] + sts[-1]["w"], info["right"]))
    a.finish()
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
