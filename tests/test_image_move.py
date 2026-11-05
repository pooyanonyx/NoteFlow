"""Dragging an inserted image to another page with the Select tool (real mouse events on the real UI).
The image is stored in the coordinates of its page, so dragging it past the page edge used to leave it outside the page (clipped, invisible, lost). Now it lands on the page it
covers most, with its size / aspect / picture untouched, stays selected, is ONE undo step, and survives save + reopen. The same for images from the regular Image insert and
from the Snipping Tool (both go through Panel.insertImageBlob)."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
W, H = 240, 120

with sync_playwright() as pw:
    a = App(pw, width=1300, height=950)
    P = a.ev

    def setup(n=4, zoom=0.5):
        P("""([n, z]) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook(Array.from({ length: n }, () => ({ paper: 'blank', items: [] })), 'imgmove'); p.setTool('select'); p.zoomBy(z / p.view.scale); p.scrollToPage(0); p.render(); }""", [n, zoom])
        a.page.wait_for_timeout(300)

    def insert(snip=False):
        """Insert an image on the page in view: the regular way, or the way the Snipping Tool does (with the natural size)."""
        P("""async (snip) => { const p = noteflow.panels.nb, c = document.createElement('canvas'); c.width = %d; c.height = %d; const x = c.getContext('2d');
          x.fillStyle = '#1976d2'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#ffeb3b'; x.fillRect(10, 10, 60, 40);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await p.insertImageBlob(blob, snip ? { natural: [%d, %d] } : {}); }""" % (W, H, W, H), snip)
        a.page.wait_for_timeout(250)

    def show(i):
        """Scroll so that page i is at the top of the view (the next page is visible below it) and the Select tool is on."""
        P("(i) => { const p = noteflow.panels.nb; p.setTool('select'); p.scrollToPage(i); p.render(); }", i); a.page.wait_for_timeout(250)

    def images():
        """Every image of the notebook: [page, x1, y1, x2, y2, data length, selected]."""
        return P("""() => { const p = noteflow.panels.nb, out = []; p.pages.forEach((pg, i) => pg.items.forEach((d, k) => { if (d.t === 'image') out.push([i, d.x1, d.y1, d.x2, d.y2, d.data.length, p.cur === i && p.selected === k]); })); return out; }""")

    def screen(i, x, y):
        return P("""([i, x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }""", [i, x, y])

    def center_of(im):
        return ((im[1] + im[3]) / 2, (im[2] + im[4]) / 2)

    def drag(src_page, from_pt, to_page, to_pt, steps=14, hold=0, release=True):
        """Press on a page point, move to a point of another page, release."""
        x0, y0 = screen(src_page, *from_pt); x1, y1 = screen(to_page, *to_pt)
        a.page.mouse.move(x0, y0); a.page.mouse.down()
        a.page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=steps); a.page.mouse.move(x1, y1, steps=steps)
        if hold: a.page.wait_for_timeout(hold)
        if release: a.page.mouse.up()
        a.page.wait_for_timeout(250)

    def same_size(im, ref, tol=0.05):
        return abs((im[3] - im[1]) - (ref[3] - ref[1])) < tol and abs((im[4] - im[2]) - (ref[4] - ref[2])) < tol and im[5] == ref[5]

    def inside(im, w=595, h=842):
        return im[1] >= -0.01 and im[2] >= -0.01 and im[3] <= w + 0.01 and im[4] <= h + 0.01

    # ================================================================ 1. one page -> the next -> back (regular Image insert), zoom 0.5
    setup(5, 0.5); insert()
    im0 = images()[0]; s0 = im0[0]
    C.check("(setup) a regular inserted image is on a page, selected, Select tool on", len(images()) == 1 and im0[6] and 0 < s0 < 4, images())
    show(s0)
    cx, cy = center_of(im0)
    drag(s0, (cx, cy), s0 + 1, (300, 400))
    im1 = images()
    C.check("dragged onto the NEXT page: it is on that page (not outside the first) and nowhere else", len(im1) == 1 and im1[0][0] == s0 + 1, im1)
    C.check("…with its size, aspect ratio and picture unchanged", same_size(im1[0], im0), [im0, im1])
    C.check("…dropped where the pointer left it (its centre at the drop point, inside the page)", abs(center_of(im1[0])[0] - 300) < 1.5 and abs(center_of(im1[0])[1] - 400) < 1.5 and inside(im1[0]), im1)
    C.check("…it is still selected, on the new active page, with the Select tool", im1[0][6] and P("() => noteflow.panels.nb.cur") == s0 + 1 and P("() => noteflow.panels.nb.tool") == "select")
    # still editable: drag it again inside its new page
    cx, cy = center_of(im1[0]); drag(s0 + 1, (cx, cy), s0 + 1, (cx + 60, cy + 40))
    im1b = images()
    C.check("after the move it can be selected and dragged again on its new page", len(im1b) == 1 and im1b[0][0] == s0 + 1 and abs(im1b[0][1] - (im1[0][1] + 60)) < 1.5 and abs(im1b[0][2] - (im1[0][2] + 40)) < 1.5, [im1, im1b])
    # undo: the small drag first, then the move between pages is ONE step back to the old page and place
    P("() => noteflow.panels.nb.undo()"); u1 = images()
    P("() => noteflow.panels.nb.undo()"); u2 = images()
    C.check("Undo: the small drag first; then the move between pages is ONE step, back on the old page at the old place",
            len(u1) == 1 and u1[0][0] == s0 + 1 and len(u2) == 1 and u2[0][0] == s0 and abs(u2[0][1] - im0[1]) < 0.02 and abs(u2[0][2] - im0[2]) < 0.02, [u1, u2])
    P("() => noteflow.panels.nb.redo()")
    C.check("Redo puts it on the next page again", images()[0][0] == s0 + 1, images())
    # and back to the previous page
    show(s0)
    cx, cy = center_of(images()[0]); drag(s0 + 1, (cx, cy), s0, (250, 300))
    im2 = images()
    C.check("from that page back to the PREVIOUS page", len(im2) == 1 and im2[0][0] == s0 and same_size(im2[0], im0) and inside(im2[0]), im2)

    # ================================================================ 2. across several pages at a low zoom, Snipping Tool insert
    setup(5, 0.25); insert(snip=True)
    t0 = images()[0]; s1 = t0[0]; far = s1 + 2 if s1 + 2 < 5 else s1 - 2
    C.check("(setup) an image inserted the way the Snipping Tool does it is a normal image item", len(images()) == 1 and t0[6], t0)
    show(min(s1, far))
    cx, cy = center_of(t0); drag(s1, (cx, cy), far, (300, 420), steps=24)
    r = images()
    C.check("Snipping Tool image: dragged over a page in between onto the page two away, in one drag", len(r) == 1 and r[0][0] == far and same_size(r[0], t0) and inside(r[0]), r)
    cx, cy = center_of(r[0]); drag(far, (cx, cy), s1, (300, 200), steps=24)
    r = images()
    C.check("…and back over the page in between to where it was", len(r) == 1 and r[0][0] == s1 and same_size(r[0], t0) and inside(r[0]), r)

    # ================================================================ 3. page boundaries and corners (zoom 0.5)
    setup(5, 0.5); insert()
    b0 = images()[0]; s2 = b0[0]; w, h = b0[3] - b0[1], b0[4] - b0[2]
    P("""([x, y, w, h]) => { const p = noteflow.panels.nb, it = p.items.findIndex((d) => d.t === 'image');
      p.pages[p.cur].items = p.items.map((e, k) => (k === it ? { ...e, x1: x, y1: y, x2: x + w, y2: y + h } : e)); p.selected = it; p.render(); }""", [595 - w - 5, 842 - h - 5, w, h])    # the bottom-right corner of its page
    show(s2)
    cx, cy = center_of(images()[0])
    drag(s2, (cx, cy), s2, (cx + 5, cy + 5))
    t = images()
    C.check("a small drag in the bottom-right corner keeps the image on its page, fully inside it", len(t) == 1 and t[0][0] == s2 and inside(t[0]), t)
    cx, cy = center_of(t[0]); drag(s2, (cx, cy), s2 + 1, (320, 40))
    t = images()
    C.check("pulled across the bottom boundary so that nearly all of it is over the next page: it moves there, kept inside (not cut off at the top)", len(t) == 1 and t[0][0] == s2 + 1 and inside(t[0]), t)
    show(s2)
    cx, cy = center_of(images()[0]); drag(s2 + 1, (cx, cy), s2, (-60, 40))
    t = images()
    C.check("dragged past the LEFT edge near the top of the previous page: it lands there, fully inside (never lost outside)", len(t) == 1 and t[0][0] == s2 and inside(t[0]) and t[0][1] < 5 and t[0][2] < 5, t)
    C.check("…and its size is still the same", same_size(t[0], b0), [b0, t])

    # ================================================================ 4. a higher zoom: the target page is out of view, so the pages scroll while the pointer is held near the edge
    setup(5, 1.5); insert()
    z0 = images()[0]; cx, cy = center_of(z0)
    sx, sy = screen(z0[0], cx, cy)
    a.page.mouse.move(sx, sy); a.page.mouse.down(); a.page.mouse.move(sx, sy + 40, steps=6)
    ch = P("() => noteflow.panels.nb.stage.getBoundingClientRect().height"); top = P("() => noteflow.panels.nb.stage.getBoundingClientRect().top")
    ty0 = P("() => noteflow.panels.nb.view.ty")
    a.page.mouse.move(sx, top + ch - 6, steps=10)
    a.page.wait_for_timeout(1400)                                            # held at the bottom edge: the pages scroll under the pointer
    ty1 = P("() => noteflow.panels.nb.view.ty")
    a.page.mouse.up(); a.page.wait_for_timeout(300)
    z1 = images()
    C.check("at 150 %: holding the dragged image at the bottom edge scrolls the pages, and the image follows onto a later page", ty1 < ty0 - 200 and len(z1) == 1 and z1[0][0] > z0[0] and inside(z1[0]) and same_size(z1[0], z0), [ty0, ty1, z0, z1])
    C.check("…it is selected there and no copy is left behind", z1[0][6] and len(images()) == 1)

    # ================================================================ 5. save and reopen
    setup(5, 0.5); insert(); a0 = images()[0]; s5 = a0[0]; show(s5); cx, cy = center_of(a0); drag(s5, (cx, cy), s5 + 1, (280, 350))
    a1 = images()
    sv = P("""async () => { const WS = await import('./js/workspace.js'); const grab = () => noteflow.panels.nb.pages.map((pg) => pg.items.filter((d) => d.t === 'image').map((d) => [d.x1, d.y1, d.x2, d.y2, d.data.length]));
      const before = grab(); const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer()); await noteflow.restore(ws); return { before, after: grab() }; }""")
    C.check("saving and reopening the workspace: the moved image is on the same page with the same position, size and picture", len(a1) == 1 and a1[0][0] == s5 + 1 and sv["before"] == sv["after"] and len(sv["after"][s5 + 1]) == 1 and len(sv["after"][s5]) == 0, sv)
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); p.zoomBy(0.5 / p.view.scale); }"); show(s5)       # (the zoom may have been reset by the restore)
    im = images()[0]; cx, cy = center_of(im); drag(s5 + 1, (cx, cy), s5, (300, 300))
    re = images()
    C.check("after reopening it can be selected and moved to the previous page", len(re) == 1 and re[0][0] == s5 and same_size(re[0], a1[0]) and inside(re[0]), re)

    # ================================================================ 6. other items are not affected
    setup(2, 0.5)
    P("""() => { const p = noteflow.panels.nb; p.commit([{ t: 'rect', x1: 100, y1: 100, x2: 220, y2: 180, color: '#d32f2f', w: 3 }]); p.setTool('select'); }""")
    show(0)
    drag(0, (100, 140), 0, (200, 240))                                      # (an unfilled rectangle is grabbed by its edge)
    rect = P("() => noteflow.panels.nb.pages[0].items[0]")
    C.check("a rectangle still moves within its page exactly as before (the change touches images only)", abs(rect["x1"] - 200) < 1.5 and abs(rect["y1"] - 200) < 1.5, rect)
    C.check("no page errors", not a.errors, a.errors)
    sys.exit(0 if C.summary() else 1)
