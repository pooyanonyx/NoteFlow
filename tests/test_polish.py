"""Smart linking: the countdown of a suggestion and the narrowest passage; the slim manual Link bar; the Snipping tool owning the cursor (Eraser); a new Note is a real note at once.
Driven through the real UI (real mouse and keyboard) on a PDF with a long paragraph and a notebook with short notes."""
import sys, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

F = ["The registry keeps the configuration of every installed service in a single hierarchical store.",
     "Backups are scheduled every night and are copied to a second location for safety.",
     "Printers are shared through a queue that serves the jobs in the order they arrive.",
     "Monitoring dashboards show the load of each server and warn the operators about disk problems.",
     "Passwords must be changed every ninety days according to the policy of the department."]
T1 = "The TCP handshake establishes a reliable connection using three steps: SYN, SYN-ACK and ACK."
T2 = "Public key cryptography lets two parties exchange secrets over an untrusted channel."
PARA = " ".join([F[0], F[1], T1, F[2], F[3], T2, F[4]])
N1 = "TCP handshake: three steps, SYN then SYN-ACK then ACK"
N1b = "The TCP handshake takes three steps: SYN, then SYN-ACK, then ACK"
N2 = "Public key cryptography lets two parties exchange secrets over an untrusted channel"
PDF_JS = """async (para) => { const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) { const p = doc.addPage([595, 842]); p.drawText(i === 1 ? para : 'Filler page about vegetable gardening, compost and watering schedules for beginners in spring.', { x: 60, y: 760, size: 11, font: f, maxWidth: 470, lineHeight: 15 }); }
  return await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'net.pdf'); }"""
