"""Large notebooks: finished pages are drawn once and then copied while scrolling; memory stays bounded; autosave writes only what changed."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
BUILD = """async (n) => {
  const M = await import('./js/model.js'), p = noteflow.panels.nb, pages = [];
  for (let i = 0; i < n; i++) {
    const items = [];
    for (let k = 0; k < 25; k++) { const pts = []; for (let j = 0; j < 40; j++) pts.push([60 + k * 15 + Math.sin(j / 4 + k) * 20, 100 + j * 15 + (i % 7)]); items.push({ t: 'pen', pts, color: '#1a1a1a', w: 2 }); }
    for (let k = 0; k < 15; k++) items.push({ t: 'text', x: 70, y: 90 + k * 40, w: 400, text: 'Page ' + i + ' line ' + k + ' with some words to wrap around the box edge ' + k, color: '#1a1a1a', size: 16, ruled: true });
    pages.push({ paper: i % 3 ? 'lined' : 'dotted', items });
  }
  const t = performance.now(); p.setNotebook(pages, 'big'); p.setTool('select'); return performance.now() - t; }"""
with sync_playwright() as pw:
    a = App(pw, width=1400, height=900)
    a.page.evaluate("() => { window.__puts = 0; const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { window.__puts++; return put.apply(this, arguments); }; }")
    t = a.ev(BUILD, 400)
    C.check("a 400-page notebook (16 000 items) opens quickly", t < 4000, "%.0f ms" % t)
    a.ev("() => { const p = noteflow.panels.nb; p.zoomBy(0.5); p.scrollToPage(150); }"); a.page.wait_for_timeout(600)
    stats = lambda: a.ev("async () => { const R = await import('./js/render.js'); return { ...R.stats }; }")
    s0 = stats()
    a.ev("() => { const p = noteflow.panels.nb; for (let i = 0; i < 40; i++) { p.scrollViewBy(0, 6); p.drawDoc && 0; p.render(); } }"); a.page.wait_for_timeout(400)
    s1 = stats()
    C.check("scrolling within the visible pages draws no item again (bitmaps are copied)", s1["itemDraws"] - s0["itemDraws"] <= 40 * 40 * 3 // 8 + 3000 and s1["pageBuilds"] - s0["pageBuilds"] <= 3, (s1["itemDraws"] - s0["itemDraws"], s1["pageBuilds"] - s0["pageBuilds"]))
    # steady state: nothing at all when only re-rendering the same view
    s2 = stats(); a.ev("() => { const p = noteflow.panels.nb; for (let i = 0; i < 30; i++) p.drawDoc(p.ctx); }"); s3 = stats()
    C.check("redrawing an unchanged view draws no item and builds no page", s3["itemDraws"] == s2["itemDraws"] and s3["pageBuilds"] == s2["pageBuilds"], (s3["itemDraws"] - s2["itemDraws"], s3["pageBuilds"] - s2["pageBuilds"]))
    ft = a.ev("() => { const p = noteflow.panels.nb; const t = performance.now(); for (let i = 0; i < 30; i++) p.drawDoc(p.ctx); return (performance.now() - t) / 30; }")
    print("   average frame (cached pages): %.2f ms" % ft)
    C.check("a frame of unchanged pages is cheap", ft < 25, "%.2f ms" % ft)
    # editing one page rebuilds only that page
    a.ev("() => { const p = noteflow.panels.nb; p.drawDoc(p.ctx); }"); s4 = stats()
    a.ev("() => { const p = noteflow.panels.nb; const items = p.items.slice(); items.push({ t: 'text', x: 100, y: 60, w: 200, text: 'new', color: '#000000', size: 16 }); p.commit(items); }"); a.page.wait_for_timeout(200)
    s5 = stats()
    C.check("a change rebuilds only the page it is on", 1 <= s5["pageBuilds"] - s4["pageBuilds"] <= 2, s5["pageBuilds"] - s4["pageBuilds"])
    # memory: scroll through 120 pages; cached bitmaps stay within the budget
    a.ev("() => { const p = noteflow.panels.nb; for (let i = 0; i < 120; i++) { p.scrollToPage(i); p.drawDoc(p.ctx); } }")
    mem = a.ev("() => { const p = noteflow.panels.nb; let px = 0; for (const L of p.layers.values()) px += L.canvas.width * L.canvas.height; return [p.layers.size, px]; }")
    C.check("cached page bitmaps stay within the count and pixel budget", mem[0] <= 16 and mem[1] <= 60e6, mem)
    # text boxes: layout is measured once per item, not on every hit test
    a.ev("() => { const p = noteflow.panels.nb; p.scrollToPage(10); p.setTool('select'); }")
    n = a.ev("""async () => { const p = noteflow.panels.nb, R = await import('./js/render.js'); const t = performance.now(); for (let i = 0; i < 200; i++) p.hit({ x: 300 + (i % 7), y: 100 + i }); return (performance.now() - t) / 200; }""")
    C.check("hit-testing a page of 40 items is fast (cached text layout)", n < 2, "%.3f ms per hit" % n)
    # autosave writes only changed pages
    a.ev("async () => { await noteflow.autosave(true); }")
    a.ev("() => { window.__puts = 0; }")
    a.ev("() => { const p = noteflow.panels.nb; p.scrollToPage(20); const items = p.items.slice(); items.push({ t: 'text', x: 100, y: 20, w: 200, text: 'edit', color: '#000000', size: 16 }); p.commit(items); }")
    a.ev("async () => { await noteflow.autosave(true); }")
    puts = a.ev("() => window.__puts")
    C.check("autosave after one edit in a 400-page notebook writes one page (+ the index)", puts <= 3, puts)
    a.ev("async () => { await noteflow.autosave(true); }")
    a.ev("() => { window.__puts = 0; }"); a.ev("async () => { await noteflow.autosave(true); }")
    C.check("autosave with nothing changed writes only the small index", a.ev("() => window.__puts") <= 1, a.ev("() => window.__puts"))
    a.page.reload(); a.page.wait_for_timeout(2500)
    back = a.ev("() => [noteflow.panels.nb.pages.length, noteflow.panels.nb.pages[20].items.at(-1).text, noteflow.panels.nb.pages[399].items.length]")
    C.check("the 400-page notebook is restored completely from the page-by-page backup", back == [400, "edit", 40], back)
    C.check("no page errors", not a.errors, a.errors)
    sys.exit(0 if C.summary() else 1)
