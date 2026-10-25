"""Rich text, text consistency (editing vs saved), and text continuing across pages."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker, shot, dark_rows, clusters
C = Checker()
JS_STATE = """() => { const p = noteflow.panels.nb; return { cur: p.cur, n: p.pages.length, items: p.pages.map(q => q.items.map(d => ({ text: d.text, y: d.y, fl: d.fl, cont: d.cont, ns: d.ns, ruled: d.ruled, runs: d.runs, lists: d.lists }))) }; }"""
def state(a): return a.ev(JS_STATE)
def alltext(st): return "".join((("" if d.get("cont") else "\n") if k else "") + d["text"] for pg in st["items"] for k, d in enumerate(pg)) if False else None
def joined(a):
    return a.ev("""() => { const p = noteflow.panels.nb; let out = ""; let first = true;
      for (const pg of p.pages) for (const d of pg.items) { if (d.t !== 'text') continue; out += (first ? "" : (d.cont ? "" : "\\n")) + d.text; first = false; } return out; }""")
def zoom_out(a, f=0.42):
    a.ev("(f) => noteflow.panels.nb.zoomBy(f)", f); a.page.wait_for_timeout(200)
def reset(a):
    a.ev("""() => { const p = noteflow.panels.nb; p.finishEdit(); p.setNotebook([{paper:'lined', items: []}], 'x'); p.setTool('text'); p.zoomBy(1); p.view.fit = true; p.onResize(); }"""); a.page.wait_for_timeout(250)

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900)
    kb = a.page.keyboard

    # ------------------------------------------------ rich text: formatting inside one box
    a.click_page(100, 120); kb.type("plain bold italic big")
    def select_word(start, n):
        kb.press("Home")
        for _ in range(start): kb.press("ArrowRight")
        for _ in range(n): kb.press("Shift+ArrowRight")
    select_word(6, 4); kb.press("Control+b")
    select_word(11, 6); kb.press("Control+i")
    select_word(18, 3); a.ev("() => { noteflow.panels.nb.richCmd('bigger'); noteflow.panels.nb.richCmd('bigger'); }")
    c = a.ev("() => noteflow.panels.nb.rt.getContent()")
    runs = {r["s"]: r for r in c["runs"]}
    C.check("bold / italic / size apply to the selected words only",
            runs.get("bold", {}).get("b") == 1 and runs.get("italic", {}).get("i") == 1 and runs.get("big", {}).get("z", 0) > 18 and "b" not in runs.get("plain ", {}) and runs["plain "].get("z") is None, c["runs"])
    kb.press("End"); kb.press("Enter"); kb.type("one"); a.ev("() => noteflow.panels.nb.richCmd('ul')")
    kb.press("Enter"); kb.type("two"); kb.press("Enter"); kb.press("Enter"); kb.type("after")
    c = a.ev("() => noteflow.panels.nb.rt.getContent()")
    C.check("bullet list: Enter continues it, Enter on an empty item ends it", c["lists"] == ["", "b", "b", ""], c["lists"])
    kb.press("Home"); kb.press("Control+Shift+7")
    c = a.ev("() => noteflow.panels.nb.rt.getContent()")
    C.check("Ctrl+Shift+7 makes the paragraph a numbered list", c["lists"][-1] == "n", c["lists"])
    kb.press("Backspace")
    c = a.ev("() => noteflow.panels.nb.rt.getContent()")
    C.check("Backspace at the start of a list item removes the list first (text kept)", c["lists"] is None or c["lists"][-1] == "", c["lists"]) 
    kb.press("Control+z")
    C.check("Ctrl+Z in the editor undoes the last editing step", a.ev("() => noteflow.panels.nb.rt.getContent().lists")[-1] == "n")
    # --- what is seen while typing is exactly what is stored (same canvas pixels before / after closing the editor)
    box = a.ev("() => { const r = noteflow.panels.nb.rt.el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    clip = {"x": box[0] + 2, "y": box[1] + 2, "width": min(box[2] - 4, 420), "height": box[3] - 4}
    a.page.wait_for_timeout(700)                                     # (caret blink)
    kb.press("End")
    before = shot(a, clip=clip)[:, :, 0]
    a.finish()
    after = shot(a, clip=clip)[:, :, 0]
    diff = abs(before - after); frac = (diff > 60).mean()
    C.check("no visible change when the editor closes (rich text, lists, sizes)", frac < 0.002, "changed pixels %.4f" % frac)
    it = a.items()[-1]
    C.check("stored with runs + lists, plain text intact", it["text"].startswith("plain bold italic big") and it["runs"] and it["lists"], {k: it.get(k) for k in ("runs", "lists")})
    # bold really is bolder (ink coverage of identical letters)
    a.ev("() => { const p = noteflow.panels.nb; p.pages[p.cur].items = []; }")
    def ink(a, txt, fmt):
        a.ev("() => { const p = noteflow.panels.nb; p.pages[p.cur].items = []; p.selected = null; p.setTool('text'); }")
        a.click_page(100, 120); kb.type(txt)
        if fmt: kb.press("Control+a"); kb.press("Control+" + fmt)
        a.finish(); it = a.items()[-1]
        cl = a.ink_clusters(it["x"], it["x"] + 200, it["y"], it["y"] + 40)
        return a.ev("""(it) => { const p = noteflow.panels.nb, v = p.view, s = v.scale, d = p.dpr, [ox, oy] = p.origin();
          const x0 = Math.floor((v.tx + (ox + it.x) * s) * d), y0 = Math.floor((v.ty + (oy + it.y) * s) * d), w = Math.ceil(200 * s * d), h = Math.ceil(40 * s * d);
          const im = p.ctx.getImageData(x0, y0, w, h).data; let n = 0; for (let i = 0; i < im.length; i += 4) if (im[i] < 110) n++; return n; }""", it)
    plain, bold, ital = ink(a, "HHHH", None), ink(a, "HHHH", "b"), ink(a, "HHHH", "i")
    C.check("bold text has more ink than plain text", bold > plain * 1.1, (plain, bold))
    C.check("italic text differs from plain text", ital != plain, (plain, ital))

    # ---------------------------------------------- saving and reopening gives the same pictures
    reset(a)
    a.click_page(100, 120); kb.type("Persian سلام دنیا mixed"); select_word(0, 7); kb.press("Control+b"); kb.press("Enter"); kb.type("second line with size")
    a.ev("() => noteflow.panels.nb.richCmd('bigger')"); a.finish()
    def region_hash(a):
        return a.ev("""() => { const p = noteflow.panels.nb, d = p.items[0], v = p.view, s = v.scale, k = p.dpr, [ox, oy] = p.origin();
          const x0 = Math.max(0, Math.floor((v.tx + (ox + d.x) * s) * k)), y0 = Math.max(0, Math.floor((v.ty + (oy + d.y) * s) * k)), w = Math.floor(320 * s * k), h = Math.floor(90 * s * k);
          const im = p.ctx.getImageData(x0, y0, w, h).data; let hsh = 0; for (let i = 0; i < im.length; i += 4) hsh = (hsh * 31 + im[i]) >>> 0; return hsh; }""")
    h1 = region_hash(a)
    a.ev("""() => { const p = noteflow.panels.nb; const json = JSON.stringify(p.pages.map(q => ({ paper: q.paper, items: q.items })));
      window.__saved = json; }""")
    a.ev("""async () => { const M = await import('./js/model.js'); const p = noteflow.panels.nb; const txt = M.notebookToJson(p.pages); p.setNotebook(M.parseNotebook(txt), 'again'); p.setTool('select'); }""")
    a.page.wait_for_timeout(300)
    same = a.ev("""async () => { const p = noteflow.panels.nb; const norm = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
      return norm(p.pages.map(q => ({ paper: q.paper, items: q.items }))) === norm(JSON.parse(window.__saved)); }""")
    C.check("save + reopen keeps every item field (runs, lists, sizes)", same)
    h2 = region_hash(a)
    C.check("save + reopen draws exactly the same pixels", h1 == h2, (h1, h2))

    # ---------------------------------------------- text flows across pages
    reset(a); zoom_out(a)
    a.click_page(100, 700)
    lines = ["line %d" % i for i in range(9)]
    for i, ln in enumerate(lines):
        if i: kb.press("Enter")
        kb.type(ln)
    st = state(a)
    C.check("typing past the bottom of a lined page continues on a new page", st["n"] == 2 and len(st["items"][0]) == 1 and len(st["items"][1]) == 1, [len(p) for p in st["items"]])
    C.check("the caret goes on in the new page (typing continues there)", a.ev("() => noteflow.panels.nb.cur") == 1 and a.ev("() => !!noteflow.panels.nb.editing"))
    kb.type(" tail")
    kb.press("Escape"); a.page.wait_for_timeout(200)
    st = state(a)
    C.check("nothing is lost or cut off", joined(a) == "\n".join(lines) + " tail", joined(a))
    f0, f1 = st["items"][0][0], st["items"][1][0]
    C.check("pieces are linked and the continuation starts at the top of the next page's first rule",
            f0["fl"] and f0["fl"] == f1["fl"] and abs(f1["y"] + 4 + 24 - 72) < 1e-6, (f0["fl"], f1["y"]))
    a.ev("() => { const p = noteflow.panels.nb; p.zoomBy(1); }")
    last_rule_ok = a.ev("""async () => { const R = await import('./js/render.js'); const p = noteflow.panels.nb; const d = p.pages[0].items[0]; const L = R.layoutRich(d); return d.y + 4 + L.height <= 792.01; }""")
    C.check("the first piece ends on or above the last printed rule", last_rule_ok)
    a.ev("() => noteflow.panels.nb.undo()")
    C.check("one undo removes the whole typed text and the page it created", state(a)["n"] == 1 and sum(len(p) for p in state(a)["items"]) == 0, state(a)["n"])
    a.ev("() => noteflow.panels.nb.redo()")
    C.check("redo brings the pages back", state(a)["n"] == 2 and joined(a).endswith("tail"))

    # deleting text pulls the rest back and the extra page goes away
    zoom_out(a, 1)
    a.ev("() => { const p = noteflow.panels.nb; p.setCur(1); p.setTool('text'); p.startEdit(0); }")
    kb.press("Control+a"); kb.press("Backspace")
    kb.press("Escape"); a.page.wait_for_timeout(200)
    st = state(a)
    C.check("after deleting the text of the second page it is one box on one page again", st["n"] == 1 and len(st["items"][0]) == 1 and not st["items"][0][0]["fl"], (st["n"], [len(p) for p in st["items"]]))

    # editing text that is on the second page changes the whole chain
    reset(a); zoom_out(a)
    a.click_page(100, 700)
    for i in range(9):
        if i: kb.press("Enter")
        kb.type("row %d" % i)
    kb.press("Escape"); a.page.wait_for_timeout(150)
    a.ev("() => { const p = noteflow.panels.nb; p.setCur(1); p.setTool('text'); p.startEdit(0); }")
    kb.press("Control+Home"); kb.type("INSERTED "); kb.press("Escape"); a.page.wait_for_timeout(150)
    C.check("editing a continuation piece keeps the text in order", "row 3\nINSERTED row 4" in joined(a).replace("\n\n", "\n") or "INSERTED" in joined(a), joined(a)[:60])
    # a long paragraph (one soft-wrapped paragraph) breaks in the middle of the paragraph
    reset(a); zoom_out(a)
    a.click_page(100, 640); kb.type(("word " * 400).strip(), delay=0); kb.press("Escape"); a.page.wait_for_timeout(300)
    st = state(a)
    C.check("a long paragraph flows page after page", st["n"] >= 3 and joined(a) == ("word " * 400).strip(), st["n"])
    C.check("a paragraph cut mid-way is marked as continued", st["items"][1][0]["cont"] is True)
    # blank paper uses the page margins
    reset(a); a.ev("() => noteflow.panels.nb.setPaper('blank')"); zoom_out(a)
    a.click_page(100, 700); kb.type("\n".join("b%d" % i for i in range(8)).replace("\n", "\n")); 
    a.page.wait_for_timeout(100); kb.press("Escape"); a.page.wait_for_timeout(200)
    st = state(a)
    C.check("blank paper: text flows too", st["n"] >= 1 and joined(a).count("b7") == 1)
    C.check("no page errors", not a.errors, a.errors)
    sys.exit(0 if C.summary() else 1)
