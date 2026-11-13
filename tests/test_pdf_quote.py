"""Quoting from a PDF is exact: whatever the layout of the PDF (two columns drawn line by line across both, words drawn in any order, wrapped and hyphenated lines, paragraphs, a
list), a real mouse drag across text puts exactly the dragged-over words, in reading order, with the paragraphs kept, into the Notebook. No file name, no page number. The source
stays in the link. Real PDFs built with pdf-lib, real mouse events."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

BUILD = """async (spec) => { const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (const pg of spec) { const p = doc.addPage([595, 842]); for (const [t, x, y, s] of pg) p.drawText(t, { x, y: 842 - y, size: s || 10, font: f }); }
  return await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'layouts.pdf'); }"""

L = ["The first column starts here and", "keeps going with some more words", "until the end of its third line", "and then the fourth line follows"]
R = ["Second column opens on the right", "and also keeps going down the", "page with a few more words in", "it before the last line of all."]
page_cols = [[("A heading across the whole page for both columns", 50, 60, 12)]]
for i in range(4): page_cols[0] += [(L[i], 50, 100 + i * 14), (R[i], 320, 100 + i * 14)]                     # drawn: left, right, left, right ... (not column by column)
words = "Shuffled words are still read in the order they stand on the page".split()
page_shuf = [[]]; x = 60
for w in words: page_shuf[0].append((w, x, 100)); x += len(w) * 5.6 + 5
page_shuf[0] = page_shuf[0][::-1]                                                                            # drawn from the last word to the first
page_wrap = [[("The reliable transmission of data over an unreliable net-", 60, 100), ("work needs acknowledgements and a clear timer for every packet.", 60, 114),
              ("A second paragraph starts here after a gap and says that", 60, 150), ("queues serve the jobs in the order they arrive.", 60, 164),
              ("1. first item of a list", 60, 200), ("2. second item of the list", 60, 214)]]

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900); m = a.page.mouse; P = lambda js, arg=None: a.ev(js, arg)
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }"); a.page.wait_for_timeout(400)
    P(BUILD, page_cols + page_shuf + page_wrap); a.page.wait_for_function("() => noteflow.panels.pdf.pages.length === 3 && noteflow.panels.pdf.pdf.hash", timeout=20000)
    P("async () => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'blank', items: [] }], null); await nb.goto(0); noteflow.setActive(noteflow.panels.pdf); }")
    # where are the characters? (the real text model of the page, in page points)
    P("async () => { const { pageTextData } = await import('./js/pdftext.js'); window.__pt = async (i) => pageTextData(noteflow.panels.pdf.pdf.doc || noteflow.panels.pdf.pdf, i); }")

    def spot(page, first, last):
        """Screen points: the middle of the first character of the `first` occurrence... and of the last character of `last` (the first word that STARTS the selection / ends it)."""
        return P("""async ([i, first, last]) => { const d = await window.__pt(i), p = noteflow.panels.pdf; p.goto(i); await new Promise((r) => setTimeout(r, 400));
          const w1 = d.words.filter((w) => d.text.slice(w.start, w.end) === first)[0], w2 = d.words.filter((w) => d.text.slice(w.start, w.end) === last)[0];
          if (!w1 || !w2) throw new Error('word not found in: ' + JSON.stringify(d.text)); const r = p.stage.getBoundingClientRect(), s1 = p.pageToScreenAt(i, (w1.cl[0] + w1.cr[0]) / 2 - 0.4, (w1.y0 + w1.y1) / 2), k = w2.cl.length - 1, s2 = p.pageToScreenAt(i, (w2.cl[k] + w2.cr[k]) / 2 + 0.4, (w2.y0 + w2.y1) / 2);
          return [r.left + s1[0], r.top + s1[1], r.left + s2[0], r.top + s2[1]]; }""", [page, first, last])

    def quote(page, first, last):
        a.page.wait_for_timeout(100)
        pts = spot(page, first, last)
        P("() => { noteflow.setActive(noteflow.panels.pdf); noteflow.links.quote(); }"); a.page.wait_for_timeout(200)
        m.move(pts[0], pts[1]); m.down(); m.move((pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2, steps=5); m.move(pts[2], pts[3], steps=6); m.up(); a.page.wait_for_timeout(700)
        return P("""() => { const L = noteflow.links, nb = noteflow.panels.nb, d = nb.items[nb.items.length - 1], l = d && d.id ? L.store.forItem(d.id)[0] : null, e = l && (l.a.k === 'pdf' ? l.a : l.b);
          return { text: d && d.text, n: nb.items.length, src: e && { name: e.name, page: e.page, quote: e.quote && e.quote.text } }; }""")

    q = quote(0, "keeps", "third")
    C.check("two columns drawn line by line across both: a selection in column 1 is exactly its own words, in order", q["text"] == "keeps going with some more words until the end of its third", q)
    q = quote(0, "fourth", "Second")
    C.check("a selection from the end of column 1 into the start of column 2", q["text"].replace("\n\n", " ") == "fourth line follows Second", q)        # (a new column starts a new paragraph)
    q = quote(0, "heading", "page")
    C.check("a heading across both columns is its own line", q["text"] == "heading across the whole page", q)
    q = quote(1, "Shuffled", "stand")
    C.check("words drawn in reverse order are quoted in the order they stand on the page", q["text"] == "Shuffled words are still read in the order they stand", q)
    q = quote(2, "transmission", "packet.")
    C.check("a hyphenated line break is joined, a wrap is a space", q["text"] == "transmission of data over an unreliable network needs acknowledgements and a clear timer for every packet.", q)
    q = quote(2, "reliable", "arrive.")
    C.check("from the first paragraph into the second: one blank line between them", q["text"].count("\n\n") == 1 and q["text"].split("\n\n")[0].endswith("packet.") and q["text"].split("\n\n")[1].endswith("arrive."), q)
    q = quote(2, "1.", "2.")
    C.check("a list: one item per line, no blank lines", q["text"] == "1. first item of a list\n2.", q)
    C.check("no file name, no page number, no quotation marks in the inserted text", all(x not in q["text"] for x in ("layouts", "page ", "p. ", "\u201c", "\u201d")), q)
    C.check("the source is in the link (file, page, same passage), not in the text", q["src"] and q["src"]["name"] == "layouts.pdf" and q["src"]["page"] == 2 and " ".join(q["src"]["quote"].split()) == " ".join(q["text"].split()), q)
    C.check("no page errors", not a.errors, a.errors[:3])
    ok = C.summary(); a.browser.close(); sys.exit(0 if ok else 1)
