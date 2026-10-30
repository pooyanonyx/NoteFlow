"""Formatting while typing: colour, size, bold / italic / underline can be changed at any point of a sentence, from the toolbar, the Colour popup, the
Brush popup (also its sliders and the custom colour dialog), WITHOUT leaving the text: the caret / selection / content stay, the box stays open, typing
goes on exactly where it was; only the selected text (or the text typed from there on) changes. English, Persian and mixed text."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker, shot
import numpy as np
C = Checker()
RED, BLUE = "#d32f2f", "#1976d2"          # PALETTE_ROWS[1][0] / [1][5]
STATE = "() => { const p = noteflow.panels.nb; return { editing: !!p.editing, sel: p.rt.getSel(), away: p.rt.away, focus: document.activeElement === p.rt.el, c: p.rt.getContent(), pending: p.rt.pending }; }"

def runs(a): return [{k: v for k, v in r.items()} for r in (a.ev(STATE)["c"]["runs"] or [])]

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard
    a.ev("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(200)
    colour_btn = a.page.locator('button[title^="Choose a colour"]:visible').first
    brush_btn = a.page.locator('button.btn:has-text("Brush"):visible').first
    def swatch(i): a.page.locator(".popup .sw").nth(i).click(); a.page.wait_for_timeout(120)
    def pick(i): colour_btn.click(); a.page.wait_for_timeout(120); swatch(i)
    def fmt(title): a.page.locator(f'.fmtgrp:visible button[title^="{title}"]').first.click(); a.page.wait_for_timeout(80)

    # ---- 1. colour in the middle of a sentence: only what is typed from there on
    a.click_page(100, 150); kb.type("Hello ")
    before = a.ev(STATE)
    colour_btn.click(); a.page.wait_for_timeout(150)
    mid = a.ev(STATE)
    C.check("opening the Colour popup keeps the box open, the caret and the keyboard in the text", mid["editing"] and mid["sel"] == before["sel"] == [6, 6] and mid["focus"], mid)
    swatch(8)                                                                       # red
    after = a.ev(STATE)
    C.check("picking a colour keeps editing, the caret and the content (nothing is coloured yet)", after["editing"] and after["sel"] == [6, 6] and after["focus"] and after["c"]["text"] == "Hello " and not after["c"]["runs"], after)
    kb.type("world")
    C.check("text typed after the pick is red, the text before is not", runs(a) == [{"s": "Hello "}, {"s": "world", "c": RED}], runs(a))
    pick(13); kb.type("!")                                                          # blue
    kb.press("Space"); pick(8); kb.type("end")
    C.check("changing the colour several times in one sentence gives one run per colour",
            runs(a) == [{"s": "Hello "}, {"s": "world", "c": RED}, {"s": "! ", "c": BLUE}, {"s": "end", "c": RED}], runs(a))
    dot = a.ev("() => noteflow.panels.nb.colorBtn.querySelector('.cdot').style.background")
    C.check("the Colour button shows the colour being typed", "211, 47, 47" in dot, dot)

    # ---- 2. selection: only the selection; selection survives the popup; typing resumes after it
    kb.press("Control+a"); kb.type("Hello world"); a.page.wait_for_timeout(100)
    for _ in range(5): kb.press("Shift+ArrowLeft")
    s0 = a.ev(STATE)["sel"]
    pick(13)
    s1 = a.ev(STATE)
    C.check("a selection stays selected after choosing a colour", s1["sel"] == s0 == [6, 11] and s1["editing"] and s1["focus"], (s0, s1["sel"]))
    C.check("…and only the selected text got the colour", s1["c"]["runs"] == [{"s": "Hello "}, {"s": "world", "c": BLUE}], s1["c"]["runs"])
    kb.press("End"); kb.type("?")
    C.check("typing after the selected word continues in its colour", runs(a)[-1] == {"s": "world?", "c": BLUE}, runs(a))
    # picking the box's own colour = no colour of its own
    for _ in range(6): kb.press("Shift+ArrowLeft")
    colour_btn.click(); a.page.wait_for_timeout(100); a.page.locator(".popup .sw").nth(1).click(); a.page.wait_for_timeout(100)   # #1a1a1a = the box colour
    C.check("choosing the box's own colour removes the run colour", a.ev(STATE)["c"]["runs"] is None, runs(a))

    # ---- 3. size / bold / italic / underline mid sentence, mixed with colour
    kb.press("Control+a"); kb.type("ab"); fmt("Bold"); kb.type("cd"); fmt("Bold"); pick(8); fmt("Bigger"); fmt("Italic"); kb.type("ef"); fmt("Underline"); kb.type("gh")
    r = runs(a)
    C.check("bold / colour / size / italic / underline switched in the middle of the text apply from that point on only",
            r == [{"s": "ab"}, {"s": "cd", "b": 1}, {"s": "ef", "i": 1, "z": 20, "c": RED}, {"s": "gh", "i": 1, "u": 1, "z": 20, "c": RED}], r)
    st = a.ev(STATE)
    C.check("the box stays open the whole time", st["editing"] and st["focus"] and st["sel"] == [8, 8], st)
    a.finish()
    it = a.items()[-1]
    C.check("the box is stored with those runs", it["text"] == "abcdefgh" and it["runs"] == r, it.get("runs"))
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('text'); p.startEdit(p.items.length - 1); }"); a.page.wait_for_timeout(150)
    C.check("re-opening the box shows the same colours / formatting", runs(a) == r and a.ev(STATE)["sel"] == [8, 8], runs(a))
    a.finish()

    # ---- 4. caret moved away: the colour set for the next text does not follow to another place
    a.click_page(100, 300); kb.type("one two"); pick(8)
    kb.press("Home"); kb.type("X")
    C.check("a colour chosen for the next text is dropped when the caret moves elsewhere", runs(a) == [{"s": "Xone two"}] or a.ev(STATE)["c"]["runs"] is None, runs(a))
    a.finish()

    # ---- 5. Brush popup: slider drag keeps the text; size from there on; one undo step; opacity for the box
    a.click_page(100, 380); kb.type("Size "); s0 = a.ev(STATE)["sel"]
    brush_btn.click(); a.page.wait_for_timeout(150)
    sl = a.page.locator(".popup input[type=range]"); size_sl = sl.nth(3); bb = size_sl.bounding_box()
    a.page.mouse.move(bb["x"] + bb["width"] * 0.3, bb["y"] + bb["height"] / 2); a.page.mouse.down()
    a.page.mouse.move(bb["x"] + bb["width"] * 0.35, bb["y"] + bb["height"] / 2, steps=4); a.page.wait_for_timeout(100)
    mid = a.ev(STATE)
    C.check("while a Brush slider is dragged the text stays open with its caret", mid["editing"] and mid["sel"] == s0 and mid["c"]["text"] == "Size ", mid)
    a.page.mouse.move(bb["x"] + bb["width"] * 0.4, bb["y"] + bb["height"] / 2, steps=4); a.page.mouse.up(); a.page.wait_for_timeout(150)
    end = a.ev(STATE)
    C.check("…and after it the keyboard is back in the text", end["focus"] and not end["away"] and end["sel"] == s0, end)
    kb.type("big")
    z = runs(a)[-1].get("z")
    C.check("text typed after the Brush size change has that size, the text before keeps its own", z and z > 30 and runs(a)[0].get("z") is None, runs(a))
    sz_label = a.page.locator(".fmtgrp:visible .sizelbl").first.inner_text()
    C.check("the size label shows the size at the caret", float(sz_label) == z, sz_label)
    for _ in range(3): kb.press("Shift+ArrowLeft")
    bb = size_sl.bounding_box(); n_undo = a.ev("() => noteflow.panels.nb.rt.undoStack.length")
    a.page.mouse.move(bb["x"] + bb["width"] * 0.3, bb["y"] + bb["height"] / 2); a.page.mouse.down()
    a.page.mouse.move(bb["x"] + bb["width"] * 0.2, bb["y"] + bb["height"] / 2, steps=5); a.page.wait_for_timeout(100)
    mid = a.ev(STATE); mz = (mid["c"]["runs"] or [{}])[-1].get("z")
    C.check("dragging a slider with a selection: the selection stays while the slider is dragged and the size follows it live", mid["editing"] and mid["sel"] == [5, 8] and mz and mz < 40, (mid["sel"], mz))
    a.page.mouse.move(bb["x"] + bb["width"] * 0.1, bb["y"] + bb["height"] / 2, steps=5); a.page.mouse.up(); a.page.wait_for_timeout(150)
    C.check("one slider drag is ONE undo step", a.ev("() => noteflow.panels.nb.rt.undoStack.length") == n_undo + 1, (n_undo, a.ev("() => noteflow.panels.nb.rt.undoStack.length")))
    r = runs(a)
    C.check("with a selection the Brush size changes the selected text only", len(r) == 2 and r[-1]["s"] == "big" and r[-1]["z"] < 20 and a.ev(STATE)["sel"] == [5, 8], (r, a.ev(STATE)["sel"]))
    al = sl.nth(1); bb = al.bounding_box(); a.page.mouse.click(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] / 2); a.page.wait_for_timeout(150)
    live = a.ev("() => noteflow.panels.nb.editedItem().alpha")
    C.check("opacity from the Brush acts on the box being typed, live", 100 < live < 150, live)
    kb.press("Escape"); a.page.wait_for_timeout(100)                                 # closes the popup only
    C.check("Escape closes the popup first and the text is still being edited", a.ev(STATE)["editing"] and a.ev(STATE)["focus"])
    a.finish()
    it = a.items()[-1]
    C.check("the opacity is stored with the box", 100 < it["alpha"] < 150, it.get("alpha"))
    a.ev("() => noteflow.panels.nb.resetTool('text')")

    # ---- 6. custom colour dialog (modal, has its own fields)
    a.click_page(100, 460); kb.type("custom "); s0 = a.ev(STATE)["sel"]
    colour_btn.click(); a.page.wait_for_timeout(100)
    a.page.get_by_role("button", name="Custom color").click(); a.page.wait_for_timeout(200)
    C.check("opening the custom colour dialog keeps the text box open", a.ev(STATE)["editing"])
    hexf = a.page.locator(".cdlg input.hex"); hexf.fill("#00796b"); a.page.get_by_role("button", name="OK", exact=True).click(); a.page.wait_for_timeout(200)
    st = a.ev(STATE)
    C.check("…the colour is used from the caret on and the caret is where it was", st["editing"] and st["sel"] == s0 and st["focus"] and st["pending"] == {"c": "#00796b"}, st)
    kb.type("teal")
    C.check("custom colour is applied to the text typed next", runs(a)[-1] == {"s": "teal", "c": "#00796b"}, runs(a))
    colour_btn.click(); a.page.wait_for_timeout(100)
    a.page.get_by_role("button", name="Custom color").click(); a.page.wait_for_timeout(200)
    a.page.get_by_role("button", name="Cancel").click(); a.page.wait_for_timeout(200)
    st = a.ev(STATE)
    C.check("cancelling the dialog also leaves the text exactly as it was", st["editing"] and st["focus"] and st["c"]["text"] == "custom teal", st)

    # ---- 7. undo: a colour change is its own undo step
    kb.press("Control+a"); pick(13); kb.press("Control+z"); a.page.wait_for_timeout(100)
    C.check("Ctrl+Z undoes the colour change only (text stays)", a.ev(STATE)["c"]["text"] == "custom teal" and all(r.get("c") != BLUE for r in runs(a)), runs(a))
    a.finish()

    # ---- 8. leaving the text still works as before
    a.click_page(100, 540); kb.type("leave"); colour_btn.click(); a.page.wait_for_timeout(100)
    a.page.locator('button.tool[aria-label="Pen"]:visible').first.click(); a.page.wait_for_timeout(200)
    C.check("choosing another tool still finishes the text (and stores it)", not a.ev(STATE)["editing"] and a.items()[-1]["text"] == "leave")
    a.ev("() => noteflow.panels.nb.setTool('text')")
    a.click_page(100, 600); kb.type("away"); brush_btn.click(); a.page.wait_for_timeout(100)
    a.page.mouse.click(700, 20); a.page.wait_for_timeout(250)
    C.check("pressing somewhere else finishes the text as before", not a.ev(STATE)["editing"] and a.items()[-1]["text"] == "away")
    a.page.keyboard.press("Escape")

    # ---- 9. select tool: one colour for the whole box again
    idx = [i for i, d in enumerate(a.items()) if d.get("text") == "abcdefgh"][0]
    a.ev("([i]) => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = i; p.syncStyleToSelection(); p.render(); }", [idx]); a.page.wait_for_timeout(100)
    colour_btn.click(); a.page.wait_for_timeout(100); swatch(13)
    d = a.items()[idx]
    C.check("a selected box (not edited) gets ONE colour again: its own, and no colour runs", d["color"] == BLUE and not any(r.get("c") for r in d.get("runs", [])), (d["color"], d.get("runs")))
    a.ev("() => { const p = noteflow.panels.nb; p.selected = null; p.setTool('text'); }")

    # ---- 10. Persian / English / mixed: colours per piece, drawn in those colours, bidi intact
    a.click_page(300, 100); kb.type("سلام "); pick(8); kb.type("دنیا"); pick(13); kb.type(" hello"); pick(9); kb.type(" جهان")
    r = runs(a)
    C.check("Persian + English text with several colours: runs match what was typed",
            [x["s"] for x in r] == ["سلام ", "دنیا", " hello", " جهان"] and [x.get("c") for x in r] == [None, RED, BLUE, "#f57c00"], r)
    a.ev("() => { const p = noteflow.panels.nb; p.render(); }"); a.page.wait_for_timeout(200)
    a.finish(); a.page.wait_for_timeout(300)
    d = a.items()[-1]
    box = a.ev("([x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreen(x, y); return [r.left + sx, r.top + sy]; }", [d["x"], d["y"]])
    img = shot(a, clip={"x": box[0] - 4, "y": box[1] - 4, "width": 420, "height": 70})
    def count(rgb, tol=40): return int((np.abs(img - np.array(rgb)).sum(axis=2) < tol).sum())
    n_red, n_blue, n_or = count((0xd3, 0x2f, 0x2f)), count((0x19, 0x76, 0xd2)), count((0xf5, 0x7c, 0x00))
    C.check("the canvas draws each piece in its own colour (red, blue and orange ink present)", n_red > 8 and n_blue > 8 and n_or > 8, (n_red, n_blue, n_or))
    # reopen, formatting is kept; Persian text typed in the middle keeps the colour of its neighbour
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('text'); p.startEdit(p.items.length - 1); }"); a.page.wait_for_timeout(150)
    a.ev("() => noteflow.panels.nb.rt.setSel(10, 10)"); kb.type("ی"); a.page.wait_for_timeout(100)
    r = runs(a)
    C.check("typing inside a coloured Persian word keeps its colour", any(x.get("c") == RED and "ی" in x["s"] for x in r), r)
    a.finish()
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
