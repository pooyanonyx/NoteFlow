"""PDF navigation in the side panel: page thumbnails (drawn lazily, bounded memory), the PDF's own outline, bookmarks (saved with the workspace)."""
import sys, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

PDF_JS = """async ([n, withOutline]) => { const { PDFDocument, StandardFonts, PDFName, PDFHexString } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) { const p = doc.addPage([595, 842]); p.drawText('Page number ' + i, { x: 60, y: 760, size: 24, font: f }); }
  if (withOutline) { const ctx = doc.context, pages = doc.getPages(); const root = ctx.nextRef(), i1 = ctx.nextRef(), i11 = ctx.nextRef(), i2 = ctx.nextRef();
    const dest = (k) => [pages[k].ref, PDFName.of('Fit')];
    ctx.assign(i1, ctx.obj({ Title: PDFHexString.fromText('Introduction'), Parent: root, Dest: dest(0), First: i11, Last: i11, Count: 1, Next: i2 }));
    ctx.assign(i11, ctx.obj({ Title: PDFHexString.fromText('Background'), Parent: i1, Dest: dest(2) }));
    ctx.assign(i2, ctx.obj({ Title: PDFHexString.fromText('Results'), Parent: root, Dest: dest(5), Prev: i1 }));
    ctx.assign(root, ctx.obj({ Type: 'Outlines', First: i1, Last: i2, Count: 3 })); doc.catalog.set(PDFName.of('Outlines'), root); }
  return await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'big.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900)
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=25000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(300)
    P(PDF_JS, [150, True]); until("() => noteflow.panels.pdf.pages.length === 150 && noteflow.panels.pdf.pdf.hash")
    P("() => noteflow.setActive(noteflow.panels.pdf)")
    a.page.locator('.topbar button[title^="Side panel"]').click(); a.page.locator('.srctab[data-tab="pages"]').click(); a.page.wait_for_timeout(1500)
    drawn = lambda: P("() => [...document.querySelectorAll('.thcv')].filter((c) => c.width > 0).length")
    C.check("Pages tab: one cell per page (150), thumbnails only for what is in view (not all 150)", P("() => document.querySelectorAll('.thcell').length") == 150 and 1 <= drawn() <= 40, drawn())
    C.check("…and the thumbnail really shows the page (dark text pixels on white)", P("""() => { const c = [...document.querySelectorAll('.thcv')].find((c) => c.width > 0), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let w = 0, k = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 240) w++; else if (d[i] < 200) k++; } return w > 100 && k > 5; }"""))
    # scroll through everything: the number kept in memory stays bounded
    for k in range(0, 150, 6):
        P("(k) => { const g = document.querySelector('.srcbody'); g.scrollTop = k * 175; }", k); a.page.wait_for_timeout(120)
    a.page.wait_for_timeout(1500)
    C.check("after scrolling through all 150 pages at most 60 thumbnails are kept in memory (the rest are freed)", 1 <= drawn() <= 60, drawn())
    P("() => { document.querySelector('.srcbody').scrollTop = 0; }"); a.page.wait_for_timeout(1200)
    C.check("thumbnails that scrolled away come back when needed", drawn() >= 1 and P("() => document.querySelector('.thcell:first-child .thcv').width") > 0)
    a.page.locator(".thcell").nth(11).click(); a.page.wait_for_timeout(600)
    C.check("clicking a thumbnail goes to that page and marks it as the current one", P("() => noteflow.panels.pdf.shown()") == 11 and a.page.locator(".thcell.here").count() == 1 and a.page.locator(".thcell").nth(11).get_attribute("aria-current") == "page")
    P("""async () => { const L = noteflow.links, nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [{ t: 'text', id: 'q1', x: 60, y: 120, w: 300, text: 'A note that cites page three of this document', color: '#1a1a1a', size: 16 }] }], null);
        L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(noteflow.panels.pdf, 2)); noteflow.setActive(noteflow.panels.pdf); }""")
    a.page.wait_for_timeout(500)
    C.check("a page with a link shows a badge with the number of links", a.page.locator(".thcell").nth(2).locator(".thbadge").inner_text().strip() == "1")
    # bookmarks
    a.page.locator("button", has_text="Bookmark this page").click(); a.page.wait_for_timeout(400)
    h = P("() => noteflow.panels.pdf.pdf.hash")
    C.check("Bookmark this page adds a bookmark (a star on the thumbnail)", P("(h) => noteflow.bookmarks.list(h).map((b) => b.page)", h) == [11] and "★" in a.page.locator(".thcell").nth(11).locator(".thbadge").inner_text())
    a.page.locator('.srctab[data-tab="outline"]').click(); a.page.wait_for_timeout(700)
    txt = " | ".join(l for l in a.page.locator(".srcbody").inner_text().splitlines() if l.strip())
    C.check("Outline tab: the bookmarks first, then the PDF's own outline with its levels and page numbers", "bookmarks (1)" in txt.lower() and "Page 12" in txt and "Introduction" in txt and "Background" in txt and "Results" in txt, txt)
    pad = P("() => [...document.querySelectorAll('.srcgo.outl')].map((b) => parseInt(b.style.paddingInlineStart))")
    C.check("the sub-entry is indented under its parent", len(pad) == 3 and pad[1] > pad[0] and pad[2] == pad[0], pad)
    a.page.locator(".srcgo.outl", has_text="Results").click(); a.page.wait_for_timeout(600)
    C.check("clicking an outline entry goes to its page", P("() => noteflow.panels.pdf.shown()") == 5)
    a.page.locator('.srcrow button[title="Rename this bookmark"]').click(); a.page.wait_for_timeout(150)
    a.page.keyboard.press("Control+A"); a.page.keyboard.type("Key figure"); a.page.keyboard.press("Enter"); a.page.wait_for_timeout(400)
    C.check("a bookmark can be renamed (pencil button, type, Enter)", P("(h) => noteflow.bookmarks.list(h)[0].label", h) == "Key figure")
    a.page.locator(".srcrow", has_text="Key figure").locator(".srcgo").click(); a.page.wait_for_timeout(500)
    C.check("clicking a bookmark goes to its page", P("() => noteflow.panels.pdf.shown()") == 11)
    ws = P("""async (h) => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); const ws = await WS.readWorkspace(await blob.arrayBuffer());
        return JSON.stringify(ws.settings.bookmarks && ws.settings.bookmarks[h]); }""", h)
    C.check("bookmarks are saved in the workspace file", ws == '[{"page":11,"label":"Key figure"}]', ws)
    P("async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); noteflow.bookmarks.clear(); await noteflow.restore(await WS.readWorkspace(await blob.arrayBuffer())); }"); a.page.wait_for_timeout(1500)
    C.check("…and come back when the workspace is opened", P("(h) => noteflow.bookmarks.list(h).length", h) == 1, P("(h) => noteflow.bookmarks.list(h).length", h))
    # no outline
    P(PDF_JS, [6, False]); until("() => noteflow.panels.pdf.pages.length === 6 && noteflow.panels.pdf.pdf.hash"); P("() => noteflow.setActive(noteflow.panels.pdf)")
    a.page.locator('.srctab[data-tab="outline"]').click(); a.page.wait_for_timeout(700)
    C.check("a PDF without an outline says so", "no outline of its own" in a.page.locator(".srcbody").inner_text())
    # closing frees everything
    a.page.locator('.srctab[data-tab="pages"]').click(); a.page.wait_for_timeout(600)
    a.page.locator(".sources .srchead > button").click(); a.page.wait_for_timeout(300)
    C.check("closing the panel drops the thumbnails, the observer and the listeners", P("() => noteflow.sources.thumbs === null && noteflow.sources.off === null && noteflow.sources.offBm === null") and P("() => document.querySelectorAll('.thcv').length") == 0)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
