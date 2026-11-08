"""The Sources panel (follows the page, backlinks, other pages with notes, broken links, notes without a source), and "Quote a passage"."""
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
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(400)
    P(PDF_JS, PARA); until("() => noteflow.panels.pdf.pages.length === 12 && noteflow.panels.pdf.pdf.hash")
    P("""async () => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [
        { t: 'text', id: 'n1', x: 60, y: 120, w: 300, text: 'Handshake: three steps to open a TCP connection reliably', color: '#1a1a1a', size: 16 },
        { t: 'text', id: 'n2', x: 60, y: 200, w: 300, text: 'Region note about the diagram on this page of the document', color: '#1a1a1a', size: 16 },
        { t: 'text', id: 'n3', x: 60, y: 280, w: 300, text: 'A long note that cites nothing at all, so Sources lists it', color: '#1a1a1a', size: 16 },
        { t: 'text', x: 60, y: 360, w: 100, text: 'short', color: '#1a1a1a', size: 16 }] }, { paper: 'lined', items: [] }], null); await nb.goto(0);
      const L = noteflow.links, pdf = noteflow.panels.pdf, items = nb.items;
      L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(pdf, 2, { quote: { text: 'The TCP handshake establishes a reliable connection', rects: [[60, 98, 300, 112]] } }));
      L.store.add(L.itemAnchor(nb, 1), L.pdfAnchor(pdf, 2, { rect: [300, 450, 450, 560] }));
      L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(pdf, 7)); await pdf.goto(2); }""")
    a.page.wait_for_timeout(600)
    btn = a.page.locator('.topbar button[title^="Side panel"]'); panel = a.page.locator(".srcbody")
    C.check("the Sources panel is closed at first and costs nothing (no listener, no timer)", a.page.locator(".sources").is_hidden() and P("() => noteflow.links.store.listeners.size") == P("() => noteflow.links.store.listeners.size"))
    n0 = P("() => noteflow.links.store.listeners.size"); P("() => noteflow.setActive(noteflow.panels.pdf)"); btn.click(); a.page.wait_for_timeout(500)
    C.check("the Sources button opens it, docked at the right (the panels give it room)", a.page.locator(".sources").is_visible() and "on" in btn.get_attribute("class") and P("() => noteflow.links.store.listeners.size") == n0 + 1)
    flat = lambda s: " | ".join(l for l in s.splitlines() if l.strip()).lower()
    txt = flat(panel.inner_text())
    C.check("on a PDF page it names the page and lists the notes that cite it, with the cited passage", "net.pdf · page 3" in txt and "notes citing this page (2)" in txt and "the tcp handshake establishes" in txt and "a region of this page" in txt, txt[:300])
    C.check("…and the other pages that have notes", "p. 8 · 1" in txt, txt)
    P("async () => { await noteflow.panels.pdf.goto(7); }"); a.page.wait_for_timeout(500)
    t2 = flat(panel.inner_text())
    C.check("scrolling the PDF to another page updates it (page 8: one note; page 3 now listed under other pages)", "page 8" in t2 and "notes citing this page (1)" in t2 and "p. 3 · 2" in t2, t2[:260])
    P("async () => { await noteflow.panels.pdf.goto(2); }"); a.page.wait_for_timeout(500)
    a.page.locator(".srcgo", has_text="Handshake").first.click(); a.page.wait_for_timeout(700)
    C.check("clicking a note jumps to it in the notebook (and flashes it)", P("() => noteflow.active.kind") == "nb" and P("() => noteflow.panels.nb.marks.some((k) => k.kind === 'flash')"), P("() => noteflow.active.kind"))
    t3 = flat(panel.inner_text())
    C.check("now on the notebook page it shows the sources the notes cite (backlinks) and the long note with no source", "sources used on this page (2)" in t3 and "net.pdf · p. 3" in t3 and "notes without a source (1)" in t3 and "a long note that cites nothing" in t3 and "short" not in t3.split("notes without a source")[1], t3[:400])
    a.page.locator(".srcrow", has_text="A long note that cites nothing").locator(".srcgo").click(); a.page.wait_for_timeout(500)
    C.check("clicking a note without a source selects it", P("() => noteflow.panels.nb.selected") == 2)
    a.page.locator(".srcgo", has_text="net.pdf · p. 3").first.click(); a.page.wait_for_timeout(700)
    C.check("clicking a source goes to the PDF passage", P("() => noteflow.active.kind") == "pdf" and P("() => noteflow.panels.pdf.shown()") == 2)
    # remove from the panel
    n_links = P("() => noteflow.links.store.size")
    a.page.locator(".srcrow", has_text="A region of this page").locator(".srcx").click(); a.page.wait_for_timeout(500)
    C.check("the × of a row removes just that link (and the panel updates)", P("() => noteflow.links.store.size") == n_links - 1 and "notes citing this page (1)" in flat(panel.inner_text()))
    # broken links
    P("async () => { await noteflow.panels.pdf.closePdf?.(); }"); a.page.wait_for_timeout(100)
    # quote
    P("async () => { noteflow.panels.pdf.goto(0); noteflow.setActive(noteflow.panels.pdf); }"); a.page.wait_for_timeout(500)
    a.page.locator(".sources button", has_text="Quote a passage").click(); a.page.wait_for_timeout(200)
    g = a.page.locator(".linkguide:not(.snipcard)").inner_text()
    C.check("Quote a passage starts a one-step mode with a guide", "Quote" in g and "drag across text" in g.lower(), g)
    def screen(i, x, y): return P("([i, x, y]) => { const p = noteflow.panels.pdf, r = p.stage.getBoundingClientRect(), [sx, sy] = p.pageToScreenAt(i, x, y); return [r.left + sx, r.top + sy]; }", [i, x, y])
    # tapping the page (not a passage) is refused
    m.click(*screen(0, 300, 400)); a.page.wait_for_timeout(250)
    C.check("a tap that is not a text passage makes no quote", P("() => noteflow.panels.nb.items.length") == 4 and P("() => noteflow.links.picking"))
    x, y = screen(0, 62, 76); x2, y2 = screen(0, 330, 76)
    m.move(x, y); m.down(); m.move((x + x2) / 2, y, steps=4); m.move(x2, y2, steps=4); m.up(); a.page.wait_for_timeout(600)
    nb_items = P("() => noteflow.panels.nb.items.map((d) => [d.text, d.id || null])")
    q = [i for i in nb_items if i[0] and i[0].startswith("“")]
    C.check("dragging across text puts the passage into the notebook as a quote with its source line", len(q) == 1 and "registry" in q[0][0] and "— net.pdf, p. 1" in q[0][0], nb_items)
    C.check("…linked to the passage (the link carries the quote text and boxes), and the mode is over", P("() => !noteflow.links.picking") and P("""() => { const l = noteflow.links.store.all().filter((l) => (l.a.quote || l.b.quote) && l.a.id !== 'n1' && l.b.id !== 'n1'); return l.length === 1 && l.some((x) => (x.a.quote || x.b.quote).rects.length >= 1); }"""))
    a.page.wait_for_timeout(400)
    C.check("the quote appears in Sources at once (on the PDF page 1 it cites)", "notes citing this page (1)" in flat(panel.inner_text()) and "registry" in flat(panel.inner_text()), flat(panel.inner_text())[:200])
    P("() => noteflow.panels.nb.undo()"); a.page.wait_for_timeout(300)
    C.check("Undo removes the quote and its link together (one step)", P("() => noteflow.panels.nb.items.length") == 4 and "notes citing this page (1)" not in flat(panel.inner_text()))
    # closing
    a.page.locator(".sources .srchead > button").click(); a.page.wait_for_timeout(200)
    C.check("closing the panel removes its listener and timer", a.page.locator(".sources").is_hidden() and P("() => noteflow.links.store.listeners.size") == n0 and P("() => noteflow.sources.timer") == 0)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
