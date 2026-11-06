"""Regression tests: (1) one Ctrl+V pastes exactly once (not also as an application-level paste), images and other pastes still work;
(2) the "Check now" notice (no match found) counts down and goes away by itself, on the same single clock as the suggestions; (3) the suggestion time is 15 s.
Real keyboard and clipboard where possible."""
import sys, re, time
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

T1 = "The TCP handshake establishes a reliable connection using three steps: SYN, SYN-ACK and ACK."
T2 = "Public key cryptography lets two parties exchange secrets over an untrusted channel."
T3 = "Photosynthesis converts light energy into chemical energy inside the chloroplasts of plant cells."
T4 = "A binary search halves the sorted array repeatedly and finds an element in logarithmic time."
FILL = ["The registry keeps the configuration of every installed service in a single hierarchical store.",
        "Backups are scheduled every night and are copied to a second location for safety.",
        "Printers are shared through a queue that serves the jobs in the order they arrive.",
        "Monitoring dashboards show the load of each server and warn the operators about disk problems."]
PARA = " ".join([FILL[0], T1, FILL[1], T2, FILL[2], T3, FILL[3], T4])
NOTES = ["TCP handshake: three steps, SYN then SYN-ACK then ACK", "Public key cryptography lets two parties exchange secrets over an untrusted channel",
         "Photosynthesis converts light energy into chemical energy in chloroplasts", "Binary search halves the sorted array and finds an element in logarithmic time"]
