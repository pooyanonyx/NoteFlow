"""Resources: nothing runs while the app is idle, panels and dialogs leave nothing behind when closed (listeners, DOM, timers, memory), a 1000-page PDF and a large workspace
stay quick and bounded."""
import sys, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900)
    P = lambda js, arg=None: a.ev(js, arg)
    def until(js, arg=None, timeout=60000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    # ------------------------------------------------ idle
    P("""() => { window.__renders = 0; window.__long = []; for (const p of Object.values(noteflow.panels)) { const o = p.render.bind(p); p.render = (...x) => { window.__renders++; return o(...x); }; }
        window.__ints = new Set(); const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window); window.setInterval = (f, d, ...r) => { const id = si(f, d, ...r); window.__ints.add(id); return id; }; window.clearInterval = (id) => { window.__ints.delete(id); return ci(id); };
        window.__writes = 0; const o2 = noteflow.idb.batch.bind(noteflow.idb); noteflow.idb.batch = (...x) => { window.__writes++; return o2(...x); };
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) {} }""")
    a.page.wait_for_timeout(4000)                                    # (the one-off snapshot of the session after start is written in this time)
    P("() => { window.__renders = 0; window.__writes = 0; window.__long.length = 0; }"); a.page.wait_for_timeout(4000)
    idle = P("() => ({ r: window.__renders, ints: window.__ints.size, w: window.__writes, long: window.__long.length, smart: noteflow.smart.timer, clock: noteflow.smart.clock })")
    C.check("idle for 4 s (after start-up): nothing is redrawn, no interval timer is running, nothing is written, no long task", idle["r"] <= 1 and idle["ints"] == 0 and idle["w"] == 0 and idle["long"] == 0, idle)
    C.check("Smart linking is off by default and has no timer, no worker", idle["smart"] == 0 and idle["clock"] == 0 and P("async () => (await import('./js/matcher.js')).workerActive()") is False)
    # ------------------------------------------------ open / close cycles leave nothing behind
    def snapshot(): return P("() => ({ nodes: document.querySelectorAll('*').length, lis: noteflow.links.store.listeners.size, bm: noteflow.bookmarks.listeners.size, timer: noteflow.sources.timer, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 })")
    gear = a.page.locator('.topbar button[title^="Settings"]'); side = a.page.locator('.topbar button[title^="Side panel"]')
    s0 = snapshot()
    for i in range(25):
        gear.click(); a.page.wait_for_timeout(40); a.page.keyboard.press("Escape")
        side.click(); a.page.locator('.srctab[data-tab="%s"]' % ["sources", "pages", "outline"][i % 3]).click(); a.page.wait_for_timeout(40); side.click()
    a.page.wait_for_timeout(500); s1 = snapshot()
    C.check("25 cycles of opening and closing Settings and the side panel: the same number of DOM nodes, listeners and timers", abs(s1["nodes"] - s0["nodes"]) <= 4 and s1["lis"] == s0["lis"] and s1["bm"] == s0["bm"] and s1["timer"] == 0, [s0, s1])
    # ------------------------------------------------ a 1000-page PDF
    t = P("""async () => { const { PDFDocument } = PDFLib; const doc = await PDFDocument.create(); for (let i = 0; i < 1000; i++) doc.addPage([595, 842]); const bytes = await doc.save();
        await noteflow.setLayout(['pdf','nb'], false); const t0 = performance.now(); await noteflow.panels.pdf.openPdfBytes(bytes, 'huge.pdf'); return [Math.round(performance.now() - t0), bytes.length]; }""")
    C.check("a 1000-page PDF opens quickly", t[0] < 8000, t)
    P("() => noteflow.setActive(noteflow.panels.pdf)")
    t2 = P("""async () => { const t0 = performance.now(); noteflow.sources.setTab('pages'); await new Promise((r) => setTimeout(r, 1500)); const c = [...document.querySelectorAll('.thcv')]; return [document.querySelectorAll('.thcell').length, c.filter((x) => x.width > 0).length, Math.round(performance.now() - t0)]; }""")
    C.check("the Pages tab of 1000 pages builds at once and draws only what is in view", t2[0] == 1000 and 1 <= t2[1] <= 40, t2)
    a.page.wait_for_timeout(200)
    P("() => noteflow.sources.setOpen(false)")
    pages = P("() => noteflow.panels.pdf.pages.length"); mem = P("() => performance.memory ? performance.memory.usedJSHeapSize : 0")
    C.check("memory after closing the side panel on a 1000-page PDF stays modest (under 250 MB of JS heap)", mem == 0 or mem < 250e6, round(mem / 1e6))
    # ------------------------------------------------ a large workspace: save and open
    big = P("""async () => { const pages = []; for (let p = 0; p < 200; p++) { const items = []; for (let i = 0; i < 40; i++) items.push(i % 2 ? { t: 'text', x: 60, y: 40 + i * 18, w: 300, text: 'Note ' + p + ' line ' + i + ' with some words', color: '#1a1a1a', size: 14 } : { t: 'pen', pts: Array.from({ length: 30 }, (_, j) => [60 + j * 6, 40 + i * 18 + Math.sin(j) * 4]), color: '#000000', w: 2 }); pages.push({ paper: 'lined', items }); }
        await noteflow.panels.nb.setNotebook(pages, null); const WS = await import('./js/workspace.js'); let t0 = performance.now(); const blob = await WS.writeWorkspace(noteflow.collect()); const tw = performance.now() - t0;
        t0 = performance.now(); const ws = await WS.readWorkspace(await blob.arrayBuffer()); await noteflow.restore(ws); const tr = performance.now() - t0; return [Math.round(tw), Math.round(tr), blob.size, noteflow.panels.nb.pages.length]; }""")
    C.check("a workspace with a 200-page notebook (8000 items) is written in under 4 s and opened in under 5 s", big[0] < 4000 and big[1] < 5000 and big[3] == 200, big)
    # ------------------------------------------------ the console stays clean
    C.check("no page errors or console errors during all of this", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
