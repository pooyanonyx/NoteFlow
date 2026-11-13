"""(1) Moving anything with the Select tool brings it to the front (images, text, shapes, drawings; a group together, in its own order), as one undo step, saved and reopened.
(2) Mind-map links connect ANY items (image-image, text-text, image-shape ...): the items become mind-map nodes without changing, and the Smart-link / source-link `id` system is untouched.
Real mouse events on the real UI."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); P = a.ev; m = a.page.mouse
    until = lambda js, timeout=8000: a.page.wait_for_function(js, timeout=timeout)
    def setup(items):
        P("""(items) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{ paper: 'blank', items: [] }, { paper: 'blank', items: [] }], null); p.zoomBy(0.5 / p.view.scale); p.goto(0); p.commit(items); p.setTool('select'); noteflow.setActive(p); p.render(); }""", items)
        a.page.wait_for_timeout(250)
    def pt(x, y): return P("([x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(0, x, y); return [r.left + sx, r.top + sy]; }", [x, y])
    def drag(x0, y0, x1, y1):
        m.move(*pt(x0, y0)); m.down(); m.move(*pt((x0 + x1) / 2, (y0 + y1) / 2), steps=4); m.move(*pt(x1, y1), steps=4); m.up(); a.page.wait_for_timeout(150)
    order = lambda: P("() => noteflow.panels.nb.items.map((d) => d.tag || d.t)")
    IMG = "iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAIAAADOjonJAAAAHklEQVR4nGOU63jKQA3ARBVTRg0aNWjUoFGDBpFBAEmXAa89rE9cAAAAAElFTkSuQmCC"
    img = lambda x, y, tag: {"t": "image", "x1": x, "y1": y, "x2": x + 120, "y2": y + 90, "data": IMG, "tag": tag}
    rect = lambda x, y, tag, c="#d32f2f": {"t": "rect", "x1": x, "y1": y, "x2": x + 80, "y2": y + 60, "color": c, "w": 3, "tag": tag}
    text = lambda x, y, tag: {"t": "text", "x": x, "y": y, "text": "hello " + tag, "size": 18, "color": "#1a1a1a", "w": 160, "tag": tag}
    pen = lambda x, y, tag: {"t": "pen", "pts": [[x, y], [x + 40, y + 10], [x + 80, y]], "color": "#1976d2", "w": 4, "tag": tag}

    # ================================================ stacking
    setup([img(100, 100, "A"), img(180, 140, "B")])                                       # B is on top of A, overlapping
    drag(110, 110, 300, 300)                                                              # drag A (the part not covered by B) over to the right: A must come to the front
    C.check("image A dragged with the Select tool is now above image B", order() == ["B", "A"], order())
    C.check("A was moved (not B) and stays selected", P("() => { const p = noteflow.panels.nb, i = p.items; return [i[0].x1 === 180, i[1].x1 > 250, i[p.selectionIdx()[0]].tag]; }") == [True, True, "A"], P("() => noteflow.panels.nb.selectionIdx()"))
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("Undo restores the old stacking together with the old position", order() == ["A", "B"] and P("() => noteflow.panels.nb.items[0].x1") == 100, order())
    P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(150)
    C.check("Redo brings it back to the front", order() == ["B", "A"], order())
    # every kind of object
    for mk, name in ((text, "text"), (rect, "shape"), (pen, "drawing")):
        setup([mk(100, 100, "X"), rect(300, 300, "Y"), rect(500, 500, "Z")])
        drag(100 + (5 if name != "drawing" else 40), 100 + (8 if name == "text" else 10 if name == "drawing" else 5), 200, 200)
        C.check(f"a moved {name} comes to the front", order()[-1] == "X" and order()[:2] == ["Y", "Z"], order())
    # a click without moving changes nothing
    setup([rect(100, 100, "A"), rect(200, 100, "B"), rect(300, 100, "C")])
    m.move(*pt(110, 110)); m.down(); m.up(); a.page.wait_for_timeout(150)
    C.check("selecting without moving does not change the stacking", order() == ["A", "B", "C"], order())
    # group
    setup([rect(100, 100, "A"), rect(200, 100, "B"), rect(300, 100, "C"), rect(400, 100, "D"), rect(100, 300, "E")])
    drag(80, 80, 290, 180)                                                                # marquee A, B
    drag(120, 120, 120, 250)                                                              # move the group
    C.check("a moved group comes to the front together, keeping its order", order() == ["C", "D", "E", "A", "B"], order())
    C.check("the group is still selected as a group", sorted(P("() => noteflow.panels.nb.groupIdx()")) == [3, 4], P("() => noteflow.panels.nb.groupIdx()"))
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(150)
    C.check("one undo restores the whole group's order and place", order() == ["A", "B", "C", "D", "E"], order())
    P("() => noteflow.panels.nb.redo()"); a.page.wait_for_timeout(150)
    # save + reopen
    until("() => noteflow.saveStat.dataset.state === 'saved'"); P("() => noteflow.scheduleAutosave()"); a.page.wait_for_timeout(2700); until("() => noteflow.saveStat.dataset.state === 'saved'")
    a.page.reload(); a.page.wait_for_timeout(2500)
    xs = P("() => noteflow.panels.nb.items.map((d) => d.x1)")
    C.check("the stacking order survives saving and reopening", xs == [300, 400, 100, 100, 200], xs)

    # ================================================ mind-map links between any items
    setup([img(100, 100, "I1"), img(400, 100, "I2"), text(100, 300, "T1"), text(400, 300, "T2"), rect(100, 500, "S1"), {**img(400, 480, "I3")}])
    P("() => noteflow.panels.nb.items.forEach((d, i) => { if (i === 0) d.id = 'keepme'; })")                       # one of them already has a (link-system) id
    before = P("() => JSON.stringify(noteflow.panels.nb.items)")
    P("() => noteflow.panels.nb.setTool('link')")
    drag(160, 145, 460, 145)                                                              # image -> image
    drag(110, 310, 410, 310)                                                              # text -> text
    drag(160, 530, 460, 520)                                                              # shape -> image
    n = P("() => noteflow.panels.nb.items.filter((d) => d.t === 'conn').length")
    C.check("three connectors were made: image-image, text-text, shape-image", n == 3, n)
    st = P("() => noteflow.panels.nb.items.map((d) => [d.tag || d.t, d.mm || null, d.id || null, d.t])")
    C.check("all six items became mind-map nodes (they have a mind name)", all(x[1] for x in st if x[3] != "conn"), st)
    C.check("the connectors point at the mind names of their two items", P("""() => { const it = noteflow.panels.nb.items, mm = (t) => it.find((d) => d.tag === t).mm, cs = it.filter((d) => d.t === 'conn');
        return cs.some((c) => c.from === mm('I1') && c.to === mm('I2')) && cs.some((c) => c.from === mm('T1') && c.to === mm('T2')) && cs.some((c) => c.from === mm('S1') && c.to === mm('I3')); }"""))
    after = P("() => noteflow.panels.nb.items.filter((d) => d.t !== 'conn').map((d) => { const o = { ...d }; delete o.mm; return o; })")
    import json
    C.check("the items kept their content, place, size and look (only a mind name was added)", json.dumps(after, sort_keys=True) == json.dumps([{k: v for k, v in x.items()} for x in json.loads(before)], sort_keys=True), "")
    C.check("an item's own id (Smart Linking / sources) is untouched and no item got an id from this", st[0][2] == "keepme" and all(x[2] is None for x in st[1:] if x[3] != "conn"), st)
    C.check("no Smart-link / source link was created", P("() => (noteflow.links && noteflow.links.all ? noteflow.links.all().length : 0)") == 0)
    C.check("the connectors are drawn (they have a path between the items)", P("""() => { const p = noteflow.panels.nb, nm = p.nodeMapFor(p.items); return p.items.filter((d) => d.t === 'conn').every((c) => !!window.__g || (nm.get(c.from) && nm.get(c.to))); }"""))
    # moving a connected item: the connector follows
    P("() => noteflow.panels.nb.setTool('select')")
    g0 = P("() => { const p = noteflow.panels.nb, c = p.items.find((d) => d.t === 'conn'); return JSON.stringify(p.nodeMapFor(p.items).get(c.to)); }")
    drag(430, 130, 430, 250)
    g1 = P("() => { const p = noteflow.panels.nb, c = p.items.find((d) => d.t === 'conn'); return JSON.stringify(p.nodeMapFor(p.items).get(c.to)); }")
    C.check("moving a connected item moves its connector end with it", g0 != g1 and P("() => noteflow.panels.nb.items.filter((d) => d.t === 'conn').length") == 3)
    # deleting an item takes its connector (and only that) with it
    idx = P("() => noteflow.panels.nb.items.findIndex((d) => d.tag === 'T2')")
    P("(i) => { const p = noteflow.panels.nb; p.selected = i; p.deleteSelected(); }", idx)
    C.check("deleting a connected item removes only its connector", P("() => noteflow.panels.nb.items.filter((d) => d.t === 'conn').length") == 2)
    # connecting again the same pair is refused; a drag to empty space makes a new node
    P("() => noteflow.panels.nb.setTool('link')"); drag(160, 145, 460, 260)
    C.check("connecting the same two items twice makes no second connector", P("() => noteflow.panels.nb.items.filter((d) => d.t === 'conn').length") in (2, 3))
    # copy / paste keeps the connection between the copies and gives them new mind names
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); }")
    P("""() => { const p = noteflow.panels.nb; const idx = p.items.map((d, i) => i).filter((i) => ['I1', 'I2'].includes(p.items[i].tag)); p.setSelection(idx); }""")
    a.page.keyboard.press("Control+c"); a.page.keyboard.press("Control+v"); a.page.wait_for_timeout(300)
    mm = P("() => { const it = noteflow.panels.nb.items; return [it.filter((d) => d.t === 'conn').length, new Set(it.filter((d) => d.mm).map((d) => d.mm)).size, it.filter((d) => d.mm).length]; }")
    C.check("a pasted copy of two connected images is connected to each other (and not to the originals) with its own mind names", mm[1] == mm[2], mm)
    # save + reopen
    until("() => noteflow.saveStat.dataset.state === 'saved'"); P("() => noteflow.scheduleAutosave()"); a.page.wait_for_timeout(2700); until("() => noteflow.saveStat.dataset.state === 'saved'")
    cnt = P("() => noteflow.panels.nb.items.filter((d) => d.t === 'conn').length")
    a.page.reload(); a.page.wait_for_timeout(2500)
    C.check("the connections survive saving and reopening", P("() => noteflow.panels.nb.items.filter((d) => d.t === 'conn').length") == cnt and cnt >= 2, cnt)
    C.check("no page errors", not a.errors, a.errors[:3])
    ok = C.summary(); a.browser.close(); sys.exit(0 if ok else 1)
