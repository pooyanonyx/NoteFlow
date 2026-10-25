"""Reset to default (per tool), tool independence + persistence, paper types / settings / right-to-left notebooks."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker, shot
C = Checker()
G = "() => JSON.parse(JSON.stringify(noteflow.panels.nb.groups))"
def pop_btn(a, text="Reset to default"):
    return a.page.locator(".popup button", has_text=text).first
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900)
    base = a.ev(G)
    # ------------------------------------------------------------ reset to default
    a.ev("""() => { const p = noteflow.panels.nb; p.setTool('pen'); p.applyStyle('color', '#ff0000', true); p.applyStyle('width', 9, true); p.applyStyle('alpha', 90, true);
      p.setTool('text'); p.applyStyle('color', '#0000ff', true); p.applyStyle('size', 40, true);
      p.setTool('mark'); p.applyStyle('width', 31, true); p.setTool('pen'); }""")
    g = a.ev(G)
    C.check("every tool keeps its own settings (pen / text / marker do not share)", g["pen"]["color"] == "#ff0000" and g["text"]["color"] == "#0000ff" and g["text"]["width"] == 2 and g["pen"]["size"] == 18 and g["mark"]["width"] == 31, g)
    a.page.get_by_role("button", name="Brush").click(); a.page.wait_for_timeout(150)
    btn = pop_btn(a)
    C.check("Reset to default is in the Brush panel, visible and enabled when something changed", btn.is_visible() and btn.is_enabled())
    btn.click(); a.page.wait_for_timeout(200)
    g2 = a.ev(G)
    C.check("pen: reset to its own defaults (colour, thickness, opacity)", g2["pen"] == base["pen"], g2["pen"])
    C.check("other tools untouched by the pen's reset", g2["text"] == g["text"] and g2["mark"] == g["mark"] and g2["note"] == g["note"] and g2["eraser"] == g["eraser"])
    C.check("the pen in use shows the defaults at once (sliders, colour dot, current style)", a.ev("() => { const p = noteflow.panels.nb; return p.curStyle.width === 2 && p.curStyle.color === '#1a1a1a' && p.colorBtn.querySelector('.cdot').style.background !== ''; }"))
    C.check("button is disabled when the pen is already at its defaults", not pop_btn(a).is_enabled())
    sl = a.ev("() => [...document.querySelectorAll('.popup input[type=range]')].map(s => +s.value)")
    C.check("the sliders in the open panel moved back too", sl[0] == 2 and sl[1] == 100, sl)
    a.page.keyboard.press("Escape"); a.page.mouse.click(5, 450); a.page.wait_for_timeout(100)
    # text tool: only its own settings; recent colours / snap / direction are unrelated preferences
    a.ev("() => { const p = noteflow.panels.nb; p.setSnap(false); p.setFmt({dir:'rtl', align:'right'}); p.setTool('text'); }")
    a.page.get_by_role("button", name="Brush").click(); a.page.wait_for_timeout(150); pop_btn(a).click(); a.page.wait_for_timeout(150)
    s = a.ev("() => { const p = noteflow.panels.nb; return { g: JSON.parse(JSON.stringify(p.groups)), snap: p.snapLines, fmt: p.fmt, recent: p.recent.length }; }")
    C.check("text: reset to its defaults", s["g"]["text"] == base["text"], s["g"]["text"])
    C.check("unrelated preferences (snap to lines, direction, recent colours) are not reset", s["snap"] is False and s["fmt"]["dir"] == "rtl")
    a.ev("() => { const p = noteflow.panels.nb; p.setSnap(true); p.setFmt({dir:'ltr', align:'left'}); }")
    # shapes: shape + fill belong to the tool
    a.ev("""() => { const p = noteflow.panels.nb; p.setTool('shape'); p.shapeKind = 'ellipse'; p.fill.shape = true; p.applyStyle('color', '#00aa00', true); p.applyStyle('width', 7, true);
      p.setTool('node'); p.connStyle = 'elbow'; p.nodeKind = 'rect'; p.fill.mind = true; p.applyStyle('width', 5, true); p.setTool('shape'); }""")
    a.page.get_by_role("button", name="Shapes").click(); a.page.wait_for_timeout(150)
    C.check("Shapes menu has its own Reset to default", pop_btn(a).is_visible())
    pop_btn(a).click(); a.page.wait_for_timeout(200)
    s = a.ev("() => { const p = noteflow.panels.nb; return { g: JSON.parse(JSON.stringify(p.groups)), kind: p.shapeKind, fill: p.fill, conn: p.connStyle, nk: p.nodeKind }; }")
    C.check("shapes: style, shape and fill back to default", s["g"]["shape"] == base["shape"] and s["kind"] == "rect" and s["fill"]["shape"] is False, s)
    C.check("mind map settings are independent of the shapes reset", s["conn"] == "elbow" and s["nk"] == "rect" and s["fill"]["mind"] is True and s["g"]["mind"]["width"] == 5)
    a.ev("() => noteflow.panels.nb.setTool('node')")
    a.page.get_by_role("button", name="Brush").click(); a.page.wait_for_timeout(150); pop_btn(a).click(); a.page.wait_for_timeout(150)
    s = a.ev("() => { const p = noteflow.panels.nb; return { g: JSON.parse(JSON.stringify(p.groups)), conn: p.connStyle, nk: p.nodeKind, fill: p.fill }; }")
    C.check("mind map: style, connector, node shape and fill reset", s["g"]["mind"] == base["mind"] and s["conn"] == "curve" and s["nk"] == "round" and s["fill"]["mind"] is False, s)
    a.ev("() => noteflow.panels.nb.setTool('select')")
    a.page.get_by_role("button", name="Brush").click(); a.page.wait_for_timeout(150)
    C.check("no Reset button for the Select tool (it creates nothing)", a.page.locator(".popup button", has_text="Reset to default").count() == 0)
    a.page.keyboard.press("Escape")
    # a blackboard starts with light ink, so its reset must give light ink (defaults depend on the panel)
    a.ev("async () => { await noteflow.setLayout(['board'], false); }"); a.page.wait_for_timeout(300)
    a.ev("() => { const p = noteflow.panels.board; p.setBoardBg('black'); p.setTool('pen'); p.applyStyle('color', '#ff0000', true); p.resetTool('pen'); }")
    C.check("blackboard: reset gives the blackboard's own default ink", a.ev("() => noteflow.panels.board.groups.pen.color") == "#f2f2f2")
    a.ev("() => { const p = noteflow.panels.board; p.setBoardBg('white'); }")
    C.check("changing the board colour still swaps the default ink for every drawing tool", a.ev("() => { const g = noteflow.panels.board.groups; return [g.pen.color, g.text.color, g.shape.color, g.mind.color]; }") == ["#1a1a1a"] * 4)
    a.ev("async () => { await noteflow.setLayout(['nb'], false); }"); a.page.wait_for_timeout(300)

    # ------------------------------------------------------------ tool settings survive reload (and old workspaces still load)
    a.ev("""() => { const p = noteflow.panels.nb; p.setTool('pen'); p.applyStyle('color', '#123456', true); p.setTool('text'); p.applyStyle('size', 33, true); p.setTool('mark'); p.applyStyle('alpha', 77, true);
      p.setTool('text'); p.setTool('pen'); p.pages[0].items = [{t:'text', x:80, y:100, w:200, text:'keep', color:'#000000', size:18}]; p.dirty = true; noteflow.onChange(p); }""")
    a.ev("async () => { await noteflow.autosave(true); }")
    a.page.reload(); a.page.wait_for_timeout(1500)
    g = a.ev("() => JSON.parse(JSON.stringify(noteflow.panels.nb.groups))")
    C.check("after reload every tool still has its own settings", g["pen"]["color"] == "#123456" and g["text"]["size"] == 33 and g["text"]["color"] != "#123456" and g["mark"]["alpha"] == 77, g["text"])
    C.check("the session items came back too (page by page backup)", a.ev("() => noteflow.panels.nb.pages[0].items.length") == 1)
    legacy = a.ev("""() => { const p = noteflow.panels.nb; p.restoreView({ toolbar: { tool: 'pen', groups: { draw: { color: '#445566', width: 4, size: 20, alpha: 255, bright: 0 } } } }); return JSON.parse(JSON.stringify(p.groups)); }""")
    C.check("an older workspace (one shared 'draw' set) is copied to Pen, Text, Shapes and Mind map", all(legacy[k]["color"] == "#445566" and legacy[k]["width"] == 4 for k in ("pen", "text", "shape", "mind")) and legacy["mark"]["color"] == "#fdd835")

    # ------------------------------------------------------------ paper
    a.ev("() => { const p = noteflow.panels.nb; p.setNotebook([{paper:'lined', items: []}], 'x'); p.zoomBy(0.5); p.setTool('text'); }"); a.page.wait_for_timeout(250)
    opts = a.ev("() => [...noteflow.panels.nb.paper.options].map(o => o.value)")
    C.check("paper choices: blank, lined, grid, dotted, weekly planner, Cornell notes", opts == ["blank", "lined", "grid", "dotted", "weekly", "cornell"], opts)
    def page_hash(a):
        return a.ev("""() => { const p = noteflow.panels.nb, c = p.canvas, im = p.ctx.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < im.length; i += 4 * 7) h = (h * 31 + im[i] + im[i + 1] * 3) >>> 0; return h; }""")
    hashes = {}
    for k in ["blank", "lined", "grid", "dotted", "weekly", "cornell"]:
        a.ev("(k) => noteflow.panels.nb.setPaper(k)", k); a.page.wait_for_timeout(200); hashes[k] = page_hash(a)
    C.check("every paper draws differently", len(set(hashes.values())) == 6, hashes)
    a.ev("() => noteflow.panels.nb.setPaper('lined')"); a.page.wait_for_timeout(150)
    # the Paper popup (real UI)
    a.page.get_by_role("button", name="Paper", exact=True).click(); a.page.wait_for_timeout(200)
    C.check("Paper popup shows direction, margin and spacing controls", a.page.locator(".papermenu").is_visible() and a.page.locator(".papermenu input[type=range]").count() >= 2)
    a.page.locator(".papermenu button", has_text="Right to left").click(); a.page.wait_for_timeout(250)
    pg = a.ev("() => JSON.parse(JSON.stringify(noteflow.panels.nb.pages[0]))")
    C.check("right-to-left page: red margin moves to the right", pg.get("dir") == "rtl" and pg.get("margin") == "right", pg)
    C.check("new text on this page is right-to-left, right-aligned", a.ev("() => noteflow.panels.nb.fmt") == {"dir": "rtl", "align": "right"})
    # the margin line is really drawn on the right
    red = a.ev("""() => { const p = noteflow.panels.nb, v = p.view, s = v.scale, d = p.dpr, [ox, oy] = p.origin(); const row = Math.round((v.ty + (oy + 400) * s) * d);
      const find = (x) => { const px = Math.round((v.tx + (ox + x) * s) * d), im = p.ctx.getImageData(px - 2, row, 5, 1).data; for (let i = 0; i < 5; i++) if (im[i*4] > 200 && im[i*4+1] < 215 && im[i*4+2] < 215 && im[i*4] - im[i*4+1] > 25) return true; return false; };
      return { right: find(595 - 62), left: find(62) }; }""")
    C.check("red margin line is drawn at the right, not the left", red["right"] and not red["left"], red)
    a.page.locator(".papermenu .prow", has_text="Red margin").locator("button", has_text="Left").click(); a.page.wait_for_timeout(200)
    C.check("margin can be put on the left of a right-to-left page", a.ev("() => noteflow.panels.nb.pages[0].margin") == "left")
    a.page.locator(".papermenu .prow", has_text="Red margin").locator("button", has_text="None").click(); a.page.wait_for_timeout(200)
    C.check("margin can be switched off", a.ev("() => noteflow.panels.nb.pages[0].margin") == "none")
    a.page.locator(".papermenu .prow", has_text="Red margin").locator("button", has_text="Right").click(); a.page.wait_for_timeout(200)
    # new text on an RTL page with a right margin stays left of the margin
    a.page.keyboard.press("Escape")
    a.click_page(560, 150); a.page.keyboard.type("متن"); a.finish()
    it = a.items()[-1]
    C.check("new text stays out of the margin (right edge left of the red line)", it["x"] + it["w"] <= 595 - 62 - 5 and it["dir"] == "rtl", (it["x"], it["w"]))
    # line spacing: ruled text follows
    a.ev("() => noteflow.panels.nb.zoomBy(1)")
    a.page.get_by_role("button", name="Paper", exact=True).click(); a.page.wait_for_timeout(200)
    a.ev("""() => { const sl = [...document.querySelectorAll('.papermenu input[type=range]')].find(s => s.getAttribute('aria-label') === 'Line spacing'); sl.value = 32; sl.dispatchEvent(new Event('change', { bubbles: true })); }""")
    a.page.wait_for_timeout(250)
    it = a.items()[-1]; pgd = a.ev("() => noteflow.panels.nb.pages[0].spacing")
    C.check("line spacing 32: the page and its ruled text follow it", pgd == 32 and it.get("rp") == 32 and abs((it["y"] + 4 - 72) % 32) < 1e-6, (pgd, it.get("rp"), it["y"]))
    a.ev("() => noteflow.panels.nb.undo()")
    C.check("changing paper settings is undoable", a.ev("() => noteflow.panels.nb.pages[0].spacing") is None and a.ev("() => noteflow.panels.nb.pages[0].items.at(-1).rp === undefined"))
    a.ev("() => noteflow.panels.nb.redo()")
    # apply to all pages / new pages inherit / reset
    a.ev("() => { const p = noteflow.panels.nb; p.addPage(); p.addPage(); }"); a.page.wait_for_timeout(250)
    C.check("a new page copies the paper settings of the page before it", a.ev("() => noteflow.panels.nb.pages[1].spacing") == 32 and a.ev("() => noteflow.panels.nb.pages[2].dir") == "rtl")
    a.ev("() => noteflow.panels.nb.setPageSettings({ spacing: 20 }, true)"); a.page.wait_for_timeout(150)
    C.check("'apply to all pages' changes every page", a.ev("() => noteflow.panels.nb.pages.map(p => p.spacing)") == [20, 20, 20])
    a.ev("() => noteflow.panels.nb.resetPageSettings(true)"); a.page.wait_for_timeout(150)
    C.check("reset page settings returns to the defaults (24 pt, margin left, LTR)", a.ev("() => noteflow.panels.nb.pages.every(p => p.spacing === undefined && p.dir === undefined && p.margin === undefined)") and a.ev("() => noteflow.panels.nb.pages[0].items.at(-1).rp === undefined"))
    # Cornell + weekly + dotted settings
    a.ev("() => { const p = noteflow.panels.nb; p.setNotebook([{paper:'cornell', items: []}], 'x'); p.setPageSettings({ cue: 200, summary: 90 }); }"); a.page.wait_for_timeout(200)
    C.check("Cornell: cue column and summary height are adjustable", a.ev("() => [noteflow.panels.nb.pages[0].cue, noteflow.panels.nb.pages[0].summary]") == [200, 90])
    a.click_page(300, 140); a.page.keyboard.type("note"); a.finish()
    it = a.items()[-1]
    C.check("Cornell: text goes in the notes area and snaps to its lines", it["x"] >= 208 and it.get("ruled") is True, (it["x"], it.get("ruled")))
    a.ev("() => { const p = noteflow.panels.nb; p.setPaper('weekly'); p.setPageSettings({ week_start: 'sun' }); }"); a.page.wait_for_timeout(150)
    a.ev("() => { const p = noteflow.panels.nb; p.setPaper('dotted'); p.setPageSettings({ spacing: 14 }); }"); a.page.wait_for_timeout(150)
    C.check("dotted spacing is adjustable", a.ev("() => noteflow.panels.nb.pages[0].spacing") == 14)
    # export keeps the page look
    n = a.ev("""async () => { const PDF = await import('./js/pdfio.js'); const p = noteflow.panels.nb; p.setNotebook([{paper:'cornell', items: [], cue: 100, margin: 'right', dir: 'rtl'}, {paper:'weekly', items: []}, {paper:'dotted', items: [], spacing: 15}], 'x');
      const bytes = await PDF.exportNotebookPdf(p.pages); return bytes.length; }""")
    C.check("PDF export of the new papers works", n > 1000, n)
    C.check("no page errors", not a.errors, a.errors)
    sys.exit(0 if C.summary() else 1)
