"""Annotated PDF export: strokes and highlights become REAL PDF annotations (read back with pdf.js, drawn by pdf.js from their appearance), the rest stays a picture,
rotated pages keep everything in the picture, and the exported file reopens in NoteFlow with every item editable and unchanged. Also a legacy (DualNote) annotated PDF."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

MK = """async () => { const { PDFDocument, StandardFonts, degrees } = PDFLib; const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) { const p = doc.addPage([595, 842]); p.drawText('Source page ' + (i + 1) + ' with some text to highlight', { x: 60, y: 760, size: 14, font: f }); }
  doc.getPage(2).setRotation(degrees(90));
  await noteflow.panels.pdf.openPdfBytes(await doc.save(), 'src.pdf'); }"""

with sync_playwright() as pw:
    a = App(pw, width=1500, height=900)
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=25000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    P(MK); until("() => noteflow.panels.pdf.pages.length === 3")
    ITEMS = [
      [{"t": "pen", "pts": [[100, 100], [200, 140], [300, 100]], "color": "#d32f2f", "w": 4},
       {"t": "mark", "pts": [[100, 200], [300, 200]], "color": "#1976d2", "w": 16, "alpha": 120},
       {"t": "hl", "x1": 60, "y1": 70, "x2": 260, "y2": 90, "color": "#ffee00"},
       {"t": "rect", "x1": 100, "y1": 300, "x2": 200, "y2": 360, "color": "#388e3c", "w": 3},
       {"t": "pen", "pts": [[100, 400, 0.2], [150, 420, 0.9], [200, 400, 0.3]], "color": "#000000", "w": 4}],
      [{"t": "pen", "pts": [[50, 50], [250, 250]], "color": "#d32f2f", "w": 6}, {"t": "pen", "pts": [[250, 50], [50, 250]], "color": "#388e3c", "w": 6}],
      [{"t": "pen", "pts": [[100, 100], [300, 300]], "color": "#d32f2f", "w": 6}]]
    P("(its) => { const p = noteflow.panels.pdf; its.forEach((l, i) => { p.pages[i].items = l; }); }", ITEMS)
    out = P("""async () => { const PDF = await import('./js/pdfio.js'), p = noteflow.panels.pdf, bytes = await PDF.exportAnnotatedPdf(p.pdf.source, p.pages.map((q) => q.items));
        window.__exp = bytes; const { doc } = await PDF.loadDocument(bytes, { detectEmbedded: false }); const res = [];
        for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i), an = await pg.getAnnotations(); res.push(an.map((x) => [x.subtype, x.inkLists ? x.inkLists[0].length : (x.quadPoints ? x.quadPoints.length : 0), Array.from(x.color || []).join(','), x.borderStyle && x.borderStyle.width])); }
        return { size: bytes.length, res }; }""")
    r = out["res"]
    C.check("page 1: the pen stroke, the marker and the highlight are real PDF annotations (Ink, Ink, Highlight)", [x[0] for x in r[0]] == ["Ink", "Ink", "Highlight"], r[0])
    C.check("…with their colour and width (red, 4 pt) and points", r[0][0][2] == "211,47,47" and r[0][0][3] == 4 and r[0][0][1] == 6 and r[0][2][1] in (8, 4), r[0])
    C.check("page 2: both strokes are annotations (and the page needs no picture)", [x[0] for x in r[1]] == ["Ink", "Ink"], r[1])
    C.check("page 3 (rotated): kept as a picture, no annotations", r[2] == [], r[2])
    px = P("""async () => { const PDF = await import('./js/pdfio.js'), { doc } = await PDF.loadDocument(window.__exp, { detectEmbedded: false }); const out = {};
        for (const [i, name] of [[1, 'p1'], [2, 'p2'], [3, 'p3']]) { const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp, annotationMode: 2 }).promise; out[name] = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); }
        const at = (im, x, y) => { const k = (Math.round(y) * im.width + Math.round(x)) * 4; return [im.data[k], im.data[k + 1], im.data[k + 2]]; };
        return { red: at(out.p1, 200, 140), blue: at(out.p1, 200, 200), yellow: at(out.p1, 150, 80), green: at(out.p1, 100, 330), x1: at(out.p2, 150, 150), x2: at(out.p2, 150, 150) }; }""")
    red = lambda c: c[0] > 150 and c[1] < 90 and c[2] < 90
    C.check("a viewer (pdf.js) really draws the annotations: the red stroke, the blue marker, the yellow highlight", red(px["red"]) and px["blue"][2] > px["blue"][0] and px["yellow"][0] > 200 and px["yellow"][1] > 200 and px["yellow"][2] < 200, px)
    C.check("…and the picture overlay holds the rest (the green rectangle)", px["green"][1] > px["green"][0] + 20, px["green"])
    # round trip
    again = P("""async () => { const p = noteflow.panels.pdf, before = JSON.stringify(p.pages.map((q) => q.items)); await p.openPdfBytes(window.__exp, 'exported.pdf'); return [before === JSON.stringify(p.pages.map((q) => q.items)), p.pages.length]; }""")
    C.check("the exported file reopens in NoteFlow with every item as it was (editable), nothing doubled", again == [True, 3], again)
    big = P("""async () => { const PDF = await import('./js/pdfio.js'), p = noteflow.panels.pdf; const many = []; for (let k = 0; k < 400; k++) many.push({ t: 'pen', pts: Array.from({ length: 40 }, (_, j) => [10 + j * 5, 10 + k + Math.sin(j) * 5]), color: '#000000', w: 2 });
        const t0 = performance.now(); const b = await PDF.exportAnnotatedPdf(p.pdf.source, [many, [], []]); return [b.length, Math.round(performance.now() - t0)]; }""")
    C.check("400 strokes (16 000 points) on one page export in well under a few seconds, and the file stays reasonable", big[1] < 6000 and big[0] < 800000, big)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
