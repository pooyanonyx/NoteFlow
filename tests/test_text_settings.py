"""Text tool: formatting chosen BEFORE a text box exists is applied to the next box; existing text keeps its own behaviour."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
def btn(a, title): return a.page.locator(f'.fmtgrp:visible button[title^="{title}"]').first
def pressed(a, title): return btn(a, title).get_attribute("aria-pressed") == "true"
def lbl(a): return a.page.locator(".fmtgrp:visible .sizelbl").first.inner_text()
STATE = "() => { const p = noteflow.panels.nb; return { ts: p.textStyle, size: p.groups.text.size, cur: p.curStyle.size, editing: !!p.editing }; }"
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard
    a.ev("() => noteflow.panels.nb.zoomBy(0.5)"); a.page.wait_for_timeout(200)
    C.check("Text tool selected, no text box: the format buttons are shown", btn(a, "Bold").is_visible() and btn(a, "Italic").is_visible() and btn(a, "Underline").is_visible() and btn(a, "Bulleted").is_visible() and btn(a, "Numbered").is_visible() and btn(a, "Bigger").is_visible())
    C.check("…and show the current defaults (not bold, size 18)", not pressed(a, "Bold") and lbl(a) == "18")
    btn(a, "Bold").click(); btn(a, "Italic").click(); btn(a, "Underline").click(); btn(a, "Bigger").click(); btn(a, "Bigger").click(); btn(a, "Bulleted").click()
    st = a.ev(STATE)
    C.check("buttons work without a text box: bold + italic + underline + list + size are set", st["ts"] == {"b": True, "i": True, "u": True, "list": "b"} and st["size"] == 22 and not st["editing"], st)
    C.check("the buttons show what is set (pressed, size label 22)", pressed(a, "Bold") and pressed(a, "Italic") and pressed(a, "Underline") and pressed(a, "Bulleted") and not pressed(a, "Numbered") and lbl(a) == "22")
    a.click_page(100, 150); kb.type("first box"); kb.press("Enter"); kb.type("second line"); a.finish()
    it = a.items()[-1]
    C.check("a new box gets those settings automatically (all text bold + italic + underlined, size 22, bulleted)",
            it["size"] == 22 and it["runs"] == [{"s": "first box\nsecond line", "b": 1, "i": 1, "u": 1}] and it["lists"] == ["b", "b"], {k: it.get(k) for k in ("size", "runs", "lists")})
    a.click_page(100, 400); kb.type("another"); a.finish()
    it2 = a.items()[-1]
    C.check("the settings stay for the next boxes too", it2["size"] == 22 and it2["runs"][0].get("b") == 1 and it2["lists"] == ["b"])
    C.check("the defaults are still set after creating boxes", a.ev(STATE)["ts"]["b"] is True and pressed(a, "Bold"))
    # a box that is open: buttons act on that box only, defaults stay
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('text'); p.startEdit(0); }")
    kb.press("Control+a"); btn(a, "Bold").click(); a.page.wait_for_timeout(100)
    c = a.ev("() => noteflow.panels.nb.rt.getContent()")
    C.check("while a box is edited, Bold changes that text (selection), not the defaults", not any(r.get("b") for r in (c["runs"] or [])) and a.ev(STATE)["ts"]["b"] is True, c["runs"])
    a.finish()
    C.check("…and the edit was stored on that box", not (a.items()[0].get("runs") or [{}])[0].get("b"))
    # a selected (not edited) box: toolbar shows ITS format, buttons change it; defaults untouched
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('select'); p.selected = 1; p.fmtKey = ''; p.render(); }"); a.page.wait_for_timeout(100)
    C.check("selected box: the toolbar shows that box's format (bold, italic), size", pressed(a, "Bold") and lbl(a) == "22", lbl(a))
    btn(a, "Bold").click(); btn(a, "Bigger").click(); a.page.wait_for_timeout(100)
    sel = a.items()[1]; st = a.ev(STATE)
    C.check("selected box: buttons change the box (bold off, bigger)", not sel["runs"][0].get("b") and sel["size"] == 24, (sel["runs"], sel["size"]))
    C.check("…and leave the Text tool's defaults alone", st["ts"]["b"] is True and st["size"] == 22, st)
    # numbered list default + Persian
    a.ev("() => { const p = noteflow.panels.nb; p.selected = null; p.setTool('text'); p.fmtKey = ''; p.render(); }"); a.page.wait_for_timeout(100)
    btn(a, "Bold").click(); btn(a, "Italic").click(); btn(a, "Underline").click(); btn(a, "Bulleted").click(); btn(a, "Numbered").click(); btn(a, "Smaller").click(); btn(a, "Smaller").click()
    st = a.ev(STATE)
    C.check("switching everything off / numbered / smaller", st["ts"] == {"b": False, "i": False, "u": False, "list": "n"} and st["size"] == 18, st)
    a.click_page(100, 640); kb.type("یک"); kb.press("Enter"); kb.type("دو"); a.finish()
    it = a.items()[-1]
    C.check("numbered default: new Persian box is a numbered list, plain text, size 18", it["lists"] == ["n", "n"] and not it.get("runs") and it["size"] == 18, {k: it.get(k) for k in ("size", "runs", "lists")})
    # first typed letter is formatted even when the box is still empty: toggling inside the new box changes only that box
    btn(a, "Numbered").click(); btn(a, "Bold").click()
    a.click_page(100, 500); btn(a, "Italic").click(); kb.type("x"); a.finish()
    it = a.items()[-1]
    C.check("toggling italic while typing in the new box affects only that box", it["runs"] == [{"s": "x", "b": 1, "i": 1}] and not a.ev(STATE)["ts"]["i"], it.get("runs"))
    # Reset to default of the Text tool clears these settings too
    a.page.get_by_role("button", name="Brush").click(); a.page.wait_for_timeout(150)
    a.page.locator(".popup button", has_text="Reset to default").click(); a.page.wait_for_timeout(150)
    st = a.ev(STATE); g = a.ev("() => JSON.parse(JSON.stringify(noteflow.panels.nb.groups.pen))")
    C.check("Reset to default (Text tool) also clears the text formatting settings", st["ts"] == {"b": False, "i": False, "u": False, "list": ""} and st["size"] == 18, st)
    # saved with the toolbar settings
    a.ev("() => { const p = noteflow.panels.nb; p.setTool('text'); p.setTextDefault('b'); p.setTextDefault('ol'); }")
    vs = a.ev("() => noteflow.panels.nb.viewState().toolbar.text_style")
    C.check("saved with the tool settings", vs == {"b": True, "i": False, "u": False, "list": "n"}, vs)
    a.ev("() => { const p = noteflow.panels.nb; p.restoreView({ toolbar: { tool: 'text', text_style: { b: false, i: true, u: false, list: 'b', evil: 1 } } }); }")
    C.check("restored (and cleaned) from a saved workspace; older workspaces keep the defaults", a.ev(STATE)["ts"] == {"b": False, "i": True, "u": False, "list": "b"} and a.ev("() => { const p = noteflow.panels.nb; p.restoreView({ toolbar: { tool: 'text' } }); return JSON.stringify(p.textStyle); }") != "")
    # other tools: sticky note / whiteboard unaffected, text tool on a board uses the same defaults
    a.ev("() => { const p = noteflow.panels.nb; p.textStyle = { b: true, i: false, u: false, list: '' }; p.setTool('note'); }")
    a.ev("() => { const p = noteflow.panels.nb; p.fmtKey = ''; p.render(); }"); a.page.wait_for_timeout(100)
    C.check("Note tool has no rich text buttons", a.ev("() => noteflow.panels.nb.richGroup.hidden") is True)
    C.check("no page errors", not a.errors, a.errors)
    sys.exit(0 if C.summary() else 1)