norm = lambda s: re.sub(r"\s+", " ", s).strip()

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); kb = a.page.keyboard
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=30000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(400)
    P(PDF_JS, PARA); until("() => noteflow.panels.pdf.pages.length === 2 && noteflow.panels.pdf.pdf.hash"); P("async () => { await noteflow.panels.pdf.goto(0); }")
    def notes(*texts):
        P("""async (ts) => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: ts.map((t, i) => ({ t: 'text', x: 60, y: 120 + i * 90, text: t, color: '#1a1a1a', size: 16 })) }], null); await nb.goto(0); }""", list(texts))
        a.page.wait_for_timeout(250)
    SG = lambda: P("() => noteflow.smart.suggestions.map((s) => ({ left: s.left, text: s.toText, page: s.to.page, s: s.to.s, e: s.to.e, key: s.key, done: !!s.done }))")
    def scan():
        P("() => noteflow.smart.scan({ manual: true })"); until("() => !noteflow.smart.scanning"); a.page.wait_for_timeout(250)
    P("() => { noteflow.smart.ttl = 6000; noteflow.smart.setMode('suggest', { silent: true }); }")

    # ===================================================== the narrowest passage
    notes(N1); scan(); s = SG()
    C.check("a short note on a long PDF paragraph is suggested as the ONE sentence it is about (not the 3-sentence window, not the paragraph)",
            len(s) == 1 and norm(s[0]["text"]) == T1 and s[0]["e"] - s[0]["s"] < len(PARA) / 3, s)
    C.check("the card shows that sentence with the matching words highlighted, in the note and in the PDF text",
            a.page.locator(".smartcard .sugrow:nth-child(2) mark").count() >= 3 and a.page.locator(".smartcard .sugrow:nth-child(1) mark").count() >= 3,
            [a.page.locator(".smartcard mark").all_inner_texts()])
    C.check("Show flashes only that sentence (its boxes), and the link would carry only it",
            (P("async () => { const sg = noteflow.smart.suggestions[0]; await noteflow.smart.attachRects(sg); return sg.rects.length; }") or 0) in (1, 2))
    # ===================================================== the countdown
    clk = a.page.locator(".smartcard .sugclock"); bar = a.page.locator(".smartcard .sugbar")
    C.check("every suggestion shows a countdown (seconds) and a thin progress bar", clk.count() == 1 and re.fullmatch(r"[1-6] s", clk.inner_text() or "") is not None and bar.count() == 1, clk.inner_text())
    C.check("one clock only, running", P("() => !!noteflow.smart.clock"))
    l0 = SG()[0]["left"]; a.page.wait_for_timeout(1300); l1 = SG()[0]["left"]
    C.check("it counts down in real time", 900 < l0 - l1 < 1700, (l0, l1))
    C.check("the bar follows it", float(re.search(r"scaleX\(([\d.]+)\)", bar.get_attribute("style")).group(1)) < 0.9)
    box = a.page.locator(".smartcard .sug").bounding_box()
    a.page.mouse.move(box["x"] + 30, box["y"] + 12); a.page.wait_for_timeout(300); h0 = SG()[0]["left"]; a.page.wait_for_timeout(1500); h1 = SG()[0]["left"]
    C.check("it waits while the pointer is on the suggestion (time to read)", abs(h0 - h1) < 300 and "hold" in a.page.locator(".smartcard .sug").get_attribute("class"), (h0, h1))
    a.page.mouse.move(700, 600); a.page.wait_for_timeout(1300); h2 = SG()[0]["left"]
    C.check("…and goes on when it leaves", h1 - h2 > 800, (h1, h2))
    P("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); }"); v0 = SG()[0]["left"]; a.page.wait_for_timeout(1500); v1 = SG()[0]["left"]
    P("() => { delete document.hidden; }")
    C.check("it waits while the tab is hidden", abs(v0 - v1) < 300 and P("() => !document.hidden"), (v0, v1))
    P("() => { const st = noteflow.links.store, o = st.reject.bind(st); window.__rej = 0; st.reject = (k) => { window.__rej++; return o(k); }; window.__linksBefore = st.size; }")
    until("() => noteflow.smart.suggestions.length === 0", timeout=15000)
    C.check("when the time runs out the suggestion is dismissed like 'Not related': once, remembered, and NO link is made",
            P("() => window.__rej") == 1 and P("() => noteflow.links.store.rejects.size") == 1 and P("() => noteflow.links.store.size") == 0 and a.page.locator(".smartcard .sug:not(.screp)").count() == 0)
    C.check("the notice of the manual check then takes the clock over, and the clock stops when it is gone too", P("() => noteflow.smart.counted().length") <= 1 and (until("() => noteflow.smart.counted().length === 0 && !noteflow.smart.clock", timeout=9000) or True) and P("() => noteflow.smart.clock") == 0)
    scan(); n0 = P("() => noteflow.smart.stats.scans"); a.page.wait_for_timeout(300)
    C.check("the same suggestion does not come back", not SG())
    P("async () => { await noteflow.panels.pdf.goto(1); await noteflow.panels.pdf.goto(0); }"); a.page.wait_for_timeout(5200)
    C.check("…not even after the pages are visited again", not SG())

    # a new suggestion: a new scan does not restart its time; Link before it ends makes the link and nothing else happens afterwards
    notes(N1b); scan(); a.page.wait_for_timeout(1800); b0 = SG()[0]["left"]; scan(); b1 = SG()[0]["left"]
    C.check("a rescan keeps what is left of the time of a suggestion that is still the same (no new full time)", len(SG()) == 1 and b1 <= b0 + 100 and b1 < 4800, (b0, b1))
    a.page.locator(".smartcard button", has_text="Link").first.click(); a.page.wait_for_timeout(500)
    C.check("accepting in time makes exactly one link, marked as suggested; the suggestion and the clock are gone", P("() => noteflow.links.store.size") == 1 and P("() => noteflow.links.store.all()[0].src") == "suggested" and not SG() and P("() => noteflow.smart.counted().every((x) => x === noteflow.smart.report)"))
    a.page.mouse.move(300, 300); until("() => noteflow.smart.counted().length === 0 && !noteflow.smart.clock", timeout=9000); a.page.wait_for_timeout(1000)
    C.check("…and the clock stops with the notice", P("() => noteflow.smart.clock") == 0)
    a.page.wait_for_timeout(5000)
    C.check("…and when its time would have ended nothing happens: still one link, nothing more rejected", P("() => noteflow.links.store.size") == 1 and P("() => noteflow.links.store.rejects.size") == 1 and P("() => window.__rej") == 1)
    ws = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer());
      await noteflow.restore(ws); return [ws.links.rejects.length, noteflow.links.store.rejects.size, noteflow.links.store.size, noteflow.smart.suggestions.length]; }""")
    C.check("saved and reopened: the expired decision and the link are both there, and no suggestion is waiting with a stale timer", ws == [1, 1, 1, 0], ws)

    # several suggestions: independent, each its own time
    P("async () => { noteflow.links.store.clear && noteflow.links.store.clear(); }")
    P("async () => { await noteflow.panels.pdf.goto(0); }")
    a.page.mouse.move(300, 300); notes("TCP handshake takes three steps SYN then SYN-ACK then ACK again", N2); scan(); s = SG()
    C.check("two notes: two suggestions, each with its own countdown", len(s) == 2 and a.page.locator(".smartcard .sugclock").count() == 2, [x["text"][:30] for x in s])
    a.page.wait_for_timeout(1500)
    a.page.locator(".smartcard button", has_text="Not related").first.click(); a.page.mouse.move(300, 300); a.page.wait_for_timeout(1300); r = SG()
    C.check("dismissing one leaves the other counting (not restarted, not stopped)", len(r) == 1 and r[0]["left"] < 4300 and P("() => !!noteflow.smart.clock"), r)
    until("() => noteflow.smart.suggestions.length === 0", timeout=12000)
    C.check("the other one then runs out by itself: both are rejected, none linked", P("() => noteflow.links.store.rejects.size") == 2 and P("() => noteflow.links.store.size") == 0, P("() => [noteflow.links.store.rejects.size, noteflow.links.store.size]"))

    # ===================================================== the slim manual Link bar
    P("() => noteflow.smart.setMode('off')")                                 # (the card of the earlier part must not lie over the notebook)
    notes(N1); P("() => { const nb = noteflow.panels.nb; nb.setTool('select'); nb.selected = 0; nb.render(); noteflow.setActive(nb); }")
    a.page.locator('.topbar button[title^="Link two things"]').click(); a.page.wait_for_timeout(300)
    g = a.page.locator(".linkguide:not(.snipcard)")
    def geo(): return P("() => { const g = document.querySelector('.linkguide:not(.snipcard)'), r = g.getBoundingClientRect(); return { h: r.height, w: r.width, bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right, over: g.scrollWidth > g.clientWidth + 1 }; }")
    G = geo()
    C.check("the Link bar is one slim row (about 36 px, was ~150) at the very bottom, centred, nothing cut off", G["h"] <= 44 and 0 <= G["bottom"] <= 16 and abs(G["left"] - G["right"]) < 2 and not G["over"], G)
    t = g.inner_text()
    C.check("it still says the step, the first end that was chosen, what to do next, and has Cancel", "Step 2 of 2" in t and "TCP handshake" in t and "PDF page" in t and "Cancel" in t, t)
    for w, h in [(900, 700), (600, 800), (420, 800)]:
        a.page.set_viewport_size({"width": w, "height": h}); a.page.wait_for_timeout(400); G = geo()
        C.check(f"window {w}x{h}: inside the window, at the bottom, at most two rows", G["h"] <= 92 and G["left"] >= 0 and G["right"] >= 0 and 0 <= G["bottom"] <= 16 and not G["over"], G)
    a.page.set_viewport_size({"width": 1500, "height": 900}); a.page.wait_for_timeout(300)
    # it must not stop working near the bottom of the page: the page under it is still reachable (the bar is not a full-width strip)
    x, y = P("() => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(0, 300, 400); return [r.left + sx, r.top + sy]; }")
    a.page.mouse.click(x, y); a.page.wait_for_timeout(300)
    L = P("() => noteflow.links.store.all().map((l) => [l.a.k, l.b.k, l.b.page])")
    C.check("manual linking works as before: note -> tap on the PDF page", len(L) >= 1 and ["item", "pdf", 0] in L and P("() => !noteflow.links.picking") and g.is_hidden(), L)
    P("() => { const nb = noteflow.panels.nb; nb.selected = 0; noteflow.setActive(nb); }"); a.page.locator('.topbar button[title^="Link two things"]').click(); a.page.wait_for_timeout(200)
    a.page.keyboard.press("Escape"); a.page.wait_for_timeout(150)
    C.check("Esc leaves the bar", g.is_hidden() and not P("() => noteflow.links.picking"))

    # ===================================================== Snipping tool owns the cursor
    P("""() => { const nb = noteflow.panels.nb; nb.commit([{ t: 'pen', color: '#000000', w: 3, pts: [[100, 300], [200, 330], [300, 300]] }]); nb.setTool('eraser'); noteflow.setActive(nb); nb.render(); }""")
    sx, sy = P("() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [x, y] = p.pageToScreenAt(0, 330, 500); return [r.left + x, r.top + y]; }")
    a.page.mouse.move(sx, sy, steps=3); a.page.mouse.move(sx + 5, sy + 5); a.page.wait_for_timeout(150)
    EP = lambda: P("() => !!noteflow.panels.nb.eraserPos")
    ring = lambda: P("""([x, y]) => { const p = noteflow.panels.nb, d = p.dpr, c = p.ctx.getImageData(Math.round((x - p.stage.getBoundingClientRect().left) * d) - 40 * d, Math.round((y - p.stage.getBoundingClientRect().top) * d), 80 * d, 1).data; let n = 0; for (let i = 0; i < c.length; i += 4) if (c[i] < 60 && c[i + 1] < 60 && c[i + 2] < 60) n++; return n; }""", [sx + 5, sy + 5])
    C.check("(setup) with the Eraser selected its circle follows the pointer", EP() and ring() > 0)
    a.page.locator('.topbar button[title^="Snipping tool"]').click(); a.page.wait_for_timeout(150)
    C.check("starting the Snipping Tool drops the Eraser's circle at once (state and canvas)", not EP() and ring() == 0 and P("() => noteflow.panels.nb.cursorOwner") == "snip")
    a.page.mouse.move(sx + 30, sy + 30, steps=4); a.page.mouse.move(sx + 60, sy + 50, steps=4); a.page.wait_for_timeout(150)
    C.check("…moving the pointer over the panel does not bring it back; the crosshair is the cursor", not EP() and ring() == 0 and P("() => getComputedStyle(noteflow.panels.nb.stage).cursor") == "crosshair")
    n_items = P("() => noteflow.panels.nb.items.length"); items0 = P("() => JSON.stringify(noteflow.panels.nb.items)")
    x0, y0 = P("() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [x, y] = p.pageToScreenAt(0, 80, 270); return [r.left + x, r.top + y]; }")
    x1, y1 = P("() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [x, y] = p.pageToScreenAt(0, 330, 380); return [r.left + x, r.top + y]; }")
    a.page.mouse.move(x0, y0); a.page.mouse.down(); a.page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=4); a.page.mouse.move(x1, y1, steps=4)
    C.check("while dragging the capture area there is still no eraser circle", not EP() and ring() < 400)
    a.page.mouse.up(); until("() => noteflow.snip.cap")
    C.check("capturing across a drawing with the Eraser selected erases nothing", P("() => JSON.stringify(noteflow.panels.nb.items)") == items0)
    kb.press("Escape"); a.page.wait_for_timeout(200)
    a.page.mouse.move(sx, sy, steps=3); a.page.mouse.move(sx + 4, sy + 4); a.page.wait_for_timeout(200)
    C.check("after the capture is cancelled the Eraser works as before: circle back, own cursor, eraser still selected",
            EP() and P("() => noteflow.panels.nb.tool") == "eraser" and P("() => getComputedStyle(noteflow.panels.nb.stage).cursor") == "none" and P("() => noteflow.panels.nb.cursorOwner") is None)
    e0 = P("() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [x, y] = p.pageToScreenAt(0, 150, 322); return [r.left + x, r.top + y]; }"); e1 = P("() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [x, y] = p.pageToScreenAt(0, 250, 322); return [r.left + x, r.top + y]; }")
    a.page.mouse.move(*e0); a.page.mouse.down(); a.page.mouse.move(*e1, steps=8); a.page.mouse.up(); a.page.wait_for_timeout(200)
    C.check("…and it erases again", P("() => JSON.stringify(noteflow.panels.nb.items)") != items0)
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100); a.page.mouse.move(sx, sy, steps=3)
    C.check("Ctrl+Shift+S with the Eraser: same", not EP()); kb.press("Escape")
    # other tools / the link picker do not disturb the capture either
    for tool in ["pen", "text", "note", "mark", "shape"]:
        P("(t) => noteflow.panels.nb.setTool(t)", tool); kb.press("Control+Shift+S"); a.page.wait_for_timeout(80)
        n = P("() => noteflow.panels.nb.items.length"); a.page.mouse.move(x0, y0); a.page.mouse.down(); a.page.mouse.move(x1, y1, steps=5); a.page.mouse.up(); a.page.wait_for_timeout(250)
        got = P("() => !!noteflow.snip.cap && !noteflow.panels.nb.editing && !noteflow.panels.nb.preview")
        C.check(f"{tool} tool selected: dragging in the Snipping Tool captures and draws / creates nothing", got and P("() => noteflow.panels.nb.items.length") == n, tool)
        kb.press("Escape"); a.page.wait_for_timeout(80)
    P("() => { const nb = noteflow.panels.nb; nb.setTool('eraser'); nb.selected = null; noteflow.setActive(nb); }")
    P("() => { noteflow.links.begin({ k: 'item', id: 'x', slot: 'nb', pv: 'x' }); }"); a.page.mouse.move(sx, sy, steps=3); a.page.mouse.move(sx + 3, sy + 3); a.page.wait_for_timeout(100)
    C.check("picking a link end also takes the pointer from the Eraser", not EP() and P("() => noteflow.panels.nb.cursorOwner") == "link"); P("() => noteflow.links.cancel()")

    # ===================================================== a new Note is a real note at once
    P("""async () => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [] }], null); nb.setTool('note'); noteflow.setActive(nb); await nb.goto(0); }""")
    a.page.wait_for_timeout(300)
    x, y = P("() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(0, 200, 300); return [r.left + sx, r.top + sy]; }")
    a.page.mouse.click(x, y); a.page.wait_for_timeout(120)
    st = P("() => { const p = noteflow.panels.nb; return { editing: !!p.editing, prev: p.preview && p.preview.t, focus: document.activeElement === p.ta, items: p.items.length }; }")
    px = P("""([x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), d = p.dpr, c = p.ctx.getImageData(Math.round((x - r.left + 60) * d), Math.round((y - r.top + 60) * d), 1, 1).data; return [c[0], c[1], c[2]]; }""", [x, y])
    C.check("clicking with the Note tool shows a real note at once (its yellow paper, before any letter), with the cursor in it", st["editing"] and st["prev"] == "note" and st["focus"] and st["items"] == 0 and px[0] > 230 and px[1] > 220 and px[2] < 200, [st, px])
    kb.type("first words", delay=15); a.page.wait_for_timeout(150)
    C.check("typing starts without another click", P("() => noteflow.panels.nb.ta.value") == "first words")
    a.page.mouse.click(x + 400, y + 250); a.page.wait_for_timeout(300)
    it = P("() => noteflow.panels.nb.items.map((d) => [d.t, d.text, d.w, d.h])")
    C.check("one note is saved with its text; nothing is drawn twice; the preview is gone", len(it) == 1 and it[0][0] == "note" and it[0][1] == "first words" and P("() => noteflow.panels.nb.preview") is None, it)
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(200)
    C.check("undo removes it, redo brings it back", P("() => noteflow.panels.nb.items.length") == 0 and (P("() => { noteflow.panels.nb.redo(); return noteflow.panels.nb.items.length; }") == 1))
    a.page.mouse.click(x + 120, y + 300); a.page.wait_for_timeout(150); kb.press("Escape"); a.page.mouse.click(x + 500, y + 100); a.page.wait_for_timeout(250)
    C.check("an empty new note that is left without text is simply dropped (no empty note, no leftover preview)", P("() => noteflow.panels.nb.items.length") == 1 and P("() => noteflow.panels.nb.preview") is None and P("() => !noteflow.panels.nb.editing"))
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
