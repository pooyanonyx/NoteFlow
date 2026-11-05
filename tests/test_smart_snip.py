"""The Link button in the top bar, Smart linking, and the Snipping tool, driven through the real UI.
Smart linking: compares ONLY the active surfaces (the current page of each visible panel), suggests / confirms / rejects, optional auto-linking, off by default,
tells what it cannot analyze, is stable (does not run while editing, does not repeat itself). Snipping: PDF / Notebook / Board -> copy or insert into any panel."""
import sys, io, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
import numpy as np
from PIL import Image
C = Checker()

NOTE = "The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK"
P20 = "The TCP handshake establishes a reliable connection between two hosts using three steps: the client sends SYN, the server answers with SYN-ACK, and the client confirms with ACK."
P8 = NOTE + "."
PDF_JS = """async ([p20, p8]) => {
  const { PDFDocument, StandardFonts, rgb } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 25; i++) { const p = doc.addPage([595, 842]);
    if (i === 10) { p.drawRectangle({ x: 60, y: 600, width: 200, height: 100, color: rgb(0.2, 0.5, 0.9) }); continue; }       // (page 10: a picture only, no text)
    const t = i === 20 ? p20 : i === 8 ? p8 : 'Filler paragraph number ' + i + ' about vegetable gardening, compost, watering schedules and unrelated seasonal planting advice for beginners.';
    p.drawText(t, { x: 60, y: 700, size: 13, font: f, maxWidth: 470, lineHeight: 17 });
    p.drawRectangle({ x: 60, y: 560, width: 200, height: 90, color: rgb(0.2, 0.5, 0.9) }); }
  const bytes = await doc.save(); return await noteflow.panels.pdf.openPdfBytes(bytes, 'net.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); kb = a.page.keyboard
    a.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=30000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    P("async () => { await noteflow.setLayout(['pdf','nb','board'], false); }"); a.page.wait_for_timeout(500)
    P(PDF_JS, [P20, P8]); until("() => noteflow.panels.pdf.pages.length === 25 && noteflow.panels.pdf.pdf.hash")
    # a notebook of 100 pages: the note is on page 100; page 6 holds a copy of the PDF passage (a trap: it is NOT an active page)
    P("""async ([note, p20]) => { const pages = Array.from({ length: 100 }, () => ({ paper: 'lined', items: [] }));
      const T = (text, y) => ({ t: 'text', x: 60, y, text, color: '#1a1a1a', size: 16 });
      pages[99].items = [T(note, 120), T('Buy milk eggs bread and fresh vegetables tomorrow morning', 260)]; pages[5].items = [T(p20, 120)];
      await noteflow.panels.nb.setNotebook(pages, null); await noteflow.panels.nb.goto(99); }""", [NOTE, P20])
    a.page.wait_for_timeout(300)
    P("async () => { noteflow.panels.nb.zoomBy(0.5); await noteflow.panels.nb.goto(99); }"); a.page.wait_for_timeout(500)
    C.check("the notebook is on page 100 (index 99) and the PDF can be put on page 20", P("() => noteflow.panels.nb.cur") == 99)
    SM = lambda: P("() => noteflow.smart.suggestions.map((s) => ({ page: s.to.page, kind: s.to.kind, score: s.score, nb: s.from.page }))")

    # ================================================================= the Link button in the top bar
    C.check("there is one Link button, in the top bar, and none in the panel toolbars",
            a.page.locator('.topbar button[title^="Link two things"]').count() == 1 and a.page.locator('.panel button[title^="Link two things"], .panel button[title^="Link a note"]').count() == 0)
    P("() => { const b = noteflow.panels.board; b.commit([{ t: 'text', x: 200, y: 200, text: 'Board idea about handshakes', color: '#1a1a1a', size: 20 }]); b.setTool('select'); b.selected = 0; noteflow.setActive(b); }")
    a.page.locator('.topbar button[title^="Link two things"]').click(); a.page.wait_for_timeout(200)
    pk = P("() => noteflow.links.pick && noteflow.links.pick.a")
    C.check("from the Board: Link uses the item selected on the active (board) panel", pk and pk["k"] == "item" and pk["slot"] == "board", pk)
    a.page.keyboard.press("Escape"); a.page.wait_for_timeout(100)
    P("([t]) => { noteflow.panels.board.selected = null; const n = noteflow.panels.nb; n.setTool('select'); n.selected = n.items.findIndex((d) => d.text === t); n.render(); noteflow.setActive(noteflow.panels.pdf); }", [NOTE])
    a.page.locator('.topbar button[title^="Link two things"]').click(); a.page.wait_for_timeout(200)
    pk = P("() => noteflow.links.pick && noteflow.links.pick.a")
    C.check("the active panel (PDF) has nothing selected but the Notebook has: Link uses the Notebook's selection", pk and pk["slot"] == "nb" and pk["pv"].startswith("The TCP"), pk)
    a.page.keyboard.press("Escape"); P("() => { noteflow.panels.nb.selected = null; noteflow.panels.board.selected = null; }")

    # ================================================================= SMART LINKING
    P("async () => { await noteflow.panels.pdf.goto(19); }"); a.page.wait_for_timeout(1500)
    C.check("Smart linking is OFF by default and does nothing on its own", P("() => noteflow.smart.mode") == "off" and P("() => noteflow.smart.stats.scans") == 0 and P("() => noteflow.smart.card.hidden"))
    # manual check works with the mode off, compares only the active pages
    a.ev("() => { noteflow.links.manage(); }"); a.page.wait_for_timeout(300)
    C.check("the Links dialog has the Smart linking setting (Off / Suggest / Suggest + auto), what it does and its limits",
            "Smart linking" in a.page.locator(".dialog").inner_text() and "typed text only" in a.page.locator(".dialog").inner_text() and a.page.locator(".dialog select").count() == 1)
    a.page.get_by_role("button", name="Check the open pages now").click(); until("() => noteflow.smart.stats.scans >= 1 && !noteflow.smart.scanning")
    sg = SM(); read = P("() => noteflow.smart.stats.read")
    C.check("'Check now' suggests the passage on the PDF page being viewed (p. 20) for the note on the notebook page being viewed (p. 100)", len(sg) == 1 and sg[0]["page"] == 19 and sg[0]["nb"] == 99 and 0.55 <= sg[0]["score"] < 0.88, sg)
    C.check("…and it read ONLY the active pages: PDF p. 20, Notebook p. 100, the board's visible area (not PDF p. 8, not Notebook p. 6)",
            all(r in (["pdf", 19], ["nb", 99], ["board", 0]) for r in read) and ["pdf", 19] in read and ["nb", 99] in read, read)
    card = a.page.locator(".smartcard").inner_text()
    C.check("the suggestion card shows both texts, the match percentage and Link / Show / Not related", "Suggested links" in card and "PDF p. 20" in card and "% match" in card and "Not related" in card, card[:160])
    # confirm
    a.page.locator(".smartcard button", has_text="Link").first.click(); a.page.wait_for_timeout(500)
    L = P("() => noteflow.links.store.toJSON().links")
    C.check("confirming makes an ordinary link marked 'suggested' with its confidence, quoting the passage with its boxes",
            len(L) == 1 and L[0]["src"] == "suggested" and 0.55 <= L[0]["score"] < 0.9 and L[0]["b"]["k"] == "pdf" and L[0]["b"]["page"] == 19 and "TCP handshake" in L[0]["b"]["quote"]["text"] and len(L[0]["b"]["quote"]["rects"]) >= 1, L)
    C.check("the card is gone and the same pair is not suggested again", P("() => noteflow.smart.suggestions.length") == 0)
    a.ev("() => { noteflow.links.manage(); }"); a.page.wait_for_timeout(300)
    dlg = a.page.locator(".dialog").inner_text()
    C.check("the list of links shows it as 'Suggested · NN%' (a link the user makes has no such tag)", "Suggested ·" in dlg, dlg[:300])
    a.page.locator(".dialog").get_by_role("button", name="Close", exact=True).click(); a.page.wait_for_timeout(150)
    P("() => { const s = noteflow.links.store; s.add({ k: 'item', id: 'imanual', slot: 'nb' }, { k: 'pdf', doc: noteflow.panels.pdf.pdf.hash, name: 'net.pdf', page: 3 }); }")
    C.check("a link made by hand has no src: smart links are told apart from manual ones", [l for l in P("() => noteflow.links.store.toJSON().links") if l["a"]["id"] == "imanual"][0].get("src") is None)
    P("() => { noteflow.links.store.remove(noteflow.links.store.all().find((l) => l.a.id === 'imanual').id); }")
    # the colours: purple for smart links
    P("async () => { await noteflow.panels.pdf.goto(19); noteflow.panels.pdf.render(); }"); a.page.wait_for_timeout(300)

    # ---- suggest mode: follows the pages being looked at; only active pages; not related is remembered
    P("() => { noteflow.links.store.clear(); noteflow.smart.setMode('suggest', { silent: true }); }")
    until("() => noteflow.smart.suggestions.length === 1 && !noteflow.smart.card.hidden")
    C.check("suggest mode: the suggestion appears by itself once the pages have been still for a moment", SM()[0]["page"] == 19)
    P("async () => { await noteflow.panels.pdf.goto(7); }")
    until("() => noteflow.smart.suggestions.length === 1 && noteflow.smart.suggestions[0].to.page === 7")
    sg = SM()
    C.check("go to PDF p. 8 (a near-verbatim copy of the note): now THAT page is compared, with a much higher match; the p. 20 suggestion is gone", sg[0]["page"] == 7 and sg[0]["score"] > 0.9, sg)
    C.check("the copy of the passage on notebook p. 6 (not the active page) was never suggested", all(s["nb"] == 99 for s in SM()) and all(r in (["pdf", 7], ["nb", 99], ["board", 0]) for r in P("() => noteflow.smart.stats.read")))
    a.page.locator(".smartcard button", has_text="Not related").first.click(); a.page.wait_for_timeout(300)
    C.check("'Not related' removes it and remembers the decision", P("() => noteflow.smart.suggestions.length") == 0 and P("() => noteflow.links.store.rejects.size") == 1)
    n0 = P("() => noteflow.smart.stats.scans"); P("async () => { await noteflow.panels.pdf.goto(19); await noteflow.panels.pdf.goto(7); }"); a.page.wait_for_timeout(5500)
    C.check("it is not suggested again after the pages are visited again", P("() => noteflow.smart.suggestions.length") == 0)
    ws = P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer());
      const had = noteflow.links.store.rejects.size, mode = ws.settings.smartLinking; await noteflow.restore(ws); return [had, ws.links.rejects.length, mode, noteflow.links.store.rejects.size, noteflow.smart.mode]; }""")
    C.check("the setting and the rejected suggestions are saved in the workspace and come back after reopening", ws == [1, 1, "suggest", 1, "suggest"], ws)

    # ---- stability: no scan while the user is typing; no repeated scans for an unchanged view
    P(PDF_JS, [P20, P8]); until("() => noteflow.panels.pdf.pages.length === 25 && noteflow.panels.pdf.pdf.hash")
    P("async ([note]) => { const pages = Array.from({ length: 100 }, () => ({ paper: 'lined', items: [] })); pages[99].items = [{ t: 'text', x: 60, y: 120, text: note, color: '#1a1a1a', size: 16 }]; await noteflow.panels.nb.setNotebook(pages, null); await noteflow.panels.nb.goto(99); await noteflow.panels.pdf.goto(19); }", [NOTE])
    P("() => { noteflow.links.store.clear(); noteflow.smart.snoozed.clear(); noteflow.smart.scannedSig = null; noteflow.smart.seenSig = null; }")
    until("() => noteflow.smart.suggestions.length === 1")
    n1 = P("() => noteflow.smart.stats.scans"); a.page.wait_for_timeout(5000)
    C.check("an unchanged view is scanned once, not again and again", P("() => noteflow.smart.stats.scans") == n1, (n1, P("() => noteflow.smart.stats.scans")))
    P("() => { const n = noteflow.panels.nb; n.setTool('text'); }"); x, y = P("() => { const n = noteflow.panels.nb, r = n.stage.getBoundingClientRect(), [sx, sy] = n.pageToScreenAt(99, 100, 300); return [r.left + sx, r.top + sy]; }")
    a.page.mouse.click(x, y); a.page.wait_for_timeout(200); kb.type("typing now"); n2 = P("() => noteflow.smart.stats.scans"); a.page.wait_for_timeout(5000)
    C.check("nothing is scanned while the user is typing in a text box", P("() => noteflow.smart.stats.scans") == n2 and P("() => !!noteflow.panels.nb.editing"))
    kb.press("Escape")
    # off stops everything
    P("() => noteflow.smart.setMode('off', { silent: true })"); a.page.wait_for_timeout(300)
    n3 = P("() => noteflow.smart.stats.scans"); P("async () => { await noteflow.panels.pdf.goto(3); await noteflow.panels.pdf.goto(19); }"); a.page.wait_for_timeout(4500)
    C.check("turning it off clears the suggestions and stops all scanning", P("() => noteflow.smart.stats.scans") == n3 and P("() => noteflow.smart.suggestions.length") == 0 and P("() => noteflow.smart.card.hidden") and P("() => noteflow.smart.timer") == 0)

    # ---- auto mode: links on its own when confident (page 20 has a single sentence, so the stricter bar for tiny pages, .70, applies); weaker matches stay suggestions; auto links are marked and removable
    P("async ([n]) => { const pdf = noteflow.panels.pdf; noteflow.links.store.clear(); const nb = noteflow.panels.nb; await nb.goto(99); nb.commit([...nb.items, { t: 'text', x: 60, y: 300, text: 'The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK', color: '#1a1a1a', size: 16 }]); await pdf.goto(7); }", [NOTE])
    P("() => { noteflow.smart.snoozed.clear(); noteflow.smart.scannedSig = null; noteflow.smart.seenSig = null; noteflow.smart.setMode('auto', { silent: true }); }")
    until("() => noteflow.links.store.countSrc('auto') >= 1")
    L = [l for l in P("() => noteflow.links.store.toJSON().links") if l.get("src") == "auto"]
    C.check("auto mode: a near-verbatim match is linked on its own, marked 'auto' with its confidence", len(L) >= 1 and L[0]["score"] >= 0.70 and L[0]["b"]["page"] == 7, L)
    C.check("auto mode: what was linked is never shown as a suggestion (no card, no question)", P("() => noteflow.smart.suggestions.length") == 0 and P("() => noteflow.smart.card.hidden"), P("() => noteflow.smart.suggestions.length"))
    # the paraphrase of page 20 is clearly the same statement (synonyms and word forms are recognised, ~94%), so it is linked on its own
    P("async () => { await noteflow.panels.pdf.goto(19); }")
    until("() => noteflow.links.store.all().some((l) => l.b.page === 19)")
    L19 = [l for l in P("() => noteflow.links.store.toJSON().links") if l["b"]["page"] == 19]
    C.check("…and a clear paraphrase (page 20, ~94% match) is linked on its own too, marked 'auto' with its score", len(L19) >= 1 and all(l.get("src") == "auto" and 0.70 <= l["score"] <= 1 for l in L19), L19)
    a.page.wait_for_timeout(600)
    C.check("…without any suggestion or confirmation", P("() => noteflow.smart.suggestions.length") == 0 and P("() => noteflow.smart.card.hidden"))
    nA = P("() => noteflow.links.store.size")
    # a weaker, merely related restatement (match ~65%, below the .70 bar of a one-sentence page): NOT linked, only suggested for the user to confirm
    WEAK = "TCP connection setup: client sends SYN, server answers with SYN-ACK, hosts exchange segments afterwards"
    P("([t]) => { const nb = noteflow.panels.nb; nb.commit([...nb.items, { t: 'text', x: 60, y: 340, text: t, color: '#1a1a1a', size: 16 }]); }", [WEAK])
    until("() => noteflow.smart.suggestions.length >= 1 && noteflow.smart.suggestions.some((s) => s.noteText.startsWith('TCP connection setup'))")
    wk = [s for s in P("() => noteflow.smart.suggestions.map((s) => ({ t: s.noteText, score: s.score, page: s.to.page }))") if s["t"].startswith("TCP connection setup")][0]
    C.check("auto mode: a weaker match is only suggested (score between the suggestion and the auto bar), and no link is made for it", 0.30 <= wk["score"] < 0.70 and wk["page"] == 19 and P("() => noteflow.links.store.size") == nA, wk)
    until("() => document.querySelector('.smartcard') && !document.querySelector('.smartcard').hidden")
    a.page.locator(".smartcard button", has_text="Link").first.click(); a.page.wait_for_timeout(400)
    C.check("…and confirming it makes a 'suggested' link, as before", P("() => noteflow.links.store.countSrc('suggested')") == 1 and P("() => noteflow.links.store.size") == nA + 1)
    a.ev("() => { noteflow.links.manage(); }"); a.page.wait_for_timeout(300)
    C.check("the dialog counts the automatic links and can remove them all", "Remove" in a.page.locator(".dialog").inner_text() and "automatic link" in a.page.locator(".dialog").inner_text() and "Auto ·" in a.page.locator(".dialog").inner_text())
    a.page.get_by_role("button", name=re.compile(r"Remove \d+ automatic link")).click(); a.page.wait_for_timeout(300)
    C.check("…and they are gone", P("() => noteflow.links.store.countSrc('auto')") == 0)
    a.page.locator(".dialog").get_by_role("button", name="Close", exact=True).click(); P("() => noteflow.smart.setMode('off', { silent: true })")

    # ---- limits are explained, not hidden
    P("async () => { noteflow.links.store.clear(); await noteflow.panels.pdf.goto(9); }"); a.page.wait_for_timeout(300)
    P("() => noteflow.smart.scan({ manual: true })"); until("() => noteflow.smart.stats.scans >= 1 && !noteflow.smart.scanning && noteflow.smart.report")
    card = a.page.locator(".smartcard").inner_text()
    C.check("a PDF page without selectable text (a picture) is reported as not analyzable, instead of pretending", "no selectable text" in card and "No strong match" in card, card[:260])
    P("async () => { const nb = noteflow.panels.nb; nb.commit([{ t: 'pen', color: '#000000', w: 2, pts: [[10, 10], [60, 40], [90, 20], [120, 60]] }]); await noteflow.panels.pdf.goto(19); }")
    P("() => noteflow.smart.scan({ manual: true })"); a.page.wait_for_timeout(1200); until("() => !noteflow.smart.scanning")
    card = a.page.locator(".smartcard").inner_text()
    C.check("a notebook page with only handwriting is reported as not analyzable", "handwriting" in card.lower(), card[:260])
    a.page.locator(".smartcard button").first.click()
    # ---- speed of a scan on busy pages
    t = P("""async () => { const nb = noteflow.panels.nb; const items = Array.from({ length: 120 }, (_, i) => ({ t: 'text', x: 20, y: 20 + i * 6, text: 'Sentence about topic' + (i % 17) + ' algorithm' + (i % 13) + ' protocol' + (i % 11) + ' module' + (i % 7) + ' behaviour details', color: '#1a1a1a', size: 12 }));
      nb.commit(items); await noteflow.panels.pdf.goto(19); const t0 = performance.now(); await noteflow.smart.scan({ manual: true }); return performance.now() - t0; }""")
    C.check("a scan with 120 notes against a PDF page takes well under 1.5 s", t < 1500, round(t))

    # ================================================================= SNIPPING TOOL
    P("""async () => { await noteflow.setLayout(['pdf','nb','board'], false); const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [{ t: 'text', x: 60, y: 120, text: 'Notebook text to capture', color: '#1a1a1a', size: 20 }, { t: 'rect', x1: 60, y1: 170, x2: 220, y2: 230, color: '#d32f2f', w: 3 }] }], null);
      noteflow.panels.board.setBoard({ paper: 'white', grid: false, items: [{ t: 'rect', x1: 400, y1: 400, x2: 600, y2: 500, color: '#2e7d32', w: 4 }, { t: 'text', x: 410, y: 520, text: 'Board label', color: '#1a1a1a', size: 24 }] }, null); noteflow.panels.pdf.goto(0); }""")
    a.page.wait_for_timeout(600); P("() => { noteflow.panels.nb.zoomBy(0.5); noteflow.panels.board.fit && noteflow.panels.board.fit(); }"); a.page.wait_for_timeout(300)
    def drag(key, i, p0, p1):
        x0, y0 = P("([k, i, x, y]) => { const p = noteflow.panels[k], r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }", [key, i, *p0])
        x1, y1 = P("([k, i, x, y]) => { const p = noteflow.panels[k], r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }", [key, i, *p1])
        a.page.mouse.move(x0, y0); a.page.mouse.down(); a.page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=4); a.page.mouse.move(x1, y1, steps=4); a.page.mouse.up()
    snip = lambda: a.page.locator('.topbar button[title^="Snipping tool"]')
    BB = lambda k: P("(k) => noteflow.panels[k].belowBars(0)", k)                       # (page y just under the floating toolbars: an area that is surely on screen)
    # activation + cancel + too small
    snip().click(); a.page.wait_for_timeout(150)
    C.check("the Snip button in the top bar starts the tool; a card says what to do; every panel gets a crosshair", P("() => noteflow.snip.active") and "Drag a rectangle" in a.page.locator(".snipcard").inner_text() and P("() => Object.values(noteflow.panels).every((p) => p.root.classList.contains('snipping'))"))
    kb.press("Escape"); a.page.wait_for_timeout(150)
    C.check("Esc cancels it", not P("() => noteflow.snip.active") and a.page.locator(".snipcard").is_hidden())
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(150); C.check("Ctrl+Shift+S starts it too", P("() => noteflow.snip.active"))
    drag("pdf", 0, (60, 200), (63, 202)); a.page.wait_for_timeout(300)
    C.check("a tiny drag selects nothing (no capture, still waiting for an area)", not P("() => noteflow.snip.cap") and P("() => noteflow.snip.active"))
    # PDF -> Notebook
    drag("pdf", 0, (50, 135), (280, 262)); until("() => noteflow.snip.cap")
    cap = P("() => ({ w: noteflow.snip.cap.canvas.width, h: noteflow.snip.cap.canvas.height, r: noteflow.snip.cap.rect, blue: (() => { const c = noteflow.snip.cap.canvas, d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [d[0], d[1], d[2]]; })() })")
    rw, rh = cap["r"][2] - cap["r"][0], cap["r"][3] - cap["r"][1]
    C.check("PDF capture: the area is rendered from the PDF itself at >= 2 pixels per point, same aspect ratio, and shows the page content (the blue picture)",
            cap["w"] >= 1.99 * rw and abs(cap["w"] / cap["h"] - rw / rh) < 0.01 and cap["blue"][2] > 180 and cap["blue"][0] < 90, cap)
    C.check("a preview card offers Copy, Insert into each panel (PDF, Notebook, Board) and Retake", all(t in a.page.locator(".snipcard").inner_text() for t in ["Copy", "Notebook", "Board", "PDF", "Retake"]) and a.page.locator(".snipprev").count() == 1)
    n_before = len(P("() => noteflow.panels.nb.items"))
    a.page.locator(".snipcard button", has_text="Notebook").click(); until("() => noteflow.panels.nb.items.some((d) => d.t === 'image')")
    im = P("() => { const p = noteflow.panels.nb, d = p.items.find((x) => x.t === 'image'); return { w: d.x2 - d.x1, h: d.y2 - d.y1, sel: p.selected === p.items.indexOf(d), tool: p.tool, png: d.data.length > 500, active: noteflow.snip.active }; }")
    C.check("insert into the Notebook: an image item of the area's size and aspect ratio, selected (move / resize handles) and the tool is closed",
            abs(im["w"] / im["h"] - rw / rh) < 0.01 and im["sel"] and im["tool"] == "select" and im["png"] and not im["active"], im)
    # move and resize after insertion (real mouse)
    idx = P("() => noteflow.panels.nb.items.findIndex((d) => d.t === 'image')")
    bx, by = P("([i]) => { const p = noteflow.panels.nb, d = p.items[i], r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(p.cur, (d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2); return [r.left + sx, r.top + sy]; }", [idx])
    x1_0 = P("([i]) => noteflow.panels.nb.items[i].x1", [idx])
    a.page.mouse.move(bx, by); a.page.mouse.down(); a.page.mouse.move(bx + 25, by + 40, steps=5); a.page.mouse.up(); a.page.wait_for_timeout(200)
    C.check("the inserted image can be moved by dragging it", P("([i]) => noteflow.panels.nb.items.find((d) => d.t === 'image').x1", [idx]) > x1_0 + 5)
    cx, cy = P("() => { const p = noteflow.panels.nb, d = p.items.find((x) => x.t === 'image'), r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(p.cur, d.x2, d.y2); return [r.left + sx, r.top + sy]; }")
    w0 = P("() => { const d = noteflow.panels.nb.items.find((x) => x.t === 'image'); return d.x2 - d.x1; }")
    a.page.mouse.move(cx, cy); a.page.mouse.down(); a.page.mouse.move(cx + 40, cy + 30, steps=5); a.page.mouse.up(); a.page.wait_for_timeout(200)
    w1, r1 = P("() => { const d = noteflow.panels.nb.items.find((x) => x.t === 'image'); return [d.x2 - d.x1, (d.x2 - d.x1) / (d.y2 - d.y1)]; }")
    C.check("…and resized by its corner handle, keeping its proportions", w1 > w0 + 10 and abs(r1 - rw / rh) < 0.05, (w0, w1, r1))
    # Notebook -> Board
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100)
    drag("nb", 0, (40, 100), (260, 245)); until("() => noteflow.snip.cap")
    nbcap = P("() => { const c = noteflow.snip.cap.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) red++; if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) dark++; } return { red, dark, w: c.width, h: c.height }; }")
    C.check("Notebook capture: paper, text and drawn shapes are in it (red rectangle and dark text pixels)", nbcap["red"] > 200 and nbcap["dark"] > 100, nbcap)
    nb0 = len(P("() => noteflow.panels.board.items"))
    a.page.locator(".snipcard button", has_text="Board").click(); until("(n) => noteflow.panels.board.items.length === n + 1", nb0)
    bi = P("() => noteflow.panels.board.items.find((d) => d.t === 'image')")
    C.check("insert into the Board: an image item with the same aspect ratio", bi and abs((bi["x2"] - bi["x1"]) / (bi["y2"] - bi["y1"]) - nbcap["w"] / nbcap["h"]) < 0.02, bi and [bi["x2"] - bi["x1"], bi["y2"] - bi["y1"]])
    # Board -> Notebook
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100)
    drag("board", 0, (380, 380), (640, 570)); until("() => noteflow.snip.cap")
    bcap = P("() => { const c = noteflow.snip.cap.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let green = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] > 100 && d[i + 2] < 90) green++; return { green, w: c.width, h: c.height }; }")
    C.check("Board capture: the board's content (green rectangle) is in it", bcap["green"] > 200, bcap)
    # Copy
    a.page.locator(".snipcard button", has_text="Copy").click(); a.page.wait_for_timeout(600)
    clip = P("""async () => { const items = await navigator.clipboard.read(); const t = items[0].types.find((x) => x.startsWith('image/')); if (!t) return null; const b = await items[0].getType(t); const bm = await createImageBitmap(b); return [t, bm.width, bm.height]; }""")
    C.check("Copy puts the image (PNG, full captured size) on the clipboard, and ends the tool", clip and clip[0] == "image/png" and clip[1] == bcap["w"] and clip[2] == bcap["h"] and not P("() => noteflow.snip.active"), clip)
    # Pasting it into NoteFlow again (existing paste path)
    n_im = len([d for d in P("() => noteflow.panels.nb.items") if d["t"] == "image"])
    # Retake / cancel with a capture waiting
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100); drag("pdf", 0, (50, 135), (280, 262)); until("() => noteflow.snip.cap")
    a.page.locator(".snipcard button", has_text="Retake").click(); a.page.wait_for_timeout(150)
    C.check("Retake discards the capture and waits for a new area", not P("() => noteflow.snip.cap") and P("() => noteflow.snip.active") and P("() => Object.values(noteflow.panels).every((p) => !p.snipPrev)"))
    drag("pdf", 0, (50, 135), (280, 262)); until("() => noteflow.snip.cap"); kb.press("Escape"); a.page.wait_for_timeout(150)
    C.check("Cancel with a capture waiting leaves everything as it was (no image added)", not P("() => noteflow.snip.active") and len([d for d in P("() => noteflow.panels.nb.items") if d["t"] == "image"]) == n_im)
    # the PDF annotation layer is part of a PDF capture
    P("() => { const p = noteflow.panels.pdf; p.commit([{ t: 'rect', x1: 60, y1: 150, x2: 150, y2: 200, color: '#d32f2f', w: 4 }]); p.render(); }")
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100); drag("pdf", 0, (50, 135), (280, 262)); until("() => noteflow.snip.cap")
    red = P("() => { const c = noteflow.snip.cap.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) n++; return n; }")
    C.check("a PDF capture includes the annotations drawn on the page", red > 300, red)
    a.page.locator(".snipcard button", has_text="PDF (same)").click(); until("() => noteflow.panels.pdf.items.some((d) => d.t === 'image')")
    C.check("it can also be inserted into the same panel (an image on the PDF page)", len([d for d in P("() => noteflow.panels.pdf.items") if d["t"] == "image"]) == 1)
    # saved in the workspace
    sv = P("""async () => { const WS = await import('./js/workspace.js'); const before = noteflow.panels.nb.items.filter((d) => d.t === 'image').map((d) => [d.x2 - d.x1, d.y2 - d.y1, d.data.length]);
      const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer()); await noteflow.restore(ws);
      const after = noteflow.panels.nb.items.filter((d) => d.t === 'image').map((d) => [d.x2 - d.x1, d.y2 - d.y1, d.data.length]); const bd = noteflow.panels.board.items.filter((d) => d.t === 'image').length; return { before, after, bd }; }""")
    C.check("saving and reopening the workspace keeps the inserted images (same size, same PNG data) on the notebook and the board", sv["before"] == sv["after"] and len(sv["after"]) >= 1 and sv["bd"] == 1, sv)
    # layouts
    P("async () => { await noteflow.setLayout(['nb'], false); }"); a.page.wait_for_timeout(400)
    P("async () => { const n = noteflow.panels.nb; n.zoomBy(0.4); await n.goto(0); }"); a.page.wait_for_timeout(500)
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100); drag("nb", 0, (40, BB("nb") + 30), (200, BB("nb") + 130)); until("() => noteflow.snip.cap")
    tg = a.page.locator(".snipcard .snipact").inner_text()
    C.check("with a single-panel layout the capture can be inserted into that panel (only the visible panels are offered)", "Notebook (same)" in tg and "Board" not in tg and "PDF" not in tg, tg)
    kb.press("Escape")
    P("async () => { await noteflow.setLayout(['board', 'nb'], false); }"); a.page.wait_for_timeout(400)
    P("async () => { const n = noteflow.panels.nb; n.zoomBy(0.5); await n.goto(0); }"); a.page.wait_for_timeout(500)
    kb.press("Control+Shift+S"); a.page.wait_for_timeout(100); drag("nb", 0, (40, BB("nb") + 30), (200, BB("nb") + 130)); until("() => noteflow.snip.cap")
    C.check("with another layout (Board + Notebook) the targets follow the layout", "Board" in a.page.locator(".snipcard .snipact").inner_text() and "PDF" not in a.page.locator(".snipcard .snipact").inner_text())
    kb.press("Escape")
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
