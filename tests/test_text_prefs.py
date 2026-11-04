"""Tool settings and text formatting are PERSISTENT PREFERENCES: what the user chooses (also while typing) stays chosen until they choose again or press Reset to default.
Deleting text, Backspace, moving the caret, finishing an edit, creating another box and switching tools never bring the old value back; text that already exists is not changed
by a new choice (only the selection, when there is one); new boxes and newly typed text use the latest settings. English, Persian, mixed formatting, several boxes."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
RED, BLUE, ORANGE, DARK = "#d32f2f", "#1976d2", "#f57c00", "#1a1a1a"

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard
    P = lambda js, arg=None: a.ev(js, arg)
    P("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(200)
    colour_btn = a.page.locator('button[title^="Choose a colour"]:visible').first
    brush_btn = a.page.locator('button.btn:has-text("Brush"):visible').first
    def pick(i): colour_btn.click(); a.page.wait_for_timeout(120); a.page.locator(".popup .sw").nth(i).click(); a.page.wait_for_timeout(120)
    def fmt(title): a.page.locator(f'.fmtgrp:visible button[title^="{title}"]').first.click(); a.page.wait_for_timeout(80)
    def reset(): P("() => { const p = noteflow.panels.nb; p.resetTool('text'); }")
    def clear(): P("() => { const p = noteflow.panels.nb; p.pages[p.cur].items = []; p.selected = null; p.setTool('text'); p.render(); }")
    def tp(): return P("() => { const p = noteflow.panels.nb; return { g: p.groups.text, ts: p.textStyle, cur: p.curStyle }; }")
    def boxes(): return [d for d in a.items() if d.get("t") == "text"]
    def runs(): return P("() => noteflow.panels.nb.rt.getContent().runs")
    def new_box(y, text=None):
        a.click_page(100, y)
        if text: kb.type(text)

    # ================================================================= colour
    clear(); reset()
    new_box(150, "Hello "); pick(8); kb.type("world")
    kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.type("X")
    C.check("colour changed mid-sentence; after deleting what was typed in it, new text is still in that colour (Backspace does not reset it)", runs() == [{"s": "Hello "}, {"s": "X", "c": RED}], runs())
    kb.press("Home"); kb.type(">"); kb.press("End"); kb.type("!")
    C.check("moving the caret around does not reset it either", runs() == [{"s": ">", "c": RED}, {"s": "Hello "}, {"s": "X!", "c": RED}], runs())
    a.finish()
    C.check("finishing the edit keeps it as the Text tool's colour", tp()["g"]["color"] == RED and tp()["cur"]["color"] == RED)
    new_box(250, "second"); a.finish()
    b2 = [d for d in boxes() if d["text"] == "second"][0]
    C.check("the next text box is created in that colour", b2["color"] == RED and not b2.get("runs"), (b2["color"], b2.get("runs")))
    first = [d for d in boxes() if d["text"].startswith(">")][0]
    C.check("the first box is untouched by creating the second", first["runs"] == [{"s": ">", "c": RED}, {"s": "Hello "}, {"s": "X!", "c": RED}], first.get("runs"))
    pick(13)
    C.check("choosing a colour with no box open sets the same setting", tp()["g"]["color"] == BLUE)
    new_box(350, "third"); a.finish()
    C.check("…and the next box uses it; the older boxes keep theirs", [d for d in boxes() if d["text"] == "third"][0]["color"] == BLUE and [d for d in boxes() if d["text"] == "second"][0]["color"] == RED)

    # ================================================================= size
    clear(); reset()
    new_box(150, "a"); fmt("Bigger"); fmt("Bigger"); kb.type("bc"); kb.press("Backspace"); kb.press("Backspace"); kb.type("d")
    sz = tp()["g"]["size"]; r = runs()
    C.check("Bigger twice while typing: the size is the tool's setting, the text typed after it (also after deleting) has it, the text before does not", sz > 18 and r == [{"s": "a"}, {"s": "d", "z": sz}], (sz, r))
    a.finish(); new_box(250, "e"); a.finish()
    C.check("the next box has that size", [d for d in boxes() if d["text"] == "e"][0]["size"] == sz and tp()["cur"]["size"] == sz)
    P("() => noteflow.panels.nb.setTool('pen')"); P("() => noteflow.panels.nb.setTool('text')")
    C.check("switching tools does not change it", tp()["g"]["size"] == sz)
    fmt("Smaller")
    C.check("changing the size with no box open also changes the setting", tp()["g"]["size"] < sz)

    # ================================================================= bold / italic / underline (also Ctrl+B)
    clear(); reset()
    new_box(150); kb.press("Control+b"); kb.type("bold"); kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.type("again")
    C.check("Ctrl+B while typing, then deleting everything and typing again: still bold", runs() == [{"s": "again", "b": 1}] and tp()["ts"]["b"] is True, runs())
    fmt("Italic"); fmt("Underline"); kb.type(" more")
    C.check("italic + underline added later: from there on", runs() == [{"s": "again", "b": 1}, {"s": " more", "b": 1, "i": 1, "u": 1}], runs())
    a.finish(); new_box(250, "next"); a.finish()
    nb_ = [d for d in boxes() if d["text"] == "next"][0]
    C.check("a new box starts bold + italic + underlined (the settings)", nb_["runs"] == [{"s": "next", "b": 1, "i": 1, "u": 1}], nb_.get("runs"))
    new_box(350); kb.press("Control+b"); kb.type("plain?")
    C.check("switching Bold OFF while typing is a persistent choice too", runs() == [{"s": "plain?", "i": 1, "u": 1}] and tp()["ts"]["b"] is False, runs())
    a.finish()
    old = [d for d in boxes() if d["text"] == "next"][0]
    C.check("boxes that already existed are not changed by it", old["runs"] == [{"s": "next", "b": 1, "i": 1, "u": 1}])

    # ================================================================= several boxes, tool switching
    clear(); reset()
    pick(8); fmt("Bigger"); fmt("Bold")
    pen0 = P("() => noteflow.panels.nb.groups.pen.color")
    for t in ["pen", "mark", "eraser", "select", "pen", "text", "shape", "select", "text"]:
        P("([t]) => noteflow.panels.nb.setTool(t)", [t]); a.page.wait_for_timeout(30)
    st = tp()
    C.check("repeated tool switching keeps every text setting", st["g"]["color"] == RED and st["g"]["size"] > 18 and st["ts"]["b"] is True, st)
    P("() => noteflow.panels.nb.setTool('pen')"); pick(13)
    C.check("a setting of another tool (the pen's colour) is its own: the Text tool's does not change", P("() => noteflow.panels.nb.groups.pen.color") == BLUE and tp()["g"]["color"] == RED and pen0 != BLUE)
    P("() => noteflow.panels.nb.setTool('text')")
    new_box(150, "one"); a.finish(); new_box(250, "two"); P("() => noteflow.panels.nb.setTool('select')"); P("() => noteflow.panels.nb.setTool('text')"); kb.type(" plus"); a.finish()
    bs = boxes()
    C.check("several boxes in a row all come out in the settings (colour, size, bold)", len(bs) == 2 and all(d["color"] == RED and d["size"] > 18 and d["runs"][0].get("b") == 1 for d in bs), [(d["text"], d["color"], d["size"]) for d in bs])

    # ================================================================= existing boxes
    clear(); reset()
    P("""() => { const p = noteflow.panels.nb; p.commit([{ t: 'text', x: 60, y: 100, text: 'old', color: '#d32f2f', size: 30, runs: [{ s: 'old', b: 1 }] }]); }""")
    P("() => { const p = noteflow.panels.nb; p.setTool('text'); p.startEdit(0); }"); a.page.wait_for_timeout(150); kb.press("End"); kb.type(" new"); a.finish()
    d = boxes()[0]
    C.check("typing in an existing box: the old text keeps its formatting; the new text is in the current settings (not copied from the old text)",
            d["runs"][0] == {"s": "old", "b": 1} and d["runs"][-1]["s"] == " new" and d["runs"][-1].get("z") == 18 and d["runs"][-1].get("c") == DARK and not d["runs"][-1].get("b"), d["runs"])
    P("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = 0; p.syncStyleToSelection && p.syncStyleToSelection(); p.render(); }")
    before = tp(); fmt("Bold"); a.page.wait_for_timeout(100); after = tp()
    C.check("formatting a SELECTED existing box (Select tool) changes that box only: the Text tool's settings stay as they were", before["ts"] == after["ts"] and before["g"]["color"] == after["g"]["color"] and before["g"]["size"] == after["g"]["size"], (before["ts"], after["ts"]))

    # ================================================================= Persian + English, mixed formatting
    clear(); reset()
    new_box(150, "سلام "); fmt("Bold"); pick(8); kb.type("دنیا"); kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.press("Backspace"); kb.type("جهان")
    fmt("Italic"); kb.type(" hello"); kb.press("Backspace"); kb.press("Backspace"); kb.type("lo")
    r = runs()
    C.check("Persian + English with colour, bold and italic changed and deleted several times: plain Persian first, then bold red, then bold italic red English, each in the settings in force when typed", [x["s"] for x in r] == ["سلام ", "جهان", " hello"] and r[1] == {"s": "جهان", "b": 1, "c": RED} and r[2] == {"s": " hello", "b": 1, "i": 1, "c": RED}, r)
    a.finish()
    new_box(250, "تست"); a.finish()
    d = [x for x in boxes() if x["text"] == "تست"][0]
    C.check("the next (Persian) box starts with the settings: bold, italic, red", d["color"] == RED and d["runs"] == [{"s": "تست", "b": 1, "i": 1}], (d["color"], d.get("runs")))

    # ================================================================= opacity / brightness from the Brush
    clear(); reset()
    new_box(150, "x"); brush_btn.click(); a.page.wait_for_timeout(150)
    al = a.page.locator(".popup input[type=range]").nth(1); bb = al.bounding_box(); a.page.mouse.click(bb["x"] + bb["width"] * 0.4, bb["y"] + bb["height"] / 2); a.page.wait_for_timeout(200)
    alpha = tp()["g"]["alpha"]; kb.press("Escape"); a.page.wait_for_timeout(100); a.finish(); new_box(250, "y"); a.finish()
    C.check("opacity chosen in the Brush while typing is the setting for the next box too", alpha < 255 and [d for d in boxes() if d["text"] == "y"][0].get("alpha") == alpha, (alpha, [d.get("alpha") for d in boxes()]))

    # ================================================================= Reset to default
    clear(); reset()
    pick(8); fmt("Bigger"); fmt("Bold"); fmt("Italic")
    new_box(150, "keep"); fmt("Underline")
    brush_btn.click(); a.page.wait_for_timeout(150)
    rb = a.page.locator(".popup button", has_text="Reset to default")
    C.check("the Brush panel has Reset to default, enabled because settings were changed", rb.count() == 1 and rb.is_enabled())
    rb.click(); a.page.wait_for_timeout(250)
    st = tp()
    C.check("Reset to default puts every Text setting back (colour, size, bold, italic, underline)", st["g"]["color"] == DARK and st["g"]["size"] == 18 and not any([st["ts"]["b"], st["ts"]["i"], st["ts"]["u"]]), st)
    kb.press("Escape"); a.page.wait_for_timeout(100)
    C.check("the box that is open keeps what it had and the text typed next is in the defaults", P("() => noteflow.panels.nb.rt.typing") == {"b": False, "i": False, "u": False, "z": 18, "c": DARK}, P("() => noteflow.panels.nb.rt.typing"))
    kb.type("after"); a.finish()
    d = boxes()[0]
    C.check("…and the text typed before the reset kept its formatting", d["text"] == "keepafter" and len(d["runs"]) > 1 and d["runs"][0].get("b") == 1 and d["runs"][-1] == {"s": "after", "z": 18, "c": DARK}, d.get("runs"))
    new_box(250, "fresh"); a.finish()
    C.check("a new box after the reset is plain", not [x for x in boxes() if x["text"] == "fresh"][0].get("runs") and [x for x in boxes() if x["text"] == "fresh"][0]["color"] == DARK)

    # ================================================================= saved with the workspace
    pick(8); fmt("Bold")
    ws = P("""async () => { const WS = await import('./js/workspace.js'); const p = noteflow.panels.nb; const before = [p.groups.text.color, p.textStyle.b];
      const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer()); p.resetTool('text'); await noteflow.restore(ws);
      return [before, [noteflow.panels.nb.groups.text.color, noteflow.panels.nb.textStyle.b]]; }""")
    C.check("the settings are saved in the workspace and restored (no format change: they use the existing settings fields)", ws[0] == ws[1] == [RED, True], ws)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
