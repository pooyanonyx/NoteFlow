"""The Sources tab: one card per link (PDF source + passage, the note, labelled buttons), a scope you choose that never changes by itself, broken links, suggestions, and
"Quote from PDF" (only the selected text goes into the note; the source stays in the link)."""
import sys, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

PARA = ("The registry keeps the configuration of every installed service in a single hierarchical store. Backups are scheduled every night and are copied to a second location for safety. "
        "The TCP handshake establishes a reliable connection using three steps: SYN, SYN-ACK and ACK. Printers are shared through a queue that serves the jobs in the order they arrive.")
PDF_JS = """async (para) => { const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i++) { const p = doc.addPage([595, 842]); p.drawText(i === 1 ? para : 'Page ' + i + ' of the sample document about vegetable gardening and compost.', { x: 60, y: 760, size: 11, font: f, maxWidth: 470, lineHeight: 15 }); }
  return await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'net.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); m = a.page.mouse
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=20000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    flat = lambda s: " | ".join(l for l in s.splitlines() if l.strip())
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(400)
    P(PDF_JS, PARA); until("() => noteflow.panels.pdf.pages.length === 12 && noteflow.panels.pdf.pdf.hash")
    P("""async () => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [
        { t: 'text', id: 'n1', x: 60, y: 120, w: 300, text: 'Handshake: three steps to open a TCP connection reliably', color: '#1a1a1a', size: 16 },
        { t: 'text', id: 'n2', x: 60, y: 200, w: 300, text: 'Region note about the diagram on this page of the document', color: '#1a1a1a', size: 16 },
        { t: 'text', id: 'n3', x: 60, y: 280, w: 300, text: 'A long note that cites nothing at all, so Sources lists it', color: '#1a1a1a', size: 16 },
        { t: 'text', x: 60, y: 360, w: 100, text: 'short', color: '#1a1a1a', size: 16 }] }, { paper: 'lined', items: [] }], null); await nb.goto(0);
      const L = noteflow.links, pdf = noteflow.panels.pdf;
      L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(pdf, 2, { quote: { text: 'The TCP handshake establishes a reliable connection', rects: [[60, 98, 300, 112]] } }));
      L.store.add(L.itemAnchor(nb, 1), L.pdfAnchor(pdf, 2, { rect: [300, 450, 450, 560] }));
      L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(pdf, 7)); await pdf.goto(2); noteflow.setActive(pdf); }""")
    a.page.wait_for_timeout(600)
    side = a.page.locator('.topbar button[title^="Side panel"]'); aside = a.page.locator(".sources"); body = a.page.locator(".srcbody")
    n0 = P("() => noteflow.links.store.listeners.size")
    C.check("the panel is closed at first and costs nothing", aside.is_hidden() and n0 == P("() => noteflow.links.store.listeners.size"))
    side.click(); a.page.wait_for_timeout(500)
    C.check("opened while reading the PDF, it shows the PDF page scope (the button is selected) with the page named", aside.is_visible() and a.page.locator('.srcscope [aria-checked="true"]').inner_text() == "PDF page" and "net.pdf · page 3" in body.inner_text())
    cards = a.page.locator(".card")
    C.check("a card per link to this page (2)", cards.count() == 2 and "notes citing this page (2)" in flat(body.inner_text()).lower())
    c1 = flat(cards.nth(0).inner_text())
    C.check("a passage card says: PDF source, the file and page, 'Passage', the quoted text, 'Your note' and the note text", all(x in c1 for x in ["PDF SOURCE", "net.pdf · page 3", "Passage", "The TCP handshake establishes a reliable connection", "YOUR NOTE", "Handshake: three steps"]) , c1)
    c2 = flat(cards.nth(1).inner_text())
    C.check("a region card is tagged 'Region' and has no quote", "Region" in c2 and "Passage" not in c2 and a.page.locator(".card blockquote").count() == 1, c2)
    btns = [b for b in cards.nth(0).locator("button").all_inner_texts()]
    C.check("every card has the same three labelled buttons: Open in PDF, Show note, Unlink (nothing else on a card is clickable)", btns == ["Open in PDF", "Show note", "Unlink"] and P("() => [...document.querySelectorAll('.card')].every((c) => !c.onclick && c.querySelectorAll('a, [role=button]').length === 0)"), btns)
    # buttons navigate, the list stays
    before = flat(body.inner_text())
    cards.nth(0).locator("button", has_text="Show note").click(); a.page.wait_for_timeout(700)
    C.check("'Show note' goes to the note in the notebook (and flashes it)", P("() => noteflow.active.kind") == "nb" and P("() => noteflow.panels.nb.marks.some((k) => k.kind === 'flash')"))
    C.check("…and the list does NOT change by itself (same scope, same cards)", flat(body.inner_text()) == before and a.page.locator('.srcscope [aria-checked="true"]').inner_text() == "PDF page")
    cards.nth(0).locator("button", has_text="Open in PDF").click(); a.page.wait_for_timeout(700)
    C.check("'Open in PDF' goes to the passage's page and flashes the passage", P("() => noteflow.active.kind") == "pdf" and P("() => noteflow.panels.pdf.shown()") == 2 and P("() => noteflow.panels.pdf.marks.some((k) => k.kind === 'flash')"))
    C.check("…and again the list is unchanged", flat(body.inner_text()) == before)
    # scopes
    a.page.locator(".srcscope button", has_text="Notebook page").click(); a.page.wait_for_timeout(300)
    t = flat(body.inner_text()).lower()
    C.check("Notebook page scope: the links of the notes on that page, in the same card layout, with the page named", "notebook" in t and "links on this page (3)" in t and a.page.locator(".card").count() == 3, t[:200])
    C.check("…and the longer notes that cite nothing are listed apart, plainly ('Notes with no source'); short notes are not", "notes with no source (1)" in t and "a long note that cites nothing" in t and "short" not in t.split("notes with no source")[1])
    a.page.locator(".srcplain button", has_text="Show").click(); a.page.wait_for_timeout(500)
    C.check("its Show button selects that note", P("() => noteflow.panels.nb.selected") == 2)
    a.page.locator(".srcscope button", has_text="Everything").click(); a.page.wait_for_timeout(300)
    t = flat(body.inner_text()).lower()
    C.check("Everything scope: all links grouped under their PDF page (page 3: 2 links, page 8: 1)", "3 links in this workspace" in t and "net.pdf · page 3" in t and "net.pdf · page 8" in t and a.page.locator(".card").count() == 3, t[:240])
    # unlink
    n_links = P("() => noteflow.links.store.size")
    a.page.locator(".card", has_text="Region").locator("button", has_text="Unlink").click(); a.page.wait_for_timeout(400)
    C.check("Unlink removes just that link (the note and the PDF are untouched)", P("() => noteflow.links.store.size") == n_links - 1 and P("() => noteflow.panels.nb.items.length") == 4 and a.page.locator(".card").count() == 2)
    # broken link
    P("""() => { const L = noteflow.links, nb = noteflow.panels.nb; L.store.add(L.itemAnchor(nb, 2), { k: 'pdf', doc: 'ab'.repeat(32), name: 'gone.pdf', page: 4, pv: 'Page 5' }); }""")
    a.page.wait_for_timeout(400)
    bad = a.page.locator(".card.broken")
    C.check("a link whose PDF is not open is marked as broken on its card, saying why", bad.count() == 1 and "This link is broken" in bad.inner_text() and "gone.pdf" in bad.inner_text(), bad.inner_text() if bad.count() else "")
    bad.locator("button", has_text="Unlink").click(); a.page.wait_for_timeout(300)
    # suggestion
    P("""() => { const s = noteflow.smart; s.suggestions = [{ key: 'k1', score: 0.8, noteText: 'note text', toText: 'pdf text', noteToks: [], toToks: [], shared: [], to: { kind: 'pdf', page: 0 }, left: null }]; s.draw(); noteflow.sources.render(); }""")
    sg = a.page.locator(".srcsugg")
    C.check("waiting Smart linking suggestions are announced at the top, apart from the cards ('1 suggested link waiting')", sg.count() == 1 and "1 suggested link waiting" in sg.inner_text())
    P("() => { noteflow.smart.later(); }"); sg.locator("button", has_text="Review").click() if sg.count() else None
    P("() => { noteflow.smart.suggestions = []; noteflow.smart.draw(); noteflow.sources.render(); }")
    # ---------------------------------------------------------- Quote from PDF
    a.page.locator(".srcscope button", has_text="PDF page").click(); P("async () => { noteflow.panels.pdf.goto(0); noteflow.setActive(noteflow.panels.pdf); }"); a.page.wait_for_timeout(500)
    a.page.locator(".sources button.linkact[data-action=quote]").click(); a.page.wait_for_timeout(200)
    g = a.page.locator(".linkguide:not(.snipcard)").inner_text()
    C.check("Quote starts a one-step mode with a guide", "Quote" in g and "drag across text" in g.lower(), g)
    def screen(i, x, y): return P("([i, x, y]) => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }", [i, x, y])
    m.click(*screen(0, 300, 400)); a.page.wait_for_timeout(250)
    C.check("a tap that is not a text passage makes no quote", P("() => noteflow.panels.nb.items.length") == 4 and P("() => noteflow.links.picking"))
    x, y = screen(0, 62, 76); x2, y2 = screen(0, 330, 76)
    m.move(x, y); m.down(); m.move((x + x2) / 2, y, steps=4); m.move(x2, y2, steps=4); m.up(); a.page.wait_for_timeout(600)
    q = P("""() => { const L = noteflow.links, nb = noteflow.panels.nb, d = nb.items[nb.items.length - 1], links = d.id ? L.store.forItem(d.id) : []; const l = links[0], pdfEnd = l && (l.a.k === 'pdf' ? l.a : l.b);
        return { text: d.text, runs: d.runs || null, n: nb.items.length, links: links.length, pdf: pdfEnd && { name: pdfEnd.name, page: pdfEnd.page, quote: pdfEnd.quote && pdfEnd.quote.text, rects: pdfEnd.quote && pdfEnd.quote.rects.length } }; }""")
    norm = lambda s: " ".join(s.split())
    C.check("ONLY the selected text is inserted into the note: no file name, no page number, no quotation marks, no added line", q["n"] == 5 and q["text"] and "net.pdf" not in q["text"] and "p. 1" not in q["text"] and "page" not in q["text"].lower().replace("page.", "") and not q["text"].startswith("“") and "\n" not in q["text"] and q["runs"] is None and norm(q["text"]) in norm(PARA), q)
    C.check("the note text is exactly the passage that was linked", q["pdf"] and norm(q["text"]) == norm(q["pdf"]["quote"]), q)
    C.check("the source is kept in the link: file name, page, the passage and its boxes", q["links"] == 1 and q["pdf"]["name"] == "net.pdf" and q["pdf"]["page"] == 0 and q["pdf"]["rects"] >= 1, q)
    a.page.wait_for_timeout(300)
    card = a.page.locator(".card", has_text="registry")
    C.check("the Sources card shows the attribution separately: the PDF source line and the passage, and the note", card.count() == 1 and "net.pdf · page 1" in card.inner_text() and "Passage" in card.inner_text())
    P("() => noteflow.setActive(noteflow.panels.nb)")
    P("""() => { const L = noteflow.links, nb = noteflow.panels.nb, d = nb.items[nb.items.length - 1], l = L.store.forItem(d.id)[0]; L.go(l.a.k === 'pdf' ? l.a : l.b, { link: l, from: nb }); }""")
    a.page.wait_for_timeout(700)
    C.check("from the quote you can still get to the source: following its link opens the PDF at that page and flashes the passage", P("() => noteflow.active.kind") == "pdf" and P("() => noteflow.panels.pdf.shown()") == 0 and P("() => noteflow.panels.pdf.marks.some((k) => k.kind === 'flash')"))
    C.check("the quote can be edited like any text without touching its source link", P("""() => { const nb = noteflow.panels.nb, i = nb.items.length - 1, d = nb.items[i], id = d.id; const items = nb.items.slice(); items[i] = { ...d, text: d.text + ' (my comment)' }; nb.commit(items); return noteflow.links.store.forItem(id).length; }""") == 1)
    P("() => { noteflow.panels.nb.undo(); noteflow.panels.nb.undo(); }"); a.page.wait_for_timeout(300)
    C.check("Undo removes the quote and its link together", P("() => noteflow.panels.nb.items.length") == 4 and P("() => noteflow.links.store.size") == 2)
    a.page.locator(".sources .srchead > button").click(); a.page.wait_for_timeout(200)
    C.check("closing the panel removes its listeners and timer", aside.is_hidden() and P("() => noteflow.links.store.listeners.size") == n0 and P("() => noteflow.sources.timer") == 0)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
