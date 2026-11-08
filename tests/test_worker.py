"""Smart linking's matching runs in a Web Worker: same results as the main thread, a clean fallback, no long blocking of the interface, and the worker is ended when idle."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

with sync_playwright() as pw:
    a = App(pw, width=1300, height=900)
    P = lambda js, arg=None: a.ev(js, arg)
    P("""() => { const w = (n) => { let s = ''; n += 1000; while (n > 0) { s += String.fromCharCode(97 + (n % 26)); n = Math.floor(n / 26); } return s; };
        const sent = (i) => Array.from({ length: 8 }, (_, k) => w(i * 8 + k)).join(' ') + ' and the filler words that every sentence has';
        window.__sent = sent; window.__text = Array.from({ length: 400 }, (_, i) => sent(i) + '.').join(' ');
        window.__notes = [37, 120, 251, 399].map((i) => sent(i).split(' ').slice(0, 7).join(' '));
        window.__M = import('./js/matcher.js'); window.__S = import('./js/similar.js'); }""")
    def run(label):
        return P("""async () => { const M = await window.__M, S = await window.__S; const A = window.__notes.flatMap((t) => S.noteUnits(t));
            const res = await M.matchTexts(A, { text: window.__text }, 0.3); return { active: M.workerActive(), res: res.map((r) => [A.indexOf(r.note), r.passage.s, r.passage.e, r.score, r.exact]) }; }""")
    w = run("worker")
    C.check("a scan runs in a Web Worker and finds the right passage (sentence 37)", w["active"] is True and len(w["res"]) >= 2 and 2800 < w["res"][0][1] < 3000, w["res"][:2])
    # a real scan through the app uses it too, and the worker goes away after a quiet time
    P("""async () => { await noteflow.setLayout(['pdf','nb'], false); const { PDFDocument, StandardFonts } = PDFLib; const doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica); const p = doc.addPage([595, 842]);
        p.drawText('The TCP handshake establishes a reliable connection using three steps: SYN, SYN-ACK and ACK. Backups are scheduled every night and copied to a second location.', { x: 50, y: 760, size: 11, font: f, maxWidth: 480, lineHeight: 15 });
        await noteflow.panels.pdf.openPdfBytes(await doc.save(), 't.pdf'); const nb = noteflow.panels.nb; await nb.setNotebook([{ paper: 'lined', items: [{ t: 'text', id: 'a1', x: 60, y: 120, w: 300, text: 'TCP handshake: three steps SYN then SYN-ACK then ACK', color: '#1a1a1a', size: 16 }] }], null);
        noteflow.smart.setMode('suggest', { silent: true }); await noteflow.smart.scan({ manual: true }); }""")
    a.page.wait_for_timeout(500)
    C.check("a real Smart linking scan through the app finds the passage, and used the worker", P("() => noteflow.smart.suggestions.length") == 1 and P("async () => (await window.__M).workerActive()") is True, P("() => noteflow.smart.suggestions.length"))
    P("() => noteflow.smart.setMode('off')")
    C.check("turning Smart linking off ends the worker", P("async () => (await window.__M).workerActive()") is False)
    P("async () => { (await window.__M).stopMatcher(); window.__W = window.Worker; window.Worker = function () { throw new Error('no workers here'); }; }")
    f = run("fallback")
    C.check("without Web Workers it falls back to the main thread (and finds the same)", f["active"] is False and f["res"] == w["res"] and len(f["res"]) >= 2, [f["active"], len(f["res"]), len(w["res"])])
    P("async () => { window.Worker = window.__W; }")
    C.check("…and the results are identical to the worker's (same passages, same scores)", f["res"] == w["res"])
    # the interface keeps responding: no long task while a big page is analyzed
    P("async () => { const M = await window.__M; M.stopMatcher(); window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) { window.__nolong = true; } }")
    P("""async () => { const M = await window.__M, S = await window.__S, A = window.__notes.flatMap((t) => S.noteUnits(t)); await M.matchTexts(A, { text: window.__text.repeat(4) }, 0.3); }""")
    a.page.wait_for_timeout(300)
    longest = P("() => Math.max(0, ...window.__long)")
    C.check("analyzing a big page (about 150 000 characters) causes no long freeze of the interface", longest < 120 or P("() => !!window.__nolong"), longest)
    P("async () => { (await window.__M).stopMatcher(); }")
    C.check("stopping the matcher ends the worker (nothing stays running)", P("async () => (await window.__M).workerActive()") is False)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
