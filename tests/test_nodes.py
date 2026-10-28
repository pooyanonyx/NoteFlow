"""Mind-map nodes: auto-sized to their text (g), drag to draw one, resize by handles without leaving the Node tool (also while its text is typed), + / - text size, connectors
stay attached: the same on the Notebook, the PDF page and the Board."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
SETUP = "async () => { window.__M = await import('./js/model.js'); }"
def node_count(a, P): return a.ev(f"() => noteflow.panels.{P}.items.filter(d => d.t === 'node').length")
def screen(a, P, x, y):
    return a.ev(f"() => {{ const p = noteflow.panels.{P}, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreen({x}, {y}); return [r.left + sx, r.top + sy]; }}")
def tap(a, P, x, y): a.page.mouse.click(*screen(a, P, x, y)); a.page.wait_for_timeout(120)
def drag(a, P, p0, p1, steps=8):
    s0, s1 = screen(a, P, *p0), screen(a, P, *p1); m = a.page.mouse
    m.move(*s0); m.down()
    for i in range(1, steps + 1): m.move(s0[0] + (s1[0] - s0[0]) * i / steps, s0[1] + (s1[1] - s0[1]) * i / steps)
    m.up(); a.page.wait_for_timeout(150)
def node(a, P, i=-1): return a.ev(f"() => {{ const n = noteflow.panels.{P}.items.filter(d => d.t === 'node'); return n.at({i}); }}")
def attached(a, P):
    """every connector starts on the box of its parent node and ends on the box of its child (page units, 3 tolerance)"""
    return a.ev(f"""() => {{ const M = window.__M, p = noteflow.panels.{P}, nodes = M.nodeIndex(p.items), bad = [];
      const dist = (pt, n) => {{ const x0 = Math.min(n.x1, n.x2), x1 = Math.max(n.x1, n.x2), y0 = Math.min(n.y1, n.y2), y1 = Math.max(n.y1, n.y2); const dx = Math.max(x0 - pt[0], 0, pt[0] - x1), dy = Math.max(y0 - pt[1], 0, pt[1] - y1); return Math.hypot(dx, dy); }};
      for (const c of p.items.filter(d => d.t === 'conn')) {{ const g = M.connGeometry(c, nodes); if (!g) {{ bad.push('no geometry'); continue; }}
        const a = nodes.get(c.from), b = nodes.get(c.to), s = g.pts[0], e = g.pts[g.pts.length - 1];
        const ds = Math.min(Math.abs(dist(s, a)), 99), de = dist(e, b); const inside = (pt, n) => dist(pt, n) === 0;
        if (!(ds < 3 || inside(s, a)) || !(de < 3 || inside(e, b))) bad.push([ds, de]); }}
      return bad; }}""")
BASE = {}
def run(a, P, size):
    bx, by = a.ev(f"() => {{ const p = noteflow.panels.{P}, r = p.stage.getBoundingClientRect(); const q = p.screenToPage(r.left + 260, r.top + 190); return [q.x, q.y]; }}"); BASE[P] = (bx, by)
    B = lambda dx, dy: (bx + dx, by + dy)
    # ---- a tapped node is auto-sized to its text; the text size buttons resize it; a connector follows
    a.ev(f"() => {{ const p = noteflow.panels.{P}; p.setTool('node'); }}")
    tap(a, P, *B(0, 0)); a.page.keyboard.type("Idea"); a.page.keyboard.press("Escape"); a.page.wait_for_timeout(150)
    n = node(a, P); C.check(f"{P}: a tapped node is auto-sized to its text", n and n.get("g") is True and n["text"] == "Idea" and n["x2"] - n["x1"] >= 90, n)
    a.ev(f"() => noteflow.panels.{P}.addChild()"); a.page.wait_for_timeout(100); a.page.keyboard.type("Child"); a.page.keyboard.press("Escape"); a.page.wait_for_timeout(150)
    a.ev(f"() => {{ const p = noteflow.panels.{P}; p.selected = p.items.findIndex(d => d.t === 'node' && d.text === 'Idea'); p.render(); p.mindKey = ''; p.updateMindUi(); }}")
    vis = a.ev(f"() => !noteflow.panels.{P}.mindGroup.hidden && !noteflow.panels.{P}.mindBtns.bigger.disabled")
    C.check(f"{P}: the + / - text size buttons are there for a selected node", vis)
    w0 = node(a, P, 0); before = (w0["x2"] - w0["x1"], w0["y2"] - w0["y1"], w0["size"])
    for _ in range(3): a.ev(f"() => noteflow.panels.{P}.mindBtns.bigger.click()"); a.page.wait_for_timeout(60)
    w1 = node(a, P, 0); after = (w1["x2"] - w1["x1"], w1["y2"] - w1["y1"], w1["size"])
    C.check(f"{P}: + makes the text bigger and the auto-sized node follows it (still auto-sized, same corner)", after[2] > before[2] and after[0] >= before[0] and after[1] > before[1] and w1.get("g") is True and abs(w1["x1"] - w0["x1"]) < 0.02, (before, after))
    C.check(f"{P}: the connector stays attached to the resized node", attached(a, P) == [], attached(a, P))
    lbl = a.ev(f"() => noteflow.panels.{P}.nodeSizeLbl.textContent"); C.check(f"{P}: the size label shows the node's text size", lbl == str(round(after[2], 1)).rstrip("0").rstrip("."), (lbl, after))
    for _ in range(3): a.ev(f"() => noteflow.panels.{P}.mindBtns.smaller.click()"); a.page.wait_for_timeout(60)
    w2 = node(a, P, 0); C.check(f"{P}: − shrinks it again", abs(w2["size"] - before[2]) < 0.01 and abs((w2["y2"] - w2["y1"]) - before[1]) < 1.5 and attached(a, P) == [], (before, w2))
    # ---- resize by a handle without leaving the Node tool; the node becomes hand-sized, the connector follows
    a.ev(f"() => {{ const p = noteflow.panels.{P}; p.selected = p.items.findIndex(d => d.t === 'node' && d.text === 'Idea'); p.render(); }}")
    se = a.ev(f"() => {{ const p = noteflow.panels.{P}, d = p.items[p.selected]; return p.selInfo(d, p.selected).pos.se; }}")
    tool_before = a.ev(f"() => noteflow.panels.{P}.tool"); wb = node(a, P, 0)
    drag(a, P, se, (se[0] + 90, se[1] + 50))
    nb = node(a, P, 0)
    C.check(f"{P}: dragging a handle with the Node tool resizes the node (no switch to Select)", a.ev(f"() => noteflow.panels.{P}.tool") == tool_before == "node" and nb["x2"] - nb["x1"] > wb["x2"] - wb["x1"] + 70 and nb["y2"] - nb["y1"] > wb["y2"] - wb["y1"] + 35, (wb, nb))
    C.check(f"{P}: ...it is hand-sized now (no g) and its connector still ends on it", nb.get("g") is None and attached(a, P) == [], (nb, attached(a, P)))
    se = a.ev(f"() => {{ const p = noteflow.panels.{P}, d = p.items[p.selected]; return p.selInfo(d, p.selected).pos.se; }}")
    drag(a, P, se, (se[0] - 400, se[1] - 300))
    nb = node(a, P, 0); need = a.ev(f"() => {{ const R = window.__R, d = noteflow.panels.{P}.items.find(d => d.t === 'node' && d.text === 'Idea'); return R.nodeFitAt(d, d.text, d.x2 - d.x1).h; }}")
    C.check(f"{P}: a node cannot be made smaller than its text (at least 60 wide, high enough for the text)", nb["x2"] - nb["x1"] >= 59.9 and nb["y2"] - nb["y1"] >= need - 0.01 and attached(a, P) == [], (nb, need))
    # a hand-sized node keeps its width when its text size changes (taller only if needed)
    a.ev(f"() => noteflow.panels.{P}.mindBtns.bigger.click()"); a.page.wait_for_timeout(80); nc = node(a, P, 0)
    C.check(f"{P}: a hand-sized node keeps its width when the text gets bigger", abs((nc["x2"] - nc["x1"]) - (nb["x2"] - nb["x1"])) < 0.02 and nc.get("g") is None, (nb, nc))
    # ---- drag on empty space draws a node of that size
    a.ev(f"() => {{ const p = noteflow.panels.{P}; p.selected = null; p.setTool('node'); }}")
    n0 = node_count(a, P); drag(a, P, B(150, 130), B(330, 200)); a.page.keyboard.type("Box"); a.page.keyboard.press("Escape"); a.page.wait_for_timeout(150)
    nd = node(a, P)
    C.check(f"{P}: dragging with the Node tool draws a node of the dragged size", node_count(a, P) == n0 + 1 and nd["text"] == "Box" and abs((nd["x2"] - nd["x1"]) - 180) < 3 and abs((nd["y2"] - nd["y1"]) - 70) < 3 and nd.get("g") is None, nd)
    # ---- the handles are there (and work) while the text is still being typed
    a.ev(f"() => {{ const p = noteflow.panels.{P}; p.selected = null; p.setTool('node'); }}")
    tap(a, P, *B(0, 230)); a.page.keyboard.type("Typing")
    hs = a.ev(f"() => {{ const p = noteflow.panels.{P}, s = p.handleSubject(); return s ? p.selInfo(s.d, s.i).pos.e : null; }}")
    C.check(f"{P}: a node that is being typed has resize handles", hs is not None, hs)
    if hs:
        drag(a, P, hs, (hs[0] + 120, hs[1])); nt = [d for d in a.ev(f"() => noteflow.panels.{P}.items.filter(d => d.t === 'node')") if d["text"] == "Typing"]
        C.check(f"{P}: ...pulling one while typing ends the typing and resizes the node", len(nt) == 1 and nt[0]["x2"] - nt[0]["x1"] > 180 and nt[0].get("g") is None and a.ev(f"() => !noteflow.panels.{P}.editing"), nt)
    # ---- text size while typing a new node
    a.ev(f"() => {{ const p = noteflow.panels.{P}; p.selected = null; p.setTool('node'); }}")
    tap(a, P, *B(330, 0)); a.page.keyboard.type("Live"); s0 = a.ev(f"() => noteflow.panels.{P}.editing.proto.size")
    a.ev(f"() => noteflow.panels.{P}.mindBtns.bigger.click()"); a.page.wait_for_timeout(80); s1 = a.ev(f"() => noteflow.panels.{P}.editing.proto.size")
    a.page.keyboard.press("Escape"); a.page.wait_for_timeout(120); nl = node(a, P)
    C.check(f"{P}: + while typing a new node changes its text size at once", s1 > s0 and nl["size"] == s1 and nl["text"] == "Live" and nl["g"] is True, (s0, s1, nl))
    C.check(f"{P}: all connectors still attached at the end", attached(a, P) == [], attached(a, P))
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard; a.ev(SETUP); a.ev("async () => { window.__R = await import('./js/render.js'); }")
    a.ev("() => noteflow.panels.nb.zoomBy(0.6)"); a.page.wait_for_timeout(150); run(a, "nb", 18)
    a.ev("""async () => { const PDF = await import('./js/pdfio.js'); const bytes = await PDF.exportNotebookPdf([{ paper: 'blank', items: [] }]); await noteflow.setLayout(['pdf'], false); await noteflow.panels.pdf.openPdfBytes(bytes, 'test.pdf'); }"""); a.page.wait_for_timeout(500)
    a.ev("() => noteflow.panels.pdf.zoomBy(0.6)"); a.page.wait_for_timeout(150); run(a, "pdf", 18)
    a.ev("async () => { await noteflow.setLayout(['board'], false); }"); a.page.wait_for_timeout(400)
    run(a, "board", 18)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
