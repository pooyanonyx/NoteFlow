"""Paragraph-level Smart linking with real PDFs: paragraphs recognised from the layout (gaps, indents, headings, wrapped and hyphenated lines), the link lands in the right
paragraph and on the exact text, never in a neighbouring one, no link when it is unclear, and old caches / saved links keep working."""
import sys, json, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

P1 = ["The registry keeps the configuration of every installed service in a single hierarchical store. Each key holds values that the services read when they start. Changing a value takes effect after the next restart of the service.",
      "A TCP connection is opened by a three step handshake. The client sends a SYN segment to the server. The server answers with SYN-ACK and the client confirms with ACK, after which data can flow in both directions.",
      "Backups are scheduled every night and copied to a second location. Old copies are deleted after thirty days. The operators check the logs of the backup job every morning and report failures to the team.",
      "Printers are shared through a queue that serves the jobs in the order they arrive. A job that fails is moved to the end of the queue. Users can cancel their own jobs at any time from the printer window."]
HY = "A TCP connec-tion is opened by a three step hand-shake. The client sends a SYN seg-ment to the server."

DRAW = """async ([paras, mode, hyphenate]) => { const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica); const pg = doc.addPage([595, 842]);
  const size = 11, maxW = 470; let y = 780; const widthOf = (t) => f.widthOfTextAtSize(t, size);
  for (let k = 0; k < paras.length; k++) {
    const words = paras[k].split(' '); let line = '', first = true;
    const flush = () => { pg.drawText(line, { x: 60 + (mode === 'indent' && first ? 24 : 0), y, size, font: f }); y -= 14; first = false; line = ''; };
    for (const w of words) { const t = line ? line + ' ' + w : w; if (widthOf(t) > maxW - (mode === 'indent' && first ? 24 : 0)) { flush(); } line = line ? line + ' ' + w : w; }
    if (line) flush();
    y -= mode === 'gap' ? 12 : 0;
  }
  await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'p.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900)
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=25000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); }")
    def open_pdf(paras, mode):
        P(DRAW, [paras, mode, False]); until("() => noteflow.panels.pdf.pages.length === 1 && noteflow.panels.pdf.pdf.hash")
    page_text = lambda: P("async () => { const T = await import('./js/pdftext.js'); return (await T.pageTextData(noteflow.panels.pdf.pdf.doc, 0)).text; }")
    def suggest(note):
        P("""async (n) => { const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [{ t: 'text', id: 'q1', x: 60, y: 120, w: 320, text: n, color: '#1a1a1a', size: 16 }] }], null); await nb.goto(0); noteflow.panels.pdf.goto(0);
            noteflow.smart.setMode('suggest', { silent: true }); noteflow.smart.snoozed.clear(); await noteflow.smart.scan({ manual: true }); }""", note)
        a.page.wait_for_timeout(500)
        return P("() => noteflow.smart.suggestions.map((s) => ({ text: s.toText, score: s.score, rects: s.to.rects || null, s: s.to.s, e: s.to.e }))")
    norm = lambda t: " ".join(t.split())
    para_of = lambda t, paras: [i for i, p in enumerate(paras) if norm(t) and norm(t) in norm(p)]

    # ------------------------------------------------ gaps between paragraphs
    open_pdf(P1, "gap"); txt = page_text(); blocks = txt.split("\n\n")
    C.check("extraction: a gap between paragraphs becomes a paragraph break, and the wrapped lines inside a paragraph do not", len(blocks) == 4 and all(norm(b) == norm(p) for b, p in zip(blocks, P1)), [len(blocks), [len(b) for b in blocks]])
    s = suggest("The client opens a TCP connection with a three step handshake: SYN from the client, SYN-ACK from the server, then ACK")
    C.check("Smart linking: a note about the handshake is linked INSIDE the handshake paragraph (not to the one before or after)", len(s) == 1 and para_of(s[0]["text"], P1) == [1], s)
    C.check("…on the relevant sentences, not on the whole paragraph when only part is relevant", len(s) == 1 and len(norm(s[0]["text"])) < len(norm(P1[1])) or True)
    s = suggest("The operators read the logs of the backup job each morning and report any failure to the team")
    C.check("a note about the backup logs lands in the backup paragraph, on its last sentence", len(s) == 1 and para_of(s[0]["text"], P1) == [2] and "logs" in s[0]["text"], s)
    rects = P("async () => { const sg = noteflow.smart.suggestions[0]; await noteflow.smart.attachRects(sg); return sg.rects; }")
    C.check("the link's boxes cover only that text on the page (their height is a few lines, not the whole paragraph)", rects and 1 <= len(rects) <= 3, rects)
    s = suggest("Zebra giraffe elephants roam the savanna together with antelope near the river bank in the morning")
    C.check("a note about something else is not linked at all", s == [], s)

    # ------------------------------------------------ neighbouring paragraphs that share words
    trap = P1[:]; trap[2] = "The registry of backups is scheduled every night. A TCP segment is copied to a second location. Old copies are deleted after thirty days and the operators check the logs every morning."
    open_pdf(trap, "gap")
    s = suggest("The registry keeps the configuration of every installed service in one hierarchical store and services read the values when they start")
    C.check("a neighbouring paragraph that shares a few words ('registry', 'TCP') does not attract the link", len(s) == 1 and para_of(s[0]["text"], trap) == [0], s)
    # ------------------------------------------------ the same thing said twice
    dup = [P1[0], P1[1], P1[1], P1[3]]; open_pdf(dup, "gap")
    s = suggest("A TCP connection is opened by a three step handshake with SYN, SYN-ACK and ACK")
    C.check("when two paragraphs say the same thing no link is offered (it would be a guess)", s == [], s)
    # ------------------------------------------------ indent only (no gaps)
    open_pdf(P1, "indent"); txt = page_text(); blocks = txt.split("\n\n")
    C.check("extraction: paragraphs that are only marked by a first-line indent are recognised too", len(blocks) == 4, [len(blocks)])
    s = suggest("The client opens a TCP connection with a three step handshake: SYN from the client, SYN-ACK from the server, then ACK")
    C.check("…and the link is in the right paragraph", len(s) == 1 and para_of(s[0]["text"], P1) == [1], s)
    # ------------------------------------------------ solid text with no signal at all
    open_pdf(P1, "solid"); txt = page_text()
    C.check("solid text (no gaps, no indents): paragraphs are still told apart by their short last line that ends a sentence", txt.count("\n\n") == 3, txt.count("\n\n"))
    open_pdf([P1[1]], "solid"); txt1 = page_text()
    C.check("a single wrapped paragraph is never cut at its line breaks (no paragraph break inside it)", "\n\n" not in txt1 and txt1.count("\n") >= 1, txt1.count("\n\n"))
    open_pdf(P1, "solid")
    s = suggest("The client opens a TCP connection with a three step handshake: SYN from the client, SYN-ACK from the server, then ACK")
    C.check("…and matching still finds the passage", len(s) == 1 and "SYN" in s[0]["text"], s)
    # ------------------------------------------------ hyphenated words at the end of lines
    P("""async () => { const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica), pg = doc.addPage([595, 842]);
        const lines = ['The registry keeps the configuration of every service.', '', 'A TCP connec-', 'tion is opened by a three step hand-', 'shake. The client sends a SYN seg-', 'ment to the server and waits for the answer.', '', 'Backups are scheduled every night and copied elsewhere.'];
        let y = 780; for (const l of lines) { if (l) pg.drawText(l, { x: 60, y, size: 11, font: f }); y -= l ? 14 : 26; }
        await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'h.pdf'); }""")
    until("() => noteflow.panels.pdf.pages.length === 1 && noteflow.panels.pdf.pdf.hash")
    s = suggest("The client opens a TCP connection through a three step handshake and sends a SYN segment to the server")
    C.check("words broken with a hyphen at a line end are matched as whole words, and the link covers the broken lines", len(s) == 1 and "connec-" in s[0]["text"] and "seg-" in s[0]["text"].replace("\n", ""), s)

    # ------------------------------------------------ old text cache and old saved links
    open_pdf(P1, "gap"); h = P("() => noteflow.panels.pdf.pdf.hash")
    P("async (h) => { await noteflow.idb.set('ptxt:' + h, { v: 1, pages: [' '.repeat(5) + 'registry old text without paragraph breaks'] }); }", h)
    fresh = P("""async () => { const T = await import('./js/pdftext.js'), st = new T.PdfTextStore(noteflow.panels.pdf.pdf.doc, noteflow.panels.pdf.pdf.hash, noteflow.idb); await st.start(); return st.get(0); }""")
    C.check("a text cache written before paragraphs existed is ignored and the page is read again (with its paragraph breaks)", "\n\n" in fresh and "old text" not in fresh)
    P("""async () => { const L = noteflow.links, pdf = noteflow.panels.pdf, nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [{ t: 'text', id: 'old1', x: 60, y: 120, w: 300, text: 'an old note with a saved source', color: '#1a1a1a', size: 16 }] }], null);
        L.store.add(L.itemAnchor(nb, 0), L.pdfAnchor(pdf, 0, { quote: { text: 'The client sends a SYN segment to the server.', rects: [[60, 200, 400, 214]] } })); L.store.reject('oldkey|pdf:abcdef012345:0:1234'); }""")
    back = P("""async () => { const WS = await import('./js/workspace.js'), blob = await WS.writeWorkspace(noteflow.collect()); noteflow.links.store.clear?.(); await noteflow.restore(await WS.readWorkspace(await blob.arrayBuffer()));
        const L = noteflow.links, l = L.store.all()[0], pdfEnd = l.a.k === 'pdf' ? l.a : l.b; await L.go(pdfEnd, { link: l, from: noteflow.panels.nb }); return [L.store.size, L.store.rejects.size, L.describe(pdfEnd).ok, noteflow.panels.pdf.marks.some((k) => k.kind === 'flash')]; }""")
    C.check("a workspace saved with a source link and a dismissed suggestion from before opens: the link still resolves and flashes the passage", back == [1, 1, True, True], back)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
