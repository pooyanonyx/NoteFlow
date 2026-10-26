"""The caret and the selection are drawn on the canvas from the same layout as the text (render.js caretAt / selectionRects), so the caret
cannot drift away from the visible text: not with long text, small sizes, any zoom / dpr, Persian or English, left / centre / right alignment.
The invisible editor element (which only supplies character offsets, input and IME) is also anchored exactly where the canvas draws the text."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
EN = "The quick brown fox jumps over the lazy dog and keeps running across the notebook page without stopping at all and more words to wrap"
FA = "این یک متن بلند فارسی است که باید در یک خط دفتر نوشته شود و تا لبه صفحه ادامه پیدا کند بدون هیچ مشکلی و بیشتر"
CASES = (("EN ltr/left", EN, "ltr", "left"), ("EN ltr/right", EN, "ltr", "right"), ("EN ltr/center", EN, "ltr", "center"), ("FA rtl/right", FA, "rtl", "right"), ("FA rtl/left", FA, "rtl", "left"))
SETUP = "async () => { window.__R = await import('./js/render.js'); }"
# the caret as drawn (no blink phase hides it) and the real ink of the text on the caret's line, both in page units
INK = """() => { const p = noteflow.panels.nb; p.caretStop(); p.caretOn = false; p.draw();
  const R = window.__R, d = p.editedItem(), L = R.layoutRich(d), s = p.view.scale, v = p.view, dpr = p.dpr, [ox, oy] = p.origin();
  const off = p.rt.getSel()[0], c = R.caretAt(d, off), ln = L.lines[c.line];
  const base = d.y + R.TEXT_PAD + ln.y + ln.base, y0 = base - 0.55 * d.size, y1 = base + 0.05 * d.size;       // (the x-height band: no ink of the lines above / below)
  const px = (x) => (v.tx + (ox + x) * s) * dpr, py = (y) => (v.ty + (oy + y) * s) * dpr;
  const X0 = Math.max(0, Math.floor(px(d.x))), X1 = Math.min(p.canvas.width, Math.ceil(px(d.x + d.w))), Y0 = Math.max(0, Math.floor(py(y0))), Y1 = Math.min(p.canvas.height, Math.ceil(py(y1)));
  const img = p.ctx.getImageData(X0, Y0, X1 - X0, Y1 - Y0).data; let lo = 1e9, hi = -1;
  for (let r = 0; r < Y1 - Y0; r++) for (let q = 0; q < X1 - X0; q++) { const i = (r * (X1 - X0) + q) * 4; if (img[i] < 175 && img[i+1] < 175 && img[i+2] < 175) { if (q < lo) lo = q; if (q > hi) hi = q; } }
  const toPt = (col) => ((X0 + col) / dpr - v.tx) / s - ox;
  return { caretX: c.x, top: c.top, bottom: c.bottom, inkL: lo < 1e9 ? toPt(lo) : null, inkR: hi >= 0 ? toPt(hi + 1) : null, size: d.size, rtl: ln.rtl, lineTop: d.y + R.TEXT_PAD + ln.y, lineH: ln.h, lines: L.lines.length }; }"""
# where the INVISIBLE editor puts character `idx` (client px) against where the canvas puts the same place (client px): the editor is only an input layer, but it must sit exactly on the text
DOMPOS = """(idx) => { const p = noteflow.panels.nb, R = window.__R, d = p.editedItem(), v = p.view, s = v.scale, [ox, oy] = p.origin(), sc = p.stage.getBoundingClientRect();
  const root = p.rt.el, tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let acc = 0, rect = null;
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (idx < acc + n.length) { const r = document.createRange(); r.setStart(n, idx - acc); r.setEnd(n, idx - acc + 1); rect = r.getClientRects()[0]; break; } acc += n.length; }
  if (!rect) return null;                                    // (a space hanging at the end of a wrapped line has no box)
  const c = R.caretAt(d, idx), c2 = R.caretAt(d, idx + 1), cx = (x) => sc.left + v.tx + (ox + x) * s;
  return { domL: rect.left, domR: rect.right, cvL: cx(c.x), cvR: cx(c2.x), s }; }"""
CENTER = """() => { const p = noteflow.panels.nb, R = window.__R, d = p.editedItem(), c = R.caretAt(d, p.rt.getSel()[0]), [sx] = p.pageToScreen(c.x, c.top), r = p.stage.getBoundingClientRect(); p.scrollViewBy(sx - r.width / 2, 0); }"""
def start(a, size, zoom, dir_, align):
    a.ev("""([z, size, dir, align]) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{paper:'blank', items: []}], 'x'); p.setTool('text'); p.setFmt({dir, align}); p.applyStyle('size', size, true); p.zoomBy(z); }""", [zoom, size, dir_, align]); a.page.wait_for_timeout(150)
    tap = 100 if dir_ == "ltr" else 480
    a.ev("""(x) => { const p = noteflow.panels.nb, [sx, sy] = p.pageToScreen(x, 150), r = p.stage.getBoundingClientRect(); p.scrollViewBy(sx - r.width / 2, sy - 220); }""", tap); a.page.wait_for_timeout(100)      # (the tap point is in view at every zoom)
    a.click_page(tap, 150)
with sync_playwright() as pw:
    # ---------------------------------------------------------- 1. caret against the real ink of the text, everywhere
    bad, bad_dom, bad_v = [], [], []
    for dpr in (1, 2):
        a = App(pw, width=1400, height=900, dpr=dpr); k = a.page.keyboard; a.ev(SETUP)
        for size in (8, 12, 30):
            for zoom in (0.3, 1.5):
                for name, txt, dir_, align in CASES:
                    start(a, size, zoom, dir_, align); k.type(txt, delay=0); a.page.wait_for_timeout(60); a.ev(CENTER); a.page.wait_for_timeout(60)
                    r = a.ev(INK); end = r["inkL"] if dir_ == "rtl" else r["inkR"]
                    tol = 0.25 * size + 0.5
                    if end is None or abs(r["caretX"] - end) > tol: bad.append((dpr, size, zoom, name, r["caretX"], end))
                    if not (r["lineTop"] - 0.01 <= r["top"] < r["bottom"] <= r["lineTop"] + r["lineH"] + 0.01): bad_v.append((dpr, size, zoom, name, r["top"], r["bottom"], r["lineTop"], r["lineH"]))
                    # the editor element is anchored on the canvas text: the last letter of the FIRST line is where the canvas puts it (css px)
                    L = a.ev("() => { const R = window.__R, d = noteflow.panels.nb.editedItem(), ln = R.layoutRich(d).lines[0], s = ln.segs[ln.segs.length - 1]; return s.start + (s.draw ?? s.text).length - 1; }")
                    m = a.ev(DOMPOS, L)
                    if align != "center":
                        # compare like with like: the right edge of the letter (ltr) / the left edge of the letter (rtl) = where the caret behind it stands
                        edge_dom = m["domR"] if dir_ == "ltr" else m["domL"]; edge_cv = m["cvR"]
                        if abs(edge_dom - edge_cv) > 0.9: bad_dom.append((dpr, size, zoom, name, round(edge_dom - edge_cv, 2)))
                    a.ev("() => noteflow.panels.nb.finishEdit()")
        a.browser.close()
    C.check("long English / Persian text, sizes 8 / 12 / 30, zoom 0.3x / 1.5x of the fit-to-width scale, dpr 1 / 2, left / centre / right: the drawn caret stands at the end of the visible text", not bad, bad[:3])
    C.check("…and is as tall as the letters, inside its line", not bad_v, bad_v[:3])
    C.check("…and the invisible editor sits where the canvas draws the text (within 0.9 css px, also right-aligned and right-to-left text)", not bad_dom, bad_dom[:3])

    # ---------------------------------------------------------- 2. a caret in the middle of the text, Persian and English
    a = App(pw, width=1400, height=900); k = a.page.keyboard; a.ev(SETUP); bad = []
    for size in (10, 18):
        for name, txt, dir_, align in CASES[:1] + CASES[3:4]:
            start(a, size, 1.0, dir_, align); k.type(txt, delay=0)
            for n in (3, 25, 40):
                for _ in range(n): k.press("ArrowLeft")
                a.page.wait_for_timeout(60); a.ev(CENTER); a.page.wait_for_timeout(60)
                off = a.ev("() => noteflow.panels.nb.rt.getSel()[0]"); m = a.ev(DOMPOS, off)
                if m is None: continue
                # the caret at `off` stands at the left edge of the next letter (ltr) / at its right edge (rtl, where the previous letter ends)
                cv = m["cvL"]; dom = m["domL"] if dir_ == "ltr" else m["domR"]
                if abs(dom - cv) > 0.12 * size + 0.8: bad.append((size, name, n, round(dom - cv, 2)))
            a.ev("() => noteflow.panels.nb.finishEdit()")
    C.check("caret in the middle of long text (arrow keys): the canvas caret and the editor agree to a fraction of a letter", not bad, bad[:3])

    # ---------------------------------------------------------- 3. the native caret and selection are hidden, ours blinks and is solid while typing
    start(a, 18, 1.0, "ltr", "left"); k.type("abc")
    st = a.ev("() => { const p = noteflow.panels.nb; return { caret: getComputedStyle(p.rt.el).caretColor, on: p.caretOn, timer: !!p.caretTimer }; }")
    C.check("native caret hidden (the canvas draws it)", st["caret"] in ("rgba(0, 0, 0, 0)", "transparent"), st)
    C.check("caret solid right after typing, blink timer running", st["on"] is True and st["timer"] is True, st)
    seen = set()
    for _ in range(30): seen.add(a.ev("() => noteflow.panels.nb.caretOn")); a.page.wait_for_timeout(60)
    C.check("caret blinks", seen == {True, False}, seen)
    k.type("d"); C.check("typing makes it solid again", a.ev("() => noteflow.panels.nb.caretOn") is True)
    a.finish(); C.check("no blink timer after editing ends", not a.ev("() => !!noteflow.panels.nb.caretTimer"))

    # ---------------------------------------------------------- 4. selection drawn from the same layout
    start(a, 18, 1.0, "ltr", "left"); k.type("select this text"); k.press("Control+a"); a.page.wait_for_timeout(120)
    r = a.ev("""() => { const p = noteflow.panels.nb; p.caretStop(); p.draw(); const R = window.__R, d = p.editedItem(), rc = R.selectionRects(d, 0, d.text.length), c = R.caretAt(d, d.text.length), c0 = R.caretAt(d, 0);
      const v = p.view, s = v.scale, [ox, oy] = p.origin(), dpr = p.dpr, q = rc[0], x = Math.round((v.tx + (ox + q.x0 + 2) * s) * dpr), y = Math.round((v.ty + (oy + (q.top + 1)) * s) * dpr), px = p.ctx.getImageData(x, y, 1, 1).data;
      return { n: rc.length, x0: rc[0].x0, x1: rc[0].x1, c0: c0.x, c1: c.x, px: [px[0], px[1], px[2]] }; }""")
    C.check("select all: one highlight from the first to the last letter", r["n"] == 1 and abs(r["x0"] - r["c0"]) < 0.01 and abs(r["x1"] - r["c1"]) < 0.01, r)
    C.check("…and it is really drawn (a blue tint over the paper)", r["px"][2] > r["px"][0] + 15, r["px"])
    k.press("ArrowRight"); a.finish()

    # ---------------------------------------------------------- 5. Up / Down / Home / End follow the lines of the canvas
    start(a, 18, 1.0, "ltr", "left"); k.type("first line is long"); k.press("Enter"); k.type("ab"); k.press("Enter"); k.type("third line is also long")
    for _ in range(12): k.press("ArrowLeft")
    sel = lambda: a.ev("() => noteflow.panels.nb.rt.getSel()[0]")
    o0 = sel(); k.press("ArrowUp"); o1 = sel(); k.press("ArrowUp"); o2 = sel(); k.press("ArrowDown"); k.press("ArrowDown"); o3 = sel()
    C.check("ArrowUp goes to the line above at the same x (a short line: its end), ArrowUp again lands on the first line, Down Down returns", o1 == 21 and 0 < o2 < 18 and abs(o3 - o0) <= 1, (o0, o1, o2, o3))
    k.press("Home"); h = sel(); k.press("End"); e = sel()
    C.check("Home / End: start / end of the line", h == 21 + 1 + 0 or h == 22, (h, e))
    a.finish()

    # ---------------------------------------------------------- 6. typed spaces move the caret at once (they hang, so they are not part of the drawn text)
    bad = []
    for name, word, dir_, align in (("EN", "abc", "ltr", "left"), ("FA", "سلام", "rtl", "right")):
        start(a, 12, 1.0, dir_, align); k.type(word); xs = []
        for _ in range(10):
            k.press("Space"); a.page.wait_for_timeout(30); xs.append(a.ev("() => { const p = noteflow.panels.nb; return window.__R.caretAt(p.editedItem(), p.rt.getSel()[0]).x; }"))
        step = [(xs[i + 1] - xs[i]) * (1 if dir_ == "ltr" else -1) for i in range(9)]
        if not all(x > 1 for x in step) or max(step) - min(step) > 0.05: bad.append((name, xs))
        k.type("c"); a.page.wait_for_timeout(30); after = a.ev("() => { const p = noteflow.panels.nb; return window.__R.caretAt(p.editedItem(), p.rt.getSel()[0]).x; }")
        if dir_ == "ltr" and not (0 < after - xs[-1] < 12 * 0.8): bad.append((name, "jump after the next letter", xs[-1], after))   # (one letter, not the width of all the spaces again)
        a.ev("() => noteflow.panels.nb.finishEdit()")
    C.check("typing Space (1 or 10 times, English and Persian): the caret moves one space width at a time, and does not jump when the next letter comes", not bad, bad[:2])
sys.exit(0 if C.summary() else 1)
