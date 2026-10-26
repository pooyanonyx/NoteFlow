"""A line can be filled up to the edge of the page; the caret stays next to the text (the editor and the canvas break lines in the same places)."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
EN = "The quick brown fox jumps over the lazy dog and keeps running across the notebook page without stopping at all"
FA = "این یک متن بلند فارسی است که باید در یک خط دفتر نوشته شود و تا لبه صفحه ادامه پیدا کند بدون هیچ مشکلی"
HARD = {"EN no spaces": "W" * 70, "EN kerning AVAV": "AV" * 28, "FA long word": "نیم" * 22, "FA with ZWNJ": "می\u200cخواهم\u200c" * 8, "URL": "https://example.com/a/very/long/path/with/many/segments/that/never/ends/index.html?x=1"}
# editor lines vs canvas lines, and where the caret is relative to the end of the visible text
MEASURE = """async () => { const R = await import('./js/render.js'); const p = noteflow.panels.nb, d = p.editedItem(), s = p.view.scale, v = p.view, [ox, oy] = p.origin();
  const L = R.layoutRich(d), root = p.rt.el, rects = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) if (q.width > 0) rects.push(q); }
  const rows = []; for (const q of rects) { const row = rows[rows.length - 1]; if (row && q.top < row.bottom - 1) { row.l = Math.min(row.l, q.left); row.r = Math.max(row.r, q.right); row.bottom = Math.max(row.bottom, q.bottom); } else rows.push({ l: q.left, r: q.right, bottom: q.bottom }); }
  const dom = rows.map((r) => +((r.r - r.l) / s).toFixed(1)), cv = L.lines.map((l) => +l.w.toFixed(1));
  const sel = document.getSelection(), r = sel.getRangeAt(0).cloneRange(); r.collapse(true); const q = r.getClientRects()[0] || { left: NaN, top: NaN };
  const sc = p.stage.getBoundingClientRect(), last = L.lines[L.lines.length - 1], inner = R.textInnerWidth(d) || L.width;
  // the visible text of the last line starts / ends here (client px); the caret sits at one of the two ends (which one depends on the direction of the last letters)
  const left = last.rtl ? sc.left + v.tx + (ox + d.x + 4 + inner - last.indent - last.w) * s : sc.left + v.tx + (ox + d.x + 4 + last.indent) * s, right = left + last.w * s;
  const gap = Math.min(Math.abs(q.left - left), Math.abs(q.left - right)) / s;
  return { dom, cv, lines: L.lines.length, domLines: dom.length, gap: +gap.toFixed(2), rtl: last.rtl, w: d.w, x: d.x, size: d.size }; }"""
def start(a, size=18, zoom=1.0, tap=(80, 150)):
    a.ev("""([z, size]) => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{paper:'lined', items: []}], 'x'); p.setTool('text'); p.applyStyle('size', size, true); p.zoomBy(z); }""", [zoom, size]); a.page.wait_for_timeout(200)
    a.click_page(*tap)
def ok_lines(r, tol_em=0.31):
    tol = tol_em * r["size"] + 1.2
    return r["lines"] == r["domLines"] and all(abs(x - y) <= tol for x, y in zip(r["dom"], r["cv"]))
with sync_playwright() as pw:
    # ------------------------------------------------------------------ 1. a ruled line can be filled up to the page edge
    a = App(pw, width=1400, height=900); kb = a.page.keyboard
    a.ev("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(200)
    a.click_page(100, 150); kb.type("x"); a.finish(); it = a.items()[-1]
    C.check("new text box on lined paper reaches the right edge of the page (not a fixed 300)", abs(it["x"] + it["w"] - (595 - 12)) < 0.02 and it["w"] > 450, (it["x"], it["w"]))
    sent = "The quick brown fox jumps over the lazy dog and runs"       # ~440 pt at 18 pt: needs more than a 300 pt box
    a.ev("() => { const p = noteflow.panels.nb; p.pages[0].items = []; }")
    a.click_page(100, 220); kb.type(sent)
    r = a.ev(MEASURE)
    C.check("a long line is written on ONE ruled line before it wraps", r["lines"] == 1 and r["domLines"] == 1, (r["lines"], r["domLines"], r["cv"]))
    kb.type(" " + sent)
    r = a.ev(MEASURE); C.check("…and wraps when the page edge is really reached", r["lines"] == 2 and ok_lines(r), (r["cv"], r["dom"]))
    a.finish()
    a.ev("() => { const p = noteflow.panels.nb; p.pages[0].items = []; }")
    a.click_page(500, 220); kb.type("x"); a.finish(); it = a.items()[-1]
    C.check("tapping near the edge gives a usable box (at least 160 wide, kept on the page)", it["w"] >= 160 and it["x"] + it["w"] <= 583.01, (it["x"], it["w"]))
    a.ev("() => { const p = noteflow.panels.nb; p.pages[0].items = []; p.setPageSettings({ dir: 'rtl' }); }")
    a.click_page(450, 220); kb.type("سلام"); a.finish(); it = a.items()[-1]
    C.check("right-to-left page: the box grows left from the tap, up to the left edge", it["dir"] == "rtl" and abs(it["x"] - 12) < 0.02 and abs(it["x"] + it["w"] - 450) < 1.5, (it["x"], it["w"]))
    a.ev("() => { const p = noteflow.panels.nb; p.pages[0].items = []; p.setPageSettings({ dir: 'ltr', margin: 'left' }); }")
    a.click_page(30, 300); kb.type("x"); a.finish(); it = a.items()[-1]
    C.check("a tap inside the red margin puts the box beside it, filling the writing area", abs(it["x"] - 68) < 0.02 and abs(it["x"] + it["w"] - 583) < 0.02, (it["x"], it["w"]))
    a.ev("() => { const p = noteflow.panels.nb; p.pages[0].items = []; p.setNotebook([{paper:'blank', items: []}], 'x'); p.setTool('text'); }")
    a.click_page(100, 300); kb.type("x"); a.finish(); it = a.items()[-1]
    C.check("blank / other papers too", abs(it["x"] + it["w"] - 583) < 0.02, it)
    a.ev("() => { const p = noteflow.panels.nb; p.setNotebook([{paper:'lined', items: [{ t: 'text', x: 70, y: 116, w: 300, text: 'old box', color: '#000000', size: 18, ruled: true }]}], 'x'); p.setTool('text'); }")
    C.check("existing boxes keep their own width", a.ev("() => noteflow.panels.nb.items[0].w") == 300)

    # --------------------------------------------------- 2. the caret stays next to the text: editor lines == canvas lines
    bad = []
    for dpr in (1, 1.25, 2):
        b = App(pw, width=1300, height=900, dpr=dpr); k = b.page.keyboard
        for zoom in (1.0, 0.6):
            for size in (18, 36):
                for name, txt in (("EN", EN), ("FA", FA)):
                    start(b, size, zoom); k.type(txt, delay=0)
                    r = b.ev(MEASURE)
                    if not ok_lines(r): bad.append((dpr, zoom, size, name, r["domLines"], r["lines"], r["dom"], r["cv"]))
                    if r["gap"] > 1.5: bad.append(("caret", dpr, zoom, size, name, r["gap"]))
                    b.ev("() => noteflow.panels.nb.finishEdit()")
    C.check("long English and Persian text, 18 / 36 pt, zoom 100 % / 60 %, dpr 1 / 1.25 / 2: same lines in editor and canvas, caret at the end of the text", not bad, bad[:3])
    b = App(pw, width=1300, height=900); k = b.page.keyboard
    bad = []
    for name, txt in HARD.items():
        for size in (18, 36):
            start(b, size, 1.0); k.type(txt, delay=0)
            r = b.ev(MEASURE)
            if not ok_lines(r, 0.34): bad.append((name, size, r["domLines"], r["lines"], r["dom"], r["cv"]))
            b.ev("() => noteflow.panels.nb.finishEdit()")
    C.check("text without spaces (kerned pairs, long Persian words, ZWNJ, URLs) breaks in the same place in editor and canvas", not bad, bad[:2])
    # typed letter by letter: the caret never runs ahead of the text (English: at the right end of the line; Persian typed in a left-to-right box: at the left end)
    for name, txt in (("English", EN[:75]), ("Persian", FA[:60])):
        start(b, 18, 1.0); worst = 0
        for ch in txt:
            k.type(ch); r = b.ev(MEASURE)
            if ch != " " and r["gap"] == r["gap"] and r["gap"] > worst: worst = r["gap"]
        C.check(f"typing {name} letter by letter: the caret stays within 1.5 pt of the visible text", worst <= 1.5, worst)
        b.ev("() => noteflow.panels.nb.finishEdit()")
    # formatted text: bold, big and small runs in one line
    start(b, 18, 1.0); k.type("plain "); k.press("Control+b"); k.type("bold words "); k.press("Control+b"); b.ev("() => { noteflow.panels.nb.richCmd('bigger'); noteflow.panels.nb.richCmd('bigger'); }"); k.type("BIGGER ")
    b.ev("() => { noteflow.panels.nb.richCmd('smaller'); noteflow.panels.nb.richCmd('smaller'); noteflow.panels.nb.richCmd('smaller'); noteflow.panels.nb.richCmd('smaller'); }"); k.type("small ones and more words to fill the box up to the edge of the line")
    r = b.ev(MEASURE)
    C.check("mixed bold / big / small text: editor and canvas agree on the lines and the caret", ok_lines(r, 0.6) and r["gap"] <= 1.6, (r["dom"], r["cv"], r["gap"]))
    # zoom while editing keeps them together
    b.ev("() => noteflow.panels.nb.zoomBy(0.5)"); b.page.wait_for_timeout(250); r1 = b.ev(MEASURE)
    b.ev("() => noteflow.panels.nb.zoomBy(2.5)"); b.page.wait_for_timeout(250); r2 = b.ev(MEASURE)
    C.check("zooming while editing: the caret stays at the end of the text", r1["gap"] <= 1.6 and r2["gap"] <= 1.6 and ok_lines(r2, 0.6), (r1["gap"], r2["gap"]))
    b.finish()
    # the editor must not inherit typography from its surroundings (a panel with unsaved changes is styled bold: that used to push the caret ahead of the text)
    start(b, 18, 1.0); k.type("Edit once. ")
    b.finish(); start(b, 18, 1.0, tap=(80, 260)); b.ev("() => { const p = noteflow.panels.nb; p.dirty = true; p.ui(); }")
    C.check("panel with unsaved changes (styled bold by the app): the editor text is still regular weight", b.ev("() => { const p = noteflow.panels.nb; return [p.root.classList.contains('dirty'), getComputedStyle(p.rt.el).fontWeight, getComputedStyle(p.rt.el.querySelector('span') || p.rt.el).fontWeight]; }") == [True, "400", "400"])
    k.type(EN, delay=0); r = b.ev(MEASURE)
    C.check("…and its lines and caret match the canvas", ok_lines(r) and r["gap"] <= 1.5, (r["dom"], r["cv"], r["gap"]))
    b.ev("() => { const s = noteflow.panels.nb.root.style; s.fontWeight = '900'; s.fontStyle = 'italic'; s.letterSpacing = '3px'; s.wordSpacing = '9px'; s.textTransform = 'uppercase'; s.fontVariant = 'small-caps'; s.textIndent = '30px'; }")
    k.type(" and " + EN[:39], delay=0); r = b.ev(MEASURE)
    C.check("even with hostile inherited styles (heavy, italic, letter / word spacing, uppercase, indent) the editor measures like the canvas", ok_lines(r) and r["gap"] <= 1.5, (r["dom"], r["cv"], r["gap"]))
    b.ev("() => { noteflow.panels.nb.root.removeAttribute('style'); }")
    b.finish()
    C.check("the saved box is still on the lines (baselines unchanged)", b.items()[-1]["ruled"] is True)
    C.check("no page errors", not a.errors and not b.errors, (a.errors, b.errors))
    sys.exit(0 if C.summary() else 1)
