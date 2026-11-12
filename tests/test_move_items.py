"""Dragging items to another page (Notebook and PDF panels): every item type alone, several selected together (relative positions and properties kept, one undo step),
connectors, links, continued text, ruled text, pages of different sizes, and the old behaviour inside one page."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBgAAEzzCv0yL9nxAAAAAElFTkSuQmCC"
TYPES = {
  "rect": {"t": "rect", "x1": 100, "y1": 100, "x2": 180, "y2": 160, "color": "#d32f2f", "w": 3, "fill": "#ffeb3b"},
  "ellipse": {"t": "ellipse", "x1": 100, "y1": 100, "x2": 200, "y2": 160, "color": "#1976d2", "w": 4, "fill": "#bbdefb"},
  "shape": {"t": "shape", "kind": "triangle", "x1": 100, "y1": 100, "x2": 200, "y2": 190, "color": "#388e3c", "w": 3, "fill": "#c8e6c9"},
  "line": {"t": "line", "x1": 100, "y1": 100, "x2": 220, "y2": 140, "color": "#000000", "w": 4},
  "arrow": {"t": "arrow", "x1": 100, "y1": 100, "x2": 220, "y2": 160, "color": "#d32f2f", "w": 4},
  "pen": {"t": "pen", "pts": [[100, 100], [130, 130], [170, 110], [200, 150]], "color": "#000000", "w": 5},
  "pressure pen": {"t": "pen", "pts": [[100, 100, 0.2], [130, 130, 0.9], [170, 110, 0.5], [200, 150, 0.3]], "color": "#000000", "w": 5},
  "mark": {"t": "mark", "pts": [[100, 100], [200, 100], [260, 110]], "color": "#fdd835", "w": 20, "alpha": 110},
  "text": {"t": "text", "id": "tx1", "x": 100, "y": 100, "w": 160, "dir": "ltr", "align": "left", "text": "moving text with bold", "runs": [{"s": "moving text ", "i": 1}, {"s": "with bold", "b": 1}], "color": "#1a1a1a", "size": 18, "alpha": 255, "bright": 0},
  "note": {"t": "note", "x": 100, "y": 100, "w": 140, "h": 100, "text": "sticky", "color": "#fff59d", "size": 16},
  "node": {"t": "node", "id": "nz", "kind": "round", "x1": 100, "y1": 100, "x2": 190, "y2": 144, "text": "Idea", "color": "#1a1a1a", "w": 2, "size": 18, "dir": "ltr", "align": "center", "alpha": 255, "bright": 0},
  "image": {"t": "image", "x1": 100, "y1": 100, "x2": 160, "y2": 160, "data": PNG},
}
POS = ["x", "y", "x1", "y1", "x2", "y2", "pts"]

with sync_playwright() as pw:
    a = App(pw, width=1400, height=950)
    P = lambda js, arg=None: a.ev(js, arg)
    m = a.page.mouse
    def setup(panel, pages_items, paper="blank", zoom=0.5):
        P("""([panel, pages, paper, zoom]) => { const p = noteflow.panels[panel]; p.finishEdit(); p.setNotebook(pages.map((items) => ({ paper, items })), 'mv'); p.setTool('select'); noteflow.setActive(p); p.zoomBy(zoom / p.view.scale); p.scrollToPage(0); p.render(); }""", [panel, pages_items, paper, zoom])
        a.page.wait_for_timeout(250)
    ANCHOR = """(idx) => { const p = noteflow.panels.nb, d = p.items[idx], b = p.boundsOf(d), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, cands = [[cx, cy], [b[0] + 2, cy], [cx, b[1] + 2]];
        if (d.pts) for (const q of d.pts) cands.push(q); if (d.t === 'line' || d.t === 'arrow') cands.unshift([(d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2]);
        for (const c of cands) if (p.hit({ x: c[0], y: c[1] }) === idx) return { a: c, center: [cx, cy] }; return null; }"""
    SCR = "([i, x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }"
    def screen(i, x, y): return P(SCR, [i, x, y])
    def drag_to_page(idx, page, target=(300, 300), shift_extra=(0, 0)):
        an = P(ANCHOR, idx); assert an, "no grab point"
        sx, sy = screen(0, *an["a"]); tx, ty = screen(page, target[0] + shift_extra[0], target[1] + shift_extra[1]); cx, cy = screen(0, *an["center"])
        ex, ey = sx + (tx - cx), sy + (ty - cy)
        m.move(sx, sy); m.down(); m.move((sx + ex) / 2, (sy + ey) / 2, steps=5); m.move(ex, ey, steps=6); m.up(); a.page.wait_for_timeout(250)
    pages = lambda: P("() => noteflow.panels.nb.pages.map((pg) => pg.items)")
    def strip(d): return {k: v for k, v in d.items() if k not in POS}
    def bounds(d): return P("(d) => noteflow.panels.nb.boundsOf(d)", d)
    hist = lambda: P("() => { const h = noteflow.panels.nb.history; return h.undo ? h.undo.length : (h.undoLen ? h.undoLen() : 0); }")

    # ============================================ every type, alone, notebook
    for name, it in TYPES.items():
        setup("nb", [[it], [], [], []]); b0 = bounds(it); h0 = hist(); before = pages()
        drag_to_page(0, 1)
        pg = pages(); ok = len(pg[0]) == 0 and len(pg[1]) == 1
        d = pg[1][0] if ok else None
        same = ok and strip(d) == strip(it)
        b1 = bounds(d) if ok else None
        size = ok and abs((b1[2] - b1[0]) - (b0[2] - b0[0])) < 0.05 and abs((b1[3] - b1[1]) - (b0[3] - b0[1])) < 0.05
        centre = ok and abs((b1[0] + b1[2]) / 2 - 300) < 3 and abs((b1[1] + b1[3]) / 2 - 300) < 3
        pts_ok = ok and (not it.get("pts") or [[round(q[i] - r[i], 1) for i in range(len(q))] for q, r in zip(d["pts"], it["pts"])] == [[round(d["pts"][0][0] - it["pts"][0][0], 1), round(d["pts"][0][1] - it["pts"][0][1], 1)] + [0] * (len(it["pts"][0]) - 2)] * len(it["pts"]))
        C.check(f"{name}: dragged to the next page it is there (not on the first), with all properties and its size", ok and same and size and pts_ok, [len(pg[0]), len(pg[1]), same, size])
        C.check(f"{name}: dropped where the pointer left it (centre at the drop point), selected on the new page", centre and P("() => [noteflow.panels.nb.cur, noteflow.panels.nb.selected, noteflow.panels.nb.tool]") == [1, 0, "select"], b1)
        P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
        C.check(f"{name}: Undo puts it back exactly (ONE step)", pages() == before and hist() == h0, hist())
        P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(150)
        C.check(f"{name}: Redo moves it again", len(pages()[1]) == 1 and len(pages()[0]) == 0)

    # ============================================ a group of different types
    G = [TYPES["rect"], dict(TYPES["text"], x=300, y=100), dict(TYPES["pen"]), dict(TYPES["note"], x=300, y=250), dict(TYPES["image"], x1=120, y1=300, x2=180, y2=360), dict(TYPES["mark"])]
    G[2] = {"t": "pen", "pts": [[100, 250], [150, 280], [200, 260]], "color": "#000000", "w": 4}; G[5] = {"t": "mark", "pts": [[100, 400], [260, 410]], "color": "#fdd835", "w": 20, "alpha": 110}
    setup("nb", [G, [], [], []]); before = pages(); h0 = hist()
    m.move(*screen(0, 60, 60)); m.down(); m.move(*screen(0, 450, 450), steps=8); m.up(); a.page.wait_for_timeout(250)
    C.check("(setup) a marquee selects the six items (all types)", P("() => noteflow.panels.nb.groupIdx().length") == 6, P("() => noteflow.panels.nb.groupIdx().length"))
    tl0 = [bounds(d)[:2] for d in before[0]]
    P("() => noteflow.panels.nb.finishEdit()")
    an = P(ANCHOR, 0); sx, sy = screen(0, *an["a"]); tx, ty = screen(1, an["a"][0] + 40, an["a"][1] + 40)
    m.move(sx, sy); m.down(); m.move((sx + tx) / 2, (sy + ty) / 2, steps=5); m.move(tx, ty, steps=6); m.up(); a.page.wait_for_timeout(300)
    pg = pages(); moved = pg[1]
    C.check("dragging one member of the group to the next page moves ALL of them there (none left behind)", len(pg[0]) == 0 and len(moved) == 6, [len(pg[0]), len(moved)])
    C.check("…each keeps all its properties", all(strip(x) == strip(y) for x, y in zip(moved, before[0])))
    tl1 = [bounds(d)[:2] for d in moved]; dxy = [(round(b[0] - a0[0], 1), round(b[1] - a0[1], 1)) for b, a0 in zip(tl1, tl0)]
    C.check("…and keep their positions relative to each other (every item shifted by the same distance)", len(set(dxy)) == 1, dxy)
    C.check("…the group is selected on the new page", P("() => [noteflow.panels.nb.cur, noteflow.panels.nb.groupIdx().length]") == [1, 6])
    C.check("the whole move is ONE undo step", hist() == h0 + 1, (h0, hist()))
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("Undo puts all six back", pages() == before)
    P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(150)
    C.check("Redo moves them all again", len(pages()[1]) == 6)
    # dropped across the page corner: kept inside, group intact
    setup("nb", [G, [], [], []])
    m.move(*screen(0, 60, 60)); m.down(); m.move(*screen(0, 450, 450), steps=8); m.up(); a.page.wait_for_timeout(200)
    an = P(ANCHOR, 0); sx, sy = screen(0, *an["a"]); tx, ty = screen(1, 520, 560)
    m.move(sx, sy); m.down(); m.move((sx + tx) / 2, (sy + ty) / 2, steps=5); m.move(tx, ty, steps=6); m.up(); a.page.wait_for_timeout(300)
    inside = P("""() => { const p = noteflow.panels.nb, [w, h] = p.sizeOf(1); return p.pages[1].items.every((d) => { const b = p.boundsOf(d); return b[0] >= -0.01 && b[1] >= -0.01 && b[2] <= w + 0.01 && b[3] <= h + 0.01; }); }""")
    C.check("a group dropped over the corner of a page stays completely inside it", len(pages()[1]) == 6 and inside)
    # ============================================ the old behaviour inside one page
    setup("nb", [[TYPES["rect"], dict(TYPES["text"], x=300, y=300)], [], [], []])
    drag_to_page(0, 0, target=(160, 220)); pg = pages()
    C.check("moving an item within its own page still works (stays on that page)", len(pg[0]) == 2 and len(pg[1]) == 0, [len(pg[0]), len(pg[1])])
    # ============================================ connectors
    n1 = dict(TYPES["node"], id="nA"); n2 = dict(TYPES["node"], id="nB", x1=300, x2=390); n3 = dict(TYPES["node"], id="nC", x1=100, x2=190, y1=300, y2=344)
    cn = lambda f, t: {"t": "conn", "from": f, "to": t, "style": "curve", "arrow": False, "color": "#1a1a1a", "w": 2}
    setup("nb", [[n1, n2, n3, cn("nA", "nB"), cn("nB", "nC")], [], [], []]); before = pages()
    m.move(*screen(0, 60, 60)); m.down(); m.move(*screen(0, 420, 190), steps=8); m.up(); a.page.wait_for_timeout(200)
    an = P(ANCHOR, 0); sx, sy = screen(0, *an["a"]); tx, ty = screen(1, 250, 250)
    m.move(sx, sy); m.down(); m.move((sx + tx) / 2, (sy + ty) / 2, steps=5); m.move(tx, ty, steps=6); m.up(); a.page.wait_for_timeout(300)
    pg = pages(); kinds = lambda l: sorted(d["t"] + (d.get("id") or d.get("from", "") + d.get("to", "")) for d in l)
    C.check("a branch (two nodes and their connector) moves together; the connector to a node that stays is removed", kinds(pg[1]) == ["connnAnB", "nodenA", "nodenB"] and kinds(pg[0]) == ["nodenC"], [kinds(pg[0]), kinds(pg[1])])
    C.check("…with a notice, and Undo brings every connector back", a.page.locator("#toasts .toast", has_text="connector").count() >= 1)
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("Undo restores nodes and both connectors", pages() == before)
    # ============================================ links survive
    setup("nb", [[dict(TYPES["text"], id="iLinked1")], [], [], []])
    P("""async () => { const L = noteflow.links, nb = noteflow.panels.nb; const { PDFDocument } = PDFLib; const d = await PDFDocument.create(); d.addPage([595, 842]); d.addPage([595, 842]);
        await noteflow.setLayout(['pdf','nb'], false); await noteflow.panels.pdf.openPdfBytes(await d.save(), 'l.pdf'); await nb.setNotebook([0, 1, 2, 3].map((i) => ({ paper: 'blank', items: i ? [] : [{ t: 'text', id: 'iLinked1', x: 100, y: 100, w: 160, text: 'linked note text', color: '#1a1a1a', size: 18 }] })), 'mv');
        L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(noteflow.panels.pdf, 1)); nb.setTool('select'); noteflow.setActive(nb); nb.zoomBy(0.5 / nb.view.scale); nb.scrollToPage(0); nb.render(); }""")
    a.page.wait_for_timeout(300); drag_to_page(0, 1)
    ok = P("() => { const L = noteflow.links, l = L.store.all()[0], nb = noteflow.panels.nb; return [L.store.size, nb.pages[1].items.length, L.describe(l.a.k === 'item' ? l.a : l.b).ok]; }")
    C.check("a note with a link keeps its link when it is moved to another page", ok == [1, 1, True], ok)
    # ============================================ continued text, ruled text, paper
    ch = lambda id, cont: {"t": "text", "id": id, "x": 60, "y": 500, "w": 300, "text": id, "color": "#1a1a1a", "size": 18, "fl": "FLOW1", **({"cont": True} if cont else {})}
    setup("nb", [[ch("p1", False)], [ch("p2", True)], [], []])
    drag_to_page(0, 2, target=(300, 300)) if False else None
    an = P("() => { const p = noteflow.panels.nb; p.goto(1); return 1; }")
    a.page.wait_for_timeout(200)
    P("() => { const p = noteflow.panels.nb; p.scrollToPage(1); p.render(); }"); a.page.wait_for_timeout(150)
    P("() => { const p = noteflow.panels.nb; p.setCur(1); }")
    lines = P("() => noteflow.panels.nb.pages.map((pg) => pg.items.map((d) => d.fl || null))")
    C.check("(setup) a text that continues from page 1 to page 2 is a chain", lines[0] == ["FLOW1"] and lines[1] == ["FLOW1"], lines)
    P("""async () => { const p = noteflow.panels.nb, d = p.pages[1].items[0], b = p.boundsOf(d); window.__src = [b[0], b[1]]; }""")
    sx, sy = screen(1, 70, 515); tx, ty = screen(2, 70, 200)
    m.move(sx, sy); m.down(); m.move((sx + tx) / 2, (sy + ty) / 2, steps=5); m.move(tx, ty, steps=6); m.up(); a.page.wait_for_timeout(300)
    lines = P("() => noteflow.panels.nb.pages.map((pg) => pg.items.map((d) => [d.fl || null, d.cont || null, d.text]))")
    C.check("moving one piece of continued text to another page detaches the chain: independent text boxes, nothing lost", len(lines[2]) == 1 and lines[2][0][0] is None and lines[0][0][0] is None and lines[2][0][2] == "p2", lines)
    ruled = {"t": "text", "x": 60, "y": 92, "w": 200, "text": "ruled text", "color": "#1a1a1a", "size": 18, "ruled": True, "dir": "ltr", "align": "left", "alpha": 255, "bright": 0}
    P("""(r) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{ paper: 'lined', items: [r] }, { paper: 'blank', items: [] }, { paper: 'lined', items: [] }, { paper: 'blank', items: [] }], 'mv'); p.setTool('select'); p.zoomBy(0.5 / p.view.scale); p.scrollToPage(0); p.render(); }""", ruled); a.page.wait_for_timeout(250)
    drag_to_page(0, 1); pg = pages()
    C.check("ruled text moved from lined paper to blank paper becomes free text (no line snapping)", len(pg[1]) == 1 and "ruled" not in pg[1][0], pg[1])
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    an = P(ANCHOR, 0); sx, sy = screen(0, *an["a"]); P("() => { const p = noteflow.panels.nb; p.scrollToPage(0); p.zoomBy(0.4 / p.view.scale); p.render(); }"); a.page.wait_for_timeout(200)
    an = P(ANCHOR, 0); sx, sy = screen(0, *an["a"]); tx, ty = screen(2, 150, 260)
    m.move(sx, sy); m.down(); m.move((sx + tx) / 2, (sy + ty) / 2, steps=5); m.move(tx, ty, steps=6); m.up(); a.page.wait_for_timeout(300)
    pg = pages()
    C.check("…and onto another lined page it stays ruled and sits on that page's lines", len(pg[2]) == 1 and pg[2][0].get("ruled") is True and P("(d) => noteflow.panels.nb.settle(d) === d || JSON.stringify(noteflow.panels.nb.settle(d)) === JSON.stringify(d)", pg[2][0]), pg[2])
    # ============================================ the PDF panel, pages of different sizes
    P("""async () => { const { PDFDocument } = PDFLib; const d = await PDFDocument.create(); d.addPage([595, 842]); d.addPage([595, 842]); d.addPage([842, 595]); d.addPage([300, 400]);
        await noteflow.setLayout(['pdf','nb'], false); await noteflow.panels.pdf.openPdfBytes(await d.save(), 'sizes.pdf'); const p = noteflow.panels.pdf; p.setTool('select'); noteflow.setActive(p); p.zoomBy(0.4 / p.view.scale); await p.goto(0); }""")
    a.page.wait_for_timeout(500)
    PITEMS = [TYPES["pen"], {"t": "hl", "x1": 100, "y1": 300, "x2": 260, "y2": 322, "color": "#ffee00"}, dict(TYPES["text"], x=100, y=400), dict(TYPES["rect"], x1=300, y1=500, x2=380, y2=560), dict(TYPES["image"], x1=300, y1=100, x2=360, y2=160)]
    P("(its) => { const p = noteflow.panels.pdf; p.pages[0].items = its; p.render(); }", PITEMS); a.page.wait_for_timeout(300)
    PANCH = """(idx) => { const p = noteflow.panels.pdf, d = p.items[idx], b = p.boundsOf(d), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, c = [[cx, cy], [b[0] + 2, cy]]; if (d.pts) for (const q of d.pts) c.push(q); for (const q of c) if (p.hit({ x: q[0], y: q[1] }) === idx) return { a: q, center: [cx, cy] }; return null; }"""
    PSCR = "([i, x, y]) => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }"
    for idx, name in enumerate(["pen", "highlight", "text", "rect", "image"]):
        P("(its) => { const p = noteflow.panels.pdf; p.pages.forEach((pg) => { pg.items = []; }); p.pages[0].items = its; p.setCur(0); p.scrollToPage(0); p.render(); }", [PITEMS[idx]]); a.page.wait_for_timeout(250)
        an = P(PANCH, 0); sx, sy = P(PSCR, [0, *an["a"]]); cx, cy = P(PSCR, [0, *an["center"]]); tx, ty = P(PSCR, [1, 300, 300]); ex, ey = sx + tx - cx, sy + ty - cy
        m.move(sx, sy); m.down(); m.move((sx + ex) / 2, (sy + ey) / 2, steps=5); m.move(ex, ey, steps=6); m.up(); a.page.wait_for_timeout(300)
        res = P("() => { const p = noteflow.panels.pdf; return [p.pages[0].items.length, p.pages[1].items.length, p.cur]; }")
        C.check(f"PDF panel: a {name} annotation dragged to the next PDF page moves there", res == [0, 1, 1], res)
    P("(its) => { const p = noteflow.panels.pdf; p.pages.forEach((pg) => { pg.items = []; }); p.pages[1].items = its; p.setCur(1); p.scrollToPage(1); p.render(); }", [dict(TYPES["rect"], x1=400, y1=700, x2=560, y2=800)]); a.page.wait_for_timeout(250)
    an = P(PANCH.replace("noteflow.panels.pdf", "noteflow.panels.pdf"), 0); sx, sy = P(PSCR, [1, *an["a"]]); cx, cy = P(PSCR, [1, *an["center"]]); tx, ty = P(PSCR, [3, 280, 380]); ex, ey = sx + tx - cx, sy + ty - cy
    m.move(sx, sy); m.down(); m.move((sx + ex) / 2, (sy + ey) / 2, steps=5); m.move(ex, ey, steps=6); m.up(); a.page.wait_for_timeout(300)
    fit = P("""() => { const p = noteflow.panels.pdf, d = p.pages[3].items[0]; if (!d) return null; const b = p.boundsOf(d), [w, h] = p.sizeOf(3); return [b[0] >= -0.01 && b[1] >= -0.01 && b[2] <= w + 0.01 && b[3] <= h + 0.01, w, h]; }""")
    C.check("dropped on a smaller (300 x 400) PDF page the annotation is kept inside that page", fit and fit[0] is True, fit)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
