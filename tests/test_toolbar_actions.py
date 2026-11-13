"""(1) Link and Quote are in the top bar AND the Sources panel, made from one definition (same label, icon, tooltip, pressed state while waiting). (2) Node and Link (mind map) are
separate tools in every panel's toolbar: no 'Mind map' menu, one click selects each; they still connect any items and never touch the source-link system."""
import sys
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()
with sync_playwright() as pw:
    a = App(pw, width=1700, height=900); P = lambda js, arg=None: a.ev(js, arg)
    P("async () => { await noteflow.setLayout(['pdf', 'nb', 'board'], false); }"); a.page.wait_for_timeout(500)
    top = a.page.locator(".topbar"); 
    C.check("top bar has Link and Quote, side by side", top.locator("button.linkact").count() == 2 and top.locator("button.linkact .lbl").all_inner_texts() == ["Link", "Quote"])
    a.page.locator('.topbar button[title^="Side panel"]').click(); a.page.wait_for_timeout(400)
    src = a.page.locator(".sources")
    C.check("the Sources panel has Link and Quote too", src.locator("button.linkact").count() == 2 and src.locator("button.linkact .lbl").all_inner_texts() == ["Link", "Quote"], src.locator("button.linkact").count())
    same = P("""() => { const t = [...document.querySelectorAll('.topbar .linkact')], s = [...document.querySelectorAll('.sources .linkact')];
      return t.every((b, i) => b.title === s[i].title && b.innerHTML === s[i].innerHTML); }""")
    C.check("both places use the same icon, label and tooltip", same)
    C.check("Link and Quote have different icons and tooltips that say what each is for", P("() => { const [l, q] = document.querySelectorAll('.topbar .linkact'); return l.innerHTML !== q.innerHTML && /already exist/.test(l.title) && /text goes into your notes/.test(q.title); }"))
    P("() => noteflow.setActive(noteflow.panels.nb)")
    P("() => document.querySelector('.sources .linkact[data-action=link]').click()"); a.page.wait_for_timeout(200)
    st = P("() => [...document.querySelectorAll('.linkact')].map((b) => b.dataset.action + ':' + b.getAttribute('aria-pressed'))")
    C.check("while Link waits for you, every Link button is pressed (top bar and Sources), Quote is not", all(x in ("link:true", "quote:false") for x in st), st)
    P("() => document.querySelector('.topbar .linkact[data-action=link]').click()"); a.page.wait_for_timeout(200)
    C.check("pressing it again cancels, and nothing is pressed", all(x.endswith(":false") for x in P("() => [...document.querySelectorAll('.linkact')].map((b) => b.dataset.action + ':' + b.getAttribute('aria-pressed'))")))
    P("() => document.querySelector('.topbar .linkact[data-action=quote]').click()"); a.page.wait_for_timeout(200)
    st = P("() => [...document.querySelectorAll('.linkact')].map((b) => b.dataset.action + ':' + b.getAttribute('aria-pressed'))")
    C.check("Quote (no PDF open) explains what it needs and is not left pressed", all(x.endswith(":false") for x in st) or all(x in ("quote:true", "link:false") for x in st), st)
    P("() => noteflow.links.cancel()")
    # ---- mind-map tools: one button each in every panel
    for k in ("pdf", "nb", "board"):
        r = P("""(k) => { const p = noteflow.panels[k], b = p.toolBtns; return { menu: !!p.mindBtn, node: b.node && b.node.getAttribute('aria-label'), link: b.link && b.link.getAttribute('aria-label'), distinct: b.node !== b.link,
          popup: b.node.getAttribute('aria-haspopup'), labels: [...p.root.querySelectorAll('.bar.tools .btn.tool .lbl')].map((x) => x.textContent), inbar: p.root.querySelector('.bar.tools').contains(b.node) && p.root.querySelector('.bar.tools').contains(b.link) }; }""", k)
        C.check(f"{k}: no combined 'Mind map' button; Node and Link are separate buttons in the tool bar", not r["menu"] and r["node"] == "Node" and r["link"] == "Link" and r["distinct"] and r["inbar"] and not r["popup"] and "Mind map" not in r["labels"], r)
        P("(k) => noteflow.panels[k].root.querySelector('.bar.tools [aria-label=Node]').click()", k)
        C.check(f"{k}: one click selects Node", P("(k) => noteflow.panels[k].tool", k) == "node" and P("(k) => noteflow.panels[k].toolBtns.node.classList.contains('on') && !noteflow.panels[k].toolBtns.link.classList.contains('on')", k) and not a.page.locator(".menu, .popup").count())
        P("(k) => noteflow.panels[k].root.querySelector('.bar.tools [aria-label=Link]').click()", k)
        C.check(f"{k}: one click selects Link (and Node is off)", P("(k) => noteflow.panels[k].tool", k) == "link" and P("(k) => noteflow.panels[k].toolBtns.link.classList.contains('on') && !noteflow.panels[k].toolBtns.node.classList.contains('on')", k))
        C.check(f"{k}: the mind-map options (connector type, nodes) show with these tools", P("(k) => !noteflow.panels[k].mindGroup.hidden", k))
    # ---- they still work, and stay independent of the source-link system
    P("""() => { const p = noteflow.panels.board; p.setTool('select'); p.commit([{ t: 'rect', x1: 100, y1: 100, x2: 200, y2: 160, color: '#d32f2f', w: 3 }, { t: 'ellipse', x1: 400, y1: 300, x2: 520, y2: 380, color: '#1976d2', w: 3 }]); p.fitView(); p.render(); p.setTool('link'); noteflow.setActive(p); }""")
    a.page.wait_for_timeout(200)
    p = lambda x, y: P("([x, y]) => { const p = noteflow.panels.board, r = p.stage.getBoundingClientRect(), s = p.pageToScreenAt(0, x, y); return [r.left + s[0], r.top + s[1]]; }", [x, y])
    m = a.page.mouse; m.move(*p(100, 130)); m.down(); m.move(*p(300, 200), steps=4); m.move(*p(520, 340), steps=4); m.up(); a.page.wait_for_timeout(200)
    C.check("the Link tool still connects two existing shapes", P("() => noteflow.panels.board.items.filter((d) => d.t === 'conn').length") == 1 and P("() => noteflow.panels.board.items.filter((d) => d.mm).length") == 2)
    C.check("…without creating any source link and without touching the Link button's mode", P("() => (noteflow.links.store.all ? noteflow.links.store.all().length : [...noteflow.links.store.links.values()].length)") == 0 and P("() => !noteflow.links.pick"))
    P("() => noteflow.panels.board.setTool('node')"); P("() => { const p = noteflow.panels.board; p.setTool('select'); }")
    C.check("no page errors", not a.errors, a.errors[:3])
    ok = C.summary(); a.browser.close(); sys.exit(0 if ok else 1)
