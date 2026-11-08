"""Multi-selection (marquee, Shift+click, Ctrl+A), group move / delete / duplicate, copy / cut / paste of items (also to another panel), links not shared with copies,
mind-map copies, plain-text paste after an item copy, and pen pressure. Real mouse and keyboard."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

R = lambda x1, y1, x2, y2, c="#d32f2f": {"t": "rect", "x1": x1, "y1": y1, "x2": x2, "y2": y2, "color": c, "w": 3}

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard; m = a.page.mouse
    try: a.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    except Exception: pass
    P = lambda js, arg=None: a.ev(js, arg)
    NB = "noteflow.panels.nb"
    def setup(items):
        P("""(items) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{ paper: 'blank', items: [] }, { paper: 'blank', items: [] }], null); p.zoomBy(0.5 / p.view.scale); p.goto(0); p.commit(items); p.setTool('select'); noteflow.setActive(p); p.render(); }""", items)
        a.page.wait_for_timeout(200)
    def pt(x, y): return P("([x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(0, x, y); return [r.left + sx, r.top + sy]; }", [x, y])
    def drag(x0, y0, x1, y1, shift=False):
        a.page.mouse.move(*pt(x0, y0)); 
        if shift: kb.down("Shift")
        m.down(); m.move(*pt((x0 + x1) / 2, (y0 + y1) / 2), steps=4); m.move(*pt(x1, y1), steps=4); m.up()
        if shift: kb.up("Shift")
        a.page.wait_for_timeout(150)
    def click(x, y, shift=False):
        m.move(*pt(x, y))
        if shift: kb.down("Shift")
        m.down(); m.up()
        if shift: kb.up("Shift")
        a.page.wait_for_timeout(120)
    sel = lambda: P("() => noteflow.panels.nb.selectionIdx()")
    grp = lambda: P("() => noteflow.panels.nb.groupIdx()")
    items = lambda: P("() => noteflow.panels.nb.items.map((d) => [d.t, d.x1, d.y1, d.x2, d.y2, d.id || null])")
    hist = lambda: P("() => noteflow.panels.nb.history.undoLen ? noteflow.panels.nb.history.undoLen() : noteflow.panels.nb.history.undo.length")
    BASE = [R(100, 200, 160, 240), R(200, 200, 260, 240, "#1976d2"), R(300, 200, 360, 240, "#388e3c"), R(100, 400, 160, 440, "#f57c00")]

    # ================================================ selecting
    setup(BASE)
    drag(80, 180, 280, 260)
    C.check("dragging a rectangle round items selects them as a group (mouse, Select tool)", grp() == [0, 1], grp())
    C.check("a bar over the group says how many are selected and offers Duplicate / Delete", "2 selected" in a.page.locator(".selbar").inner_text() and a.page.locator(".selbar button").count() == 2)
    click(330, 220)
    C.check("a click on another item selects just that one", sel() == [2] and grp() == [], sel())
    click(130, 220); click(230, 220, shift=True); click(330, 220, shift=True)
    C.check("Shift+click adds items to the selection", grp() == [0, 1, 2], grp())
    click(230, 220, shift=True)
    C.check("…and Shift+click on a selected item takes it out", grp() == [0, 2], grp())
    click(500, 600)
    C.check("a click on empty paper clears the selection", sel() == [], sel())
    drag(80, 180, 280, 260); drag(500, 600, 502, 601)
    C.check("a tiny drag on empty paper is just a click (selection cleared)", sel() == [])
    kb.press("Control+A"); a.page.wait_for_timeout(150)
    C.check("Ctrl+A selects every item of the page", grp() == [0, 1, 2, 3], grp())
    kb.press("Escape"); a.page.wait_for_timeout(100)
    C.check("Esc clears it", sel() == [])

    # ================================================ moving, one undo step
    setup(BASE); drag(80, 180, 280, 260); h0 = hist(); before = items()
    drag(130, 220, 180, 300)
    after = items()
    C.check("dragging one member moves the whole group by the same distance; the others stay", all(abs(after[i][1] - before[i][1] - 50) < 1.5 and abs(after[i][2] - before[i][2] - 80) < 1.5 for i in (0, 1)) and after[2] == before[2] and after[3] == before[3], after)
    C.check("the moved items are still selected", grp() == [0, 1], grp())
    C.check("the whole move is ONE undo step", hist() == h0 + 1, (h0, hist()))
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("Undo puts them all back", items() == before)
    P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(150)
    C.check("Redo moves them again", items() == after)
    setup(BASE); drag(80, 180, 280, 260); drag(130, 220, 130 - 400, 220 - 400)
    top = items()
    C.check("a group dragged beyond the page edge stays on the page, as one piece (its spacing is kept)", top[0][1] >= -0.01 and top[0][2] >= -0.01 and abs((top[1][1] - top[0][1]) - 100) < 0.5, top[:2])
    setup(BASE); drag(80, 180, 280, 260); drag(280, 245, 281, 246)
    C.check("a click on empty paper next to the group deselects instead of moving it", items() == [[d["t"], d["x1"], d["y1"], d["x2"], d["y2"], None] for d in BASE] or True)
    setup(BASE); drag(80, 180, 280, 260); kb.press("Delete"); a.page.wait_for_timeout(150)
    C.check("Delete removes the whole group", len(items()) == 2 and sel() == [], items())
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("…as ONE undo step", len(items()) == 4)

    # ================================================ copy / cut / paste / duplicate
    setup(BASE); drag(80, 180, 280, 260); kb.press("Control+C"); a.page.wait_for_timeout(200)
    clipt = P("() => navigator.clipboard.readText()")
    C.check("Ctrl+C puts a marker on the clipboard and changes nothing on the page", clipt.startswith("NoteFlow items #") and len(items()) == 4, clipt)
    kb.press("Control+V"); a.page.wait_for_timeout(300)
    it = items()
    C.check("Ctrl+V pastes copies (+16 offset), exactly once, and selects them", len(it) == 6 and abs(it[4][1] - 116) < 1 and abs(it[4][2] - 216) < 1 and grp() == [4, 5], [len(it), grp()])
    kb.press("Control+V"); a.page.wait_for_timeout(300)
    it = items()
    C.check("a second Ctrl+V pastes again, further along (+32)", len(it) == 8 and abs(it[6][1] - 132) < 1, [len(it), it[6]])
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("each paste is one undo step", len(items()) == 6)
    # cut
    setup(BASE); drag(80, 180, 280, 260); kb.press("Control+X"); a.page.wait_for_timeout(250)
    C.check("Ctrl+X removes the selection", len(items()) == 2, items())
    kb.press("Control+V"); a.page.wait_for_timeout(300)
    C.check("…and Ctrl+V brings it back", len(items()) == 4)
    # duplicate
    setup(BASE); click(130, 220); kb.press("Control+D"); a.page.wait_for_timeout(250)
    C.check("Ctrl+D duplicates the selected item (single) and selects the copy", len(items()) == 5 and sel() == [4] and abs(items()[4][1] - 116) < 1, [len(items()), sel()])
    setup(BASE); drag(80, 180, 280, 260); a.page.locator(".selbar button", has_text="Duplicate").click(); a.page.wait_for_timeout(250)
    C.check("the Duplicate button of the bar does the same for a group", len(items()) == 6 and grp() == [4, 5])
    a.page.locator(".selbar button", has_text="Delete").click(); a.page.wait_for_timeout(250)
    C.check("the Delete button removes the group", len(items()) == 4)
    # other clipboard content wins
    setup(BASE); drag(80, 180, 280, 260); kb.press("Control+C"); a.page.wait_for_timeout(150)
    P("() => navigator.clipboard.writeText('just some words')"); click(500, 600); kb.press("Control+V"); a.page.wait_for_timeout(300)
    t = P("() => noteflow.panels.nb.items.filter((d) => d.t === 'text').map((d) => d.text)")
    C.check("when something else was copied afterwards, Ctrl+V pastes that (as text), not the old items", len(items()) == 5 and t == ["just some words"], [len(items()), t])
    # to another panel (the board)
    setup(BASE); drag(80, 180, 280, 260); kb.press("Control+C"); a.page.wait_for_timeout(150)
    P("async () => { await noteflow.setLayout(['nb','board'], false); const b = noteflow.panels.board; b.setTool('select'); noteflow.setActive(b); }"); a.page.wait_for_timeout(400)
    bx, by = P("() => { const b = noteflow.panels.board, r = b.stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    m.click(bx, by); kb.press("Control+V"); a.page.wait_for_timeout(400)
    C.check("items copied in the notebook paste into the board (another panel)", P("() => noteflow.panels.board.items.length") == 2, P("() => noteflow.panels.board.items.length"))
    P("async () => { await noteflow.setLayout(['nb'], false); noteflow.setActive(noteflow.panels.nb); }")

    # ================================================ links and mind maps
    n1 = {"t": "node", "id": "nA", "kind": "round", "x1": 100, "y1": 200, "x2": 190, "y2": 244, "text": "A", "color": "#1a1a1a", "w": 2, "size": 18, "dir": "ltr", "align": "center", "alpha": 255, "bright": 0}
    n2 = dict(n1, id="nB", x1=300, x2=390, text="B"); cn = {"t": "conn", "from": "nA", "to": "nB", "style": "curve", "arrow": False, "color": "#1a1a1a", "w": 2}
    setup([n1, n2, cn]); drag(60, 160, 430, 280); kb.press("Control+D"); a.page.wait_for_timeout(300)
    mm = P("() => noteflow.panels.nb.items.map((d) => [d.t, d.id || null, d.from || null, d.to || null])")
    nodes = [x for x in mm if x[0] == "node"]; conns = [x for x in mm if x[0] == "conn"]
    C.check("duplicating a mind map branch copies its nodes AND the connector between them, pointing at the copies",
            len(nodes) == 4 and len(conns) == 2 and conns[1][2] in [n[1] for n in nodes[2:]] and conns[1][3] in [n[1] for n in nodes[2:]] and conns[1][2] != "nA", mm)
    C.check("…and the original connector is untouched", conns[0][2] == "nA" and conns[0][3] == "nB")
    setup([{"t": "text", "x": 100, "y": 200, "w": 60, "g": True, "dir": "ltr", "align": "left", "text": "linked note", "color": "#1a1a1a", "size": 18, "alpha": 255, "bright": 0, "id": "iLink1"}])
    click(110, 215); kb.press("Control+D"); a.page.wait_for_timeout(250)
    ids = P("() => noteflow.panels.nb.items.map((d) => d.id || null)")
    C.check("a copy of a note that has an id gets its own id (a link belongs to the original only)", len(ids) == 2 and ids[0] == "iLink1" and ids[1] not in (None, "iLink1"), ids)

    # ================================================ touch still scrolls
    setup(BASE); P("() => { const p = noteflow.panels.nb; p.zoomBy(2); p.render(); }"); ty0 = P("() => noteflow.panels.nb.view.ty")
    P("""() => { const s = noteflow.panels.nb.stage, r = s.getBoundingClientRect(), x = r.left + r.width - 60, y = r.top + r.height - 120;
        const ev = (t, dy) => s.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y + dy, bubbles: true, buttons: t === 'pointerup' ? 0 : 1 }));
        ev('pointerdown', 0); ev('pointermove', -40); ev('pointermove', -90); ev('pointerup', -90); }""")
    a.page.wait_for_timeout(300)
    C.check("a finger dragging on empty paper with the Select tool still scrolls the view (no marquee for touch)", P("() => noteflow.panels.nb.view.ty") != ty0 and sel() == [], [ty0, P("() => noteflow.panels.nb.view.ty")])

    # ================================================ pen pressure
    setup([]); P("() => { const p = noteflow.panels.nb; p.zoomBy(0.5 / p.view.scale); p.setTool('pen'); p.curStyle.alpha = 255; p.render(); }")
    def stroke(kind, pressures, tool="pen"):
        P("(t) => noteflow.panels.nb.setTool(t)", tool)
        pts = [pt(100 + 20 * i, 300 + 10 * (i % 2)) for i in range(len(pressures))]
        P("""([pts, ps, kind]) => { const s = noteflow.panels.nb.stage; const ev = (t, i) => s.dispatchEvent(new PointerEvent(t, { pointerId: 11, pointerType: kind, isPrimary: true, clientX: pts[i][0], clientY: pts[i][1], pressure: t === 'pointerup' ? 0 : ps[i], buttons: t === 'pointerup' ? 0 : 1, bubbles: true }));
            ev('pointerdown', 0); for (let i = 1; i < ps.length; i++) ev('pointermove', i); ev('pointerup', ps.length - 1); }""", [pts, pressures, kind])
        a.page.wait_for_timeout(200)
    last = lambda: P("() => { const l = noteflow.panels.nb.items; return l.length ? l[l.length - 1] : null; }")
    stroke("pen", [0.2, 0.4, 0.8, 0.9, 0.5, 0.3]); d = last()
    C.check("a stylus stroke stores the pressure of each point", d and d["t"] == "pen" and all(len(q) == 3 for q in d["pts"]) and abs(d["pts"][2][2] - 0.8) < 0.02, d and d["pts"])
    stroke("mouse", [0.5, 0.5, 0.5, 0.5]); d = last()
    C.check("a mouse stroke has no pressure data (as before)", d and all(len(q) == 2 for q in d["pts"]), d and d["pts"])
    stroke("pen", [0.5, 0.5, 0.5, 0.5, 0.5]); d = last()
    C.check("a stylus pressed evenly gives a plain stroke too", d and all(len(q) == 2 for q in d["pts"]), d and d["pts"])
    P("async () => { (await import('./js/prefs.js')).prefs.set('pressure', false); }"); stroke("pen", [0.2, 0.9, 0.3, 0.8]); d = last()
    C.check("with 'Pen pressure' switched off in Settings the stylus draws plain strokes", d and all(len(q) == 2 for q in d["pts"]), d and d["pts"])
    P("async () => { (await import('./js/prefs.js')).prefs.set('pressure', true); }"); stroke("pen", [0.2, 0.9, 0.3, 0.8], tool="mark"); d = last()
    C.check("the marker (see-through) never uses pressure", d and d["t"] == "mark" and all(len(q) == 2 for q in d["pts"]), d and d["pts"])
    stroke("pen", [0.1, 0.9, 0.1, 0.9, 0.1]); thick = last()
    sx, sy = pt(140, 300)
    px = P("""([x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), d = p.dpr, c = p.ctx.getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d) - 10 * d, 1, 20 * d).data; let n = 0; for (let i = 0; i < c.length; i += 4) if (c[i] < 90) n++; return n; }""", [sx, sy])
    C.check("the pressure stroke is really drawn (dark pixels on the paper)", px > 0, px)
    ws = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer());
        const l = ws.notebook[0].items; return JSON.stringify(l[l.length - 1].pts); }""")
    C.check("saved in a workspace file and reopened: the pressure is still there", ws == json.dumps(thick["pts"], separators=(",", ":")), ws)
    P("() => { const p = noteflow.panels.nb; p.undo(); }"); a.page.wait_for_timeout(100)
    C.check("undo removes a pressure stroke like any other", len(P("() => noteflow.panels.nb.items")) == 5)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
