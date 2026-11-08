"""Settings, dark theme (and its contrast), reduce motion, memory saver, NoteFlow branding (no DualNote left on screen), accessibility (dialogs, focus, names), pages placed below
the toolbars, and the control to bring back dismissed Smart linking suggestions."""
import sys, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

LUM = """(() => { const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const bgOf = (e) => { let x = e; while (x) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c.a > 0.5) return c; x = x.parentElement; } return { r: 255, g: 255, b: 255 }; };
  window.__contrast = (sel) => { const e = document.querySelector(sel); if (!e) return null; const f = parse(getComputedStyle(e).color), b = bgOf(e), l1 = L(f), l2 = L(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }; })()"""

with sync_playwright() as pw:
    a = App(pw, width=1300, height=900, dpr=2); kb = a.page.keyboard
    try: a.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    except Exception: pass
    P = lambda js, arg=None: a.ev(js, arg)
    theme = lambda: P("() => document.documentElement.dataset.theme")
    gear = a.page.locator('.topbar button[title^="Settings"]')

    # ---------------------------------------------------------------- branding
    P("() => { document.title; }")
    vis = P("() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')].map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder, e.alt].join(' ')).join(' ')")
    C.check("no 'DualNote' anywhere on screen (text, tooltips, labels)", "dualnote" not in vis.lower() and P("() => document.title").startswith("NoteFlow"), re.findall(r".{20}dualnote.{20}", vis, re.I)[:2])
    C.check("the web app manifest and the page name the product NoteFlow", P("async () => { const m = await (await fetch('manifest.webmanifest')).json(); return m.name + '|' + m.short_name; }").startswith("NoteFlow"))

    # ---------------------------------------------------------------- settings: theme, motion
    gear.click(); a.page.wait_for_timeout(300)
    C.check("Settings opens as a dialog with the sections Appearance, Workspace, Pen, Smart linking, Performance, Troubleshooting", all(s in a.page.locator(".dialog").inner_text().lower() for s in ["appearance", "workspace", "pen", "smart linking", "performance", "troubleshooting"]))
    a.page.locator(".dialog .setseg button", has_text="Dark").click(); a.page.wait_for_timeout(300)
    C.check("choosing Dark applies at once and is remembered on this device", theme() == "dark" and P("() => JSON.parse(localStorage.getItem('noteflow.prefs.v1')).theme") == "dark")
    P(LUM)
    ratios = {s: P("(s) => window.__contrast(s)", s) for s in [".dialog .setlbl", ".dialog .sethint", ".dialog h3"]}
    C.check("dark theme: text in the dialog is readable (contrast at least 4.5:1)", all(v and v >= 4.5 for v in ratios.values()), ratios)
    a.page.locator(".dialog button", has_text="Done").click(); a.page.wait_for_timeout(200)
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); noteflow.sources.setOpen(true); }"); a.page.wait_for_timeout(300)
    r2 = {s: P("(s) => window.__contrast(s)", s) for s in [".sources .srcctx", ".sources .srcempty", ".topbar button", ".panel .hint"]}
    C.check("dark theme: the side panel, top bar and empty-state text are readable too", all(v is None or v >= 4.5 for v in r2.values()), r2)
    P("() => noteflow.sources.setOpen(false)")
    a.page.reload(); a.page.wait_for_timeout(1200)
    C.check("after a reload the dark theme is already there (no flash of the light one)", theme() == "dark")
    P("async () => { (await import('./js/prefs.js')).prefs.set('theme', 'system'); }")
    a.page.emulate_media(color_scheme="light"); a.page.wait_for_timeout(200); l = theme()
    a.page.emulate_media(color_scheme="dark"); a.page.wait_for_timeout(200); d = theme()
    C.check("'System' follows the operating system theme, also while the app is open", (l, d) == ("light", "dark"), (l, d))
    P("async () => { (await import('./js/prefs.js')).prefs.set('theme', 'light'); }")
    C.check("Light stays light whatever the system says", theme() == "light")
    gear.click(); a.page.wait_for_timeout(300)
    a.page.locator(".dialog label", has_text="Reduce motion").locator("xpath=..").locator("input").check(); a.page.wait_for_timeout(200)
    C.check("Reduce motion switches animations off", P("() => document.documentElement.dataset.motion") == "reduce" and P("() => getComputedStyle(document.querySelector('.btn')).transitionDuration") in ("0s", "0.0001s"))
    # ---------------------------------------------------------------- memory saver
    lim0 = P("async () => (await import('./js/panel.js')).memoryLimits()"); d0 = P("() => noteflow.panels.nb.dpr")
    a.page.locator(".dialog label", has_text="Memory saver").locator("xpath=..").locator("input").check(); a.page.wait_for_timeout(500)
    lim1 = P("async () => (await import('./js/panel.js')).memoryLimits()"); d1 = P("() => noteflow.panels.nb.dpr")
    C.check("Memory saver halves the page cache and caps the resolution (2 -> 1.5)", lim1["RASTER_MAX"] == lim0["RASTER_MAX"] // 2 and lim1["RASTER_BUDGET"] == lim0["RASTER_BUDGET"] / 2 and d0 == 2 and d1 == 1.5, (lim0, lim1, d0, d1))
    P("() => { const nb = noteflow.panels.nb; nb.setTool('pen'); nb.commit([{ t: 'pen', pts: [[100, 100], [300, 140]], color: '#d32f2f', w: 6 }]); nb.render(); }"); a.page.wait_for_timeout(300)
    C.check("pages are still drawn correctly with it on (the red stroke is on the canvas)", P("""() => { const p = noteflow.panels.nb, r = p.stage.getBoundingClientRect(), [x, y] = p.pageToScreenAt(p.cur, 200, 120), d = p.ctx.getImageData(Math.round(x * p.dpr) - 4, Math.round(y * p.dpr) - 40, 8, 80).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 90) return true; return false; }"""))
    a.page.locator(".dialog button", has_text="Done").click(); a.page.wait_for_timeout(200)
    C.check("settings are written as plain, validated data (a damaged value falls back to its default)", P("""async () => { localStorage.setItem('noteflow.prefs.v1', JSON.stringify({ theme: 'purple', pressure: 'yes', memorySaver: true })); const m = await import('./js/prefs.js'); m.prefs._reload(); const a = m.prefs.all(); return [a.theme, a.pressure, a.memorySaver]; }""") == ["system", True, True])
    P("async () => { (await import('./js/prefs.js')).prefs.reset(); }")
    C.check("Reset puts every setting back (theme system, memory saver off)", P("async () => { const p = (await import('./js/prefs.js')).prefs; return p.isDefault(); }") and P("async () => (await import('./js/panel.js')).memoryLimits().RASTER_MAX") == lim0["RASTER_MAX"])
    # troubleshooting
    gear.click(); a.page.wait_for_timeout(300)
    a.page.locator(".dialog button", has_text="Copy log").click(); a.page.wait_for_timeout(300)
    C.check("'Copy log' puts the diagnostic report on the clipboard", P("() => navigator.clipboard.readText()").startswith("NoteFlow diagnostics"))
    # ---------------------------------------------------------------- accessibility
    C.check("the dialog is labelled by its title and modal", P("() => { const d = document.querySelector('.dialog'); const t = document.getElementById(d.getAttribute('aria-labelledby')); return d.getAttribute('aria-modal') === 'true' && t && t.textContent === 'Settings'; }"))
    for _ in range(14): kb.press("Tab")
    C.check("Tab never leaves an open dialog (14 presses)", P("() => document.querySelector('.dialog').contains(document.activeElement)"))
    for _ in range(14): kb.press("Shift+Tab")
    C.check("…nor Shift+Tab", P("() => document.querySelector('.dialog').contains(document.activeElement)"))
    gear.focus(); kb.press("Escape")
    a.page.wait_for_timeout(100)
    gear.click(); a.page.wait_for_timeout(200); kb.press("Escape"); a.page.wait_for_timeout(200)
    C.check("Escape closes it and the focus goes back to the button that opened it", P("() => !document.querySelector('.dialog')") and P("() => document.activeElement.title.startsWith('Settings')"))
    unnamed = P("() => [...document.querySelectorAll('button, [role=button], select, input')].filter((e) => e.offsetParent !== null && !(e.getAttribute('aria-label') || e.textContent.trim() || e.title || e.labels?.length)).map((e) => e.className)")
    C.check("every visible button, field and select has an accessible name", unnamed == [], unnamed)
    kb.press("Tab"); a.page.wait_for_timeout(100)
    C.check("a keyboard-focused button shows a visible focus ring", P("() => { const e = document.activeElement; const s = getComputedStyle(e); return e.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }"))
    P("async () => { await noteflow.panels.nb.setNotebook([{ paper: 'blank', items: [] }, { paper: 'blank', items: [{ t: 'rect', x1: 1, y1: 1, x2: 5, y2: 5, color: '#000000', w: 2 }] }], null); await noteflow.panels.nb.goto(1); }"); a.page.wait_for_timeout(300)
    lab = P("() => noteflow.panels.nb.stage.getAttribute('aria-label')")
    C.check("the drawing area tells assistive technology which page it shows", "page 2 of 2" in lab and "1 annotation" in lab, lab)
    C.check("the Smart linking card is a polite live region (new suggestions are announced, focus is not taken)", P("() => noteflow.smart.card.getAttribute('aria-live')") == "polite")
    # ---------------------------------------------------------------- pages are placed below the toolbars
    P("async () => { await noteflow.setLayout(['nb'], false); noteflow.setActive(noteflow.panels.nb); await noteflow.panels.nb.setNotebook([0,1,2,3].map(() => ({ paper: 'blank', items: [] })), null); }"); a.page.wait_for_timeout(300)
    res = P("""async () => { const p = noteflow.panels.nb, out = []; const bars = p.root.querySelector('.bars').getBoundingClientRect(), st = p.stage.getBoundingClientRect();
        for (const i of [0, 1, 3]) { await p.goto(i); const [, sy] = p.pageToScreenAt(i, 0, 0); out.push(Math.round(sy - (bars.bottom - st.top))); } p.fitView(true); const [, fy] = p.pageToScreenAt(p.cur, 0, 0); out.push(Math.round(fy - (bars.bottom - st.top))); return out; }""")
    C.check("when a page is shown (page navigation, Fit) its top edge is below the floating toolbars, not under them", all(v >= 0 for v in res), res)
    # ---------------------------------------------------------------- dismissed suggestions can be brought back
    P("() => { noteflow.links.store.reject('k1'); noteflow.links.store.reject('k2'); }")
    a.page.locator('.topbar button[title^="Manage links"], .topbar button:has-text("Links")').first.click(); a.page.wait_for_timeout(400)
    a.page.locator(".dialog button", has_text="Bring back 2 dismissed").click(); a.page.wait_for_timeout(300)
    C.check("'Bring back dismissed' lets dismissed (or timed-out) suggestions be suggested again", P("() => noteflow.links.store.rejects.size") == 0)
    C.check("no page errors", not a.errors, a.errors)
sys.exit(0 if C.summary() else 1)