PDF_JS = """async (para) => { const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) { const p = doc.addPage([595, 842]); p.drawText(i === 1 ? para : 'Filler page about vegetable gardening, compost and watering schedules for beginners in spring.', { x: 60, y: 760, size: 11, font: f, maxWidth: 470, lineHeight: 15 }); }
  return await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'net.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); kb = a.page.keyboard
    try: a.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    except Exception: pass
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=30000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    items = lambda: P("() => noteflow.panels.nb.items.map((i) => [i.t, i.text === undefined ? null : i.text])")
    def clip(text): P("(t) => navigator.clipboard.writeText(t)", text)
    def at(px, py): return P("([x, y]) => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(0, x, y); return [r.left + sx, r.top + sy]; }", [px, py])
    def fresh(tool):
        P("""(t) => { const nb = noteflow.panels.nb; nb.finishEdit(); nb.setNotebook([{ paper: 'lined', items: [] }], null); nb.setTool(t); noteflow.setActive(nb); nb.goto(0); nb.render(); }""", tool); a.page.wait_for_timeout(250)
    def img_event(target_js):
        P("""async (sel) => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40);
          const b = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'x.png', { type: 'image/png' }));
          const t = eval(sel); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""", target_js)

    # ===================================================== 1. paste exactly once
    fresh("text"); x, y = at(150, 200); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); kb.type("abc ", delay=10)
    clip("PASTED"); kb.press("Control+V"); a.page.wait_for_timeout(300)
    a.page.mouse.click(x + 300, y + 300); a.page.wait_for_timeout(300)
    C.check("Text tool, typing, Ctrl+V: the text is pasted into the open Text Area once; no second text box", items() == [["text", "abc PASTED"]], items())
    fresh("text"); x, y = at(150, 200); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); clip("one"); kb.press("Control+V"); kb.type(" ", delay=10); clip("two"); kb.press("Control+V"); a.page.wait_for_timeout(200)
    a.page.mouse.click(x + 300, y + 300); a.page.wait_for_timeout(300)
    C.check("two Ctrl+V in a row: both in the same box, still one box", items() == [["text", "one two"]], items())
    fresh("text"); x, y = at(150, 200); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); clip("سلام دنیا\nline two"); kb.press("Control+V"); a.page.wait_for_timeout(200)
    a.page.mouse.click(x + 300, y + 300); a.page.wait_for_timeout(300)
    C.check("multi-line Persian + English text: once, in one box", len(items()) == 1 and items()[0][1] == "سلام دنیا\nline two", items())
    fresh("note"); x, y = at(200, 300); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); kb.type("n ", delay=10); clip("NOTEPASTE"); kb.press("Control+V"); a.page.wait_for_timeout(200)
    a.page.mouse.click(x + 400, y + 250); a.page.wait_for_timeout(300)
    C.check("Note tool (plain editor): pasted once into the note, no extra text box", items() == [["note", "n NOTEPASTE"]], items())
    fresh("text"); x, y = at(150, 200); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); kb.type("keep", delay=10)
    P("() => { window.__paste = 0; document.addEventListener('paste', (e) => { window.__paste++; window.__prev = e.defaultPrevented; }); }"); clip("zzz"); kb.press("Control+V"); a.page.wait_for_timeout(200)
    C.check("(the cause) the editor takes the event (default prevented) and the application handler leaves it alone", P("() => window.__paste") == 1 and P("() => window.__prev") is True)
    a.page.mouse.click(x + 300, y + 300); a.page.wait_for_timeout(300)
    C.check("…so the page holds exactly the one box", items() == [["text", "keepzzz"]], items())

    # ===================================================== 2. paste outside an editor still works
    fresh("select"); a.page.mouse.move(700, 500); a.page.mouse.click(*at(80, 600)); a.page.wait_for_timeout(100)
    clip("OUTSIDE TEXT"); kb.press("Control+V"); a.page.wait_for_timeout(400)
    C.check("Ctrl+V with no editor open: the application pastes the text as one new text box", items() == [["text", "OUTSIDE TEXT"]], items())
    fresh("select"); clip("button paste"); a.page.locator('.panel.active button[title^="Paste an image"]').first.click(); a.page.wait_for_timeout(500)
    C.check("the Paste button still pastes the clipboard text (once)", items() == [["text", "button paste"]], items())
    # ===================================================== 3. pictures
    fresh("select"); img_event("document.body"); a.page.wait_for_timeout(500)
    C.check("an image on the clipboard, no editor: it is inserted as an image item", [i[0] for i in items()] == ["image"], items())
    fresh("text"); x, y = at(150, 200); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); kb.type("abc", delay=10); img_event("document.activeElement"); a.page.wait_for_timeout(500)
    C.check("an image alone pasted while typing is still inserted (the editor cannot hold it) and the typed text is kept", sorted(i[0] for i in items()) == ["image", "text"] and ["text", "abc"] in items(), items())
    fresh("text"); x, y = at(150, 200); a.page.mouse.click(x, y); a.page.wait_for_timeout(200); kb.type("q", delay=10)
    P("""async () => { const c = document.createElement('canvas'); c.width = 20; c.height = 20; const b = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'x.png', { type: 'image/png' })); dt.setData('text/plain', ' with text');
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""")
    a.page.wait_for_timeout(400); a.page.mouse.click(x + 300, y + 300); a.page.wait_for_timeout(300)
    C.check("image + text together while typing: the text goes into the box once, no second box", [i for i in items() if i[0] == "text"] == [["text", "q with text"]], items())
    # a text paste into the search box / other inputs must not reach the page
    fresh("select"); n0 = len(items()); P("() => noteflow.panels.nb.render()")
    inp = a.page.locator("input[type=text], input:not([type])").first
    if inp.count():
        try:
            inp.focus(); clip("not for the page"); kb.press("Control+V"); a.page.wait_for_timeout(300)
            C.check("a text input elsewhere: its own paste only, nothing is added to the page", len(items()) == n0, items())
        except Exception as ex: C.check("a text input elsewhere", False, str(ex))

    # ===================================================== 4. the countdown notice and the 15 s default
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(400)
    P(PDF_JS, PARA); until("() => noteflow.panels.pdf.pages.length === 2 && noteflow.panels.pdf.pdf.hash"); P("async () => { await noteflow.panels.pdf.goto(0); }")
    def notes(*texts):
        P("""async (ts) => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: ts.map((t, i) => ({ t: 'text', x: 60, y: 120 + i * 80, text: t, color: '#1a1a1a', size: 16 })) }], null); await nb.goto(0); }""", list(texts)); a.page.wait_for_timeout(250)
    SG = lambda: P("() => noteflow.smart.suggestions.map((s) => ({ left: s.left, key: s.key }))")
    def scan():
        P("() => noteflow.smart.scan({ manual: true })"); until("() => !noteflow.smart.scanning"); a.page.wait_for_timeout(250)
    C.check("the default time of a suggestion is 15 seconds", P("() => noteflow.smart.ttl") == 15000)
    P("""() => { window.__live = new Set(); window.__max = 0; const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
        window.setInterval = (f, d, ...r) => { const id = si(f, d, ...r); if (d === 250) { window.__live.add(id); window.__max = Math.max(window.__max, window.__live.size); } return id; };
        window.clearInterval = (id) => { window.__live.delete(id); return ci(id); }; noteflow.smart.setMode('suggest', { silent: true }); }""")
    a.page.mouse.move(300, 300)
    # a real 15 s suggestion
    notes(NOTES[0]); scan(); t0 = time.time(); l0 = SG()[0]["left"]
    C.check("a new suggestion starts with the full 15 s (counting has begun)", 14000 < l0 <= 15000, l0)
    clk = a.page.locator(".smartcard .sugclock"); txt0 = clk.inner_text()
    C.check("…and says so", re.fullmatch(r"1[45] s", txt0 or "") is not None, txt0)
    until("() => noteflow.smart.suggestions.length === 0", timeout=22000); dt = time.time() - t0
    C.check("it expires after about 15 s", 14.0 < dt < 17.5, round(dt, 1))
    C.check("…as 'Not related' (remembered), with no link", P("() => noteflow.links.store.rejects.size") == 1 and P("() => noteflow.links.store.size") == 0)
    # the no-results notice
    P("() => { noteflow.smart.ttl = 5000; }")
    notes("Gardening tomatoes need sunshine and regular watering during the summer months"); scan()
    box = a.page.locator(".smartcard .screp")
    C.check("Check now with no match: the notice is shown", box.count() == 1 and "No strong match" in box.inner_text(), box.inner_text())
    C.check("…with a countdown, a progress bar and the same look as a suggestion (same classes)", a.page.locator(".smartcard .screp .sugclock").count() == 1 and a.page.locator(".smartcard .screp .sugbar").count() == 1 and "sug" in box.get_attribute("class").split())
    n_a = a.page.locator(".smartcard .screp .sugclock").inner_text()
    C.check("the countdown reads seconds, from the start", re.fullmatch(r"[45] s", n_a or "") is not None, n_a)
    r0 = P("() => noteflow.smart.report.left"); a.page.wait_for_timeout(1200); r1 = P("() => noteflow.smart.report.left")
    C.check("it counts down in real time", 900 < r0 - r1 < 1600, (r0, r1))
    b = box.bounding_box(); a.page.mouse.move(b["x"] + 40, b["y"] + 20); a.page.wait_for_timeout(300); h0 = P("() => noteflow.smart.report.left"); a.page.wait_for_timeout(1400); h1 = P("() => noteflow.smart.report.left")
    C.check("it waits while the pointer is on it", abs(h0 - h1) < 300 and "hold" in box.get_attribute("class"), (h0, h1))
    a.page.mouse.move(300, 300); until("() => noteflow.smart.report === null", timeout=9000)
    C.check("when the time runs out the notice goes away by itself (card hidden, clock stopped, nothing else changed)",
            P("() => noteflow.smart.card.hidden") and P("() => noteflow.smart.clock") == 0 and P("() => noteflow.links.store.size") == 0 and P("() => noteflow.links.store.rejects.size") == 1)
    scan(); a.page.locator(".smartcard .schead button").click(); a.page.wait_for_timeout(200)
    C.check("manual close still works at once, and nothing fires later", P("() => noteflow.smart.card.hidden") and P("() => noteflow.smart.report") is None and P("() => noteflow.smart.clock") == 0)
    a.page.wait_for_timeout(5600)
    C.check("…(after its time would have ended nothing happens)", P("() => noteflow.smart.card.hidden") and not a.errors, a.errors)
    scan(); a.page.wait_for_timeout(1500); old_left = P("() => noteflow.smart.report.left"); scan(); new_left = P("() => noteflow.smart.report.left")
    C.check("Check now again gives a new notice with a new full time (it is a new answer)", old_left < 3600 and new_left > 4500, (old_left, new_left))
    ws = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); await noteflow.restore(await WS.readWorkspace(await blob.arrayBuffer()));
        return [!!noteflow.smart.clock, noteflow.smart.counted().length, noteflow.smart.card.hidden]; }""")
    C.check("saved and reopened with the notice open: the clock runs only if something is on screen to count", (ws[0] == (ws[1] > 0)), ws)
    a.page.wait_for_timeout(6000)
    C.check("…and what was on screen is gone after its time (no stale timer)", P("() => noteflow.smart.counted().length") == 0 and P("() => noteflow.smart.clock") == 0)
    # queued suggestions: only 3 are shown, the 4th starts its time when it becomes visible; a rescan keeps what is left
    P("() => { noteflow.smart.ttl = 8000; noteflow.links.store.rejects.clear(); }"); notes(*NOTES); scan(); s = SG()
    C.check("four notes: four suggestions, three shown", len(s) == 4 and a.page.locator(".smartcard .sug").count() == 3, [x["left"] for x in s])
    C.check("the three shown have their time running; the queued one has not started", sum(1 for x in s if x["left"] is not None) == 3 and s[3]["left"] is None, [x["left"] for x in s])
    a.page.wait_for_timeout(1500); before = [x["left"] for x in SG()]; scan(); after = [x["left"] for x in SG()]
    C.check("a rescan keeps the remaining time of the visible ones (not restarted)", all(after[i] is not None and after[i] <= before[i] + 50 for i in range(3)) and after[3] is None, (before, after))
    a.page.locator(".smartcard button", has_text="Not related").first.click(); a.page.mouse.move(300, 300); a.page.wait_for_timeout(400); s2 = SG()
    C.check("when one is dismissed the queued one becomes visible and starts with the full time", len(s2) == 3 and all(x["left"] is not None for x in s2) and max(x["left"] for x in s2) > 7400, [x["left"] for x in s2])
    until("() => noteflow.smart.suggestions.length === 0", timeout=12000); until("() => !noteflow.smart.clock", timeout=12000)
    C.check("all expire; never a link; one clock at any moment", P("() => noteflow.links.store.size") == 0 and P("() => window.__max") == 1, P("() => window.__max"))
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
