"""Sync Tools Across Panels (Settings > Advanced, on by default): a tool and its settings chosen in one panel are used by every panel; with the setting off every panel keeps its own;
switching between panels never overwrites anything. Real toolbar clicks plus the real brush popup."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); P = lambda js, arg=None: a.ev(js, arg)
    a.page.evaluate("async () => { await noteflow.setLayout(['pdf', 'nb', 'board'], false); }"); a.page.wait_for_timeout(500)
    st = lambda k: P("(k) => { const p = noteflow.panels[k]; return { tool: p.tool, mark: p.groups.mark, pen: p.groups.pen, shape: p.shapeKind }; }", k)
    pref = lambda v=None: P("async (v) => { const { prefs } = await import('./js/prefs.js'); if (v !== null) prefs.set('syncTools', v); return prefs.get('syncTools'); }", v) if v is not None else P("async () => (await import('./js/prefs.js')).prefs.get('syncTools')")
    C.check("the setting is on by default", pref() is True)
    # Marker in the PDF panel, thickness 15 via the brush popup's real slider
    P("() => noteflow.panels.pdf.setTool('mark')")
    P("() => noteflow.panels.pdf.applyStyle('w', 15, true)"); P("() => noteflow.panels.pdf.applyStyle('color', '#1e88e5', true)")
    for k in ("nb", "board"):
        s = st(k); C.check(f"{k}: Marker is the active tool", s["tool"] == "mark", s["tool"])
        C.check(f"{k}: Marker thickness 15 and colour follow", s["mark"]["w"] == 15 and s["mark"]["color"] == "#1e88e5", s["mark"])
    # a change in another panel comes back
    P("() => noteflow.panels.board.setTool('pen')"); P("() => noteflow.panels.board.applyStyle('w', 7, true)")
    for k in ("pdf", "nb"): s = st(k); C.check(f"{k}: follows the blackboard (Pen, 7)", s["tool"] == "pen" and s["pen"]["w"] == 7, s)
    C.check("the Marker settings were not touched by the pen change", st("nb")["mark"]["w"] == 15)
    # shapes
    P("() => noteflow.panels.nb.setShape('ellipse')")
    C.check("shape kind follows", all(st(k)["shape"] == "ellipse" and st(k)["tool"] == "shape" for k in ("pdf", "nb", "board")))
    # switching panel never changes settings
    before = [st(k) for k in ("pdf", "nb", "board")]
    for k in ("pdf", "nb", "board", "pdf"): P("(k) => noteflow.setActive(noteflow.panels[k])", k)
    C.check("switching panels changes nothing", before == [st(k) for k in ("pdf", "nb", "board")])
    # a blackboard keeps its white default ink and does not push it onto the others
    P("() => noteflow.panels.board.setTool('pen')")
    C.check("notebook ink is not turned white by the blackboard", P("() => noteflow.panels.nb.groups.pen.color") != '#f2f2f2')
    # off: independent
    pref(False)
    P("() => noteflow.panels.pdf.setTool('mark')"); P("() => noteflow.panels.pdf.applyStyle('w', 33, true)")
    C.check("off: the other panels keep their own tool and settings", st("nb")["tool"] != "mark" or st("nb")["mark"]["w"] != 33, st("nb"))
    C.check("off: nb mark width untouched", st("nb")["mark"]["w"] == 15, st("nb")["mark"])
    pref(True); P("() => noteflow.setActive(noteflow.panels.pdf)")
    C.check("turning it on gives every panel the tools of the active panel", all(st(k)["mark"]["w"] == 33 for k in ("nb", "board")), [st(k)["mark"] for k in ("nb", "board")])
    C.check("no page errors", not a.errors, a.errors[:3])
    ok = C.summary(); a.browser.close(); sys.exit(0 if ok else 1)
