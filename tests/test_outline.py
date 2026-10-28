"""The outline of the text being edited follows every wrap at once: it is drawn on the canvas from the layout of the text (same frame), and the editor element has exactly the box's size."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
EN = "The quick brown fox jumps over the lazy dog and keeps running across the whole page without stopping "
FA = "این یک متن بلند فارسی است که باید در یک خط دفتر نوشته شود و تا لبه صفحه ادامه پیدا کند بدون هیچ مشکلی "
SETUP = "async () => { window.__R = await import('./js/render.js'); }"
# editor element vs canvas box (client px), and the pixels of the drawn outline at the middle of the bottom edge and just below it
Q = """() => { const R = window.__R, p = noteflow.panels.nb; p.caretStop(); p.caretOn = false; p.draw();   // (the caret is accent coloured too)
   const d = p.editedItem(), v = p.view, s = v.scale, [ox, oy] = p.origin(), sc = p.stage.getBoundingClientRect(), b = R.textBox(d), e = p.rt.el.getBoundingClientRect(), dpr = p.dpr;
  // how many pixels of a strip (a screen row, 60 px wide, centred on the box) are accent coloured: on the bottom edge (dashed: some), 5 px below it and 5 px inside it (none)
  const strip = (y) => { const W = Math.max(4, Math.min(60, Math.floor((b[2] - b[0]) * s * dpr) - 14)), X = Math.round((v.tx + (ox + (b[0] + b[2]) / 2) * s) * dpr) - W / 2, Y = Math.round((v.ty + (oy + y) * s) * dpr); const im = p.ctx.getImageData(Math.max(0, X), Y, W, 1).data;   // (a strip inside the box's width: never on its vertical edges)
   let n = 0; for (let i = 0; i < im.length; i += 4) if (im[i + 2] > im[i] + 25 && im[i + 2] > 120) n++; return n; };
  const eg = (y) => Math.max(strip(y - 1 / s), strip(y), strip(y + 1 / s));
  return { dw: (e.width - 3) / s - (b[2] - b[0]), dh: (e.height - 3) / s - (b[3] - b[1]), dl: (e.left + 1.5 - sc.left - v.tx) / s - ox - b[0], dt: (e.top + 1.5 - sc.top - v.ty) / s - oy - b[1], onEdge: eg(b[3] + 0.75 / s), below: strip(b[3] + 6 / s), inside: strip(b[3] - 6 / s), top: eg(b[1] - 0.75 / s), topVis: (v.ty + (oy + b[1]) * s) * dpr > 2, botVis: (v.ty + (oy + b[3]) * s) * dpr < p.canvas.height - 8, lines: R.layoutRich(d).lines.length }; }"""
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard; a.ev(SETUP); a.ev("() => noteflow.panels.nb.zoomBy(0.5)")
    for name, txt, dir_, align, size, tap in (("EN 16", EN, "ltr", "left", 16, 100), ("EN 8", EN, "ltr", "left", 8, 100), ("EN 36", EN, "ltr", "left", 36, 100), ("FA 16", FA, "rtl", "right", 16, 480), ("FA 10", FA, "rtl", "right", 10, 480), ("EN centre", EN, "ltr", "center", 16, 300)):
        a.ev("""([dir, align, size]) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{paper:'blank', items: []}], 'x'); p.setTool('text'); p.setFmt({dir, align}); p.applyStyle('size', size, true); }""", [dir_, align, size]); a.page.wait_for_timeout(100)
        a.click_page(tap, 150); bad = []; seen = set()
        for i, ch in enumerate(txt * 2):
            kb.type(ch)
            if i % 3 and ch != " ": continue
            a.page.wait_for_timeout(20); r = a.ev(Q); seen.add(r["lines"])
            if max(abs(r["dw"]), abs(r["dh"]), abs(r["dl"]), abs(r["dt"])) > 1.0: bad.append(("element != box", i, {k: round(r[k], 2) for k in ("dw", "dh", "dl", "dt")}))
            if (r["botVis"] and (r["onEdge"] < 2 or r["below"] or r["inside"])) or (r["topVis"] and r["top"] < 2): bad.append(("outline not on the box edge", i, r["onEdge"], r["top"], r["below"], r["inside"]))
        C.check(f"{name}: through every wrap ({sorted(seen)} lines) the outline is on the edge of the text box and the editor element has its size", not bad and len(seen) >= 2, bad[:3])
        a.finish()
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
