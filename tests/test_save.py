"""Saving and backup: the indicator describes the BACKUP on this device; Ctrl+S backs up at once and never downloads or asks for a place; Auto-Save (on by default) backs up every change
soon after it happens, efficiently; recovery after a refresh / restart; failing, interrupted and damaged backups; Export is a separate act that makes a file."""
import sys, json, re
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

FAKE_FS = """() => { window.__fs = { picks: [], last: null };
  window.showSaveFilePicker = async (o) => { window.__fs.picks.push(o.suggestedName); let buf = null; const h = { kind: 'file', name: o.suggestedName, writes: 0, data: null,
    createWritable: async () => ({ write: async (b) => { buf = b; }, close: async () => { h.writes++; h.data = buf; }, abort: async () => {} }) }; window.__fs.last = h; return h; }; }"""

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard
    P = lambda js, arg=None: a.ev(js, arg)
    downloads = []; a.page.on("download", lambda d: downloads.append(d.suggested_filename))
    dialogs = []; a.page.on("dialog", lambda d: (dialogs.append(d.type), d.accept()))
    st = lambda: P("() => { const b = noteflow.saveStat; return [b.dataset.state, b.textContent]; }")
    def until(js, arg=None, timeout=20000): a.page.wait_for_function(js, arg=arg, timeout=timeout)
    def type_note(text, y=160):
        a.page.mouse.click(*a.screen_of(100, y)); a.page.wait_for_timeout(120); kb.type(text, delay=4); a.finish(); a.page.wait_for_timeout(120)
    def stored(): return P("async () => { const r = await noteflow.idb.get('session'); if (!r) return null; const out = []; for (const m of (r.notebook || [])) { const it = await noteflow.idb.get(m.part); for (const d of it || []) if (d.text) out.push(d.text); } return out; }")
    P("() => { const p = noteflow.panels.nb; p.zoomBy(0.5); p.render(); }")
    P("""() => { window.__batches = 0; const o = noteflow.idb.batch.bind(noteflow.idb); noteflow.idb.batch = (...x) => { window.__batches++; return o(...x); };
        window.__gets = []; const g = noteflow.idb.get.bind(noteflow.idb); noteflow.idb.get = (k) => { window.__gets.push(String(k)); return g(k); }; }""")
    P(FAKE_FS); a.page.wait_for_timeout(300)

    # ============================================== the indicator and Auto-Save (on by default)
    C.check("Auto-Save Workspace is ON by default", P("async () => (await import('./js/prefs.js')).prefs.get('autoSave')") is True)
    until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    C.check("a new workspace says 'Saved' (nothing is waiting to be backed up)", st() == ["saved", "Saved"], st())
    type_note("first note")
    s1 = st()[0]
    C.check("right after an edit it says 'Unsaved' (the change is not backed up yet)", s1 in ("dirty", "saving"), s1)
    until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    C.check("…and 'Saved' within a few seconds, by itself (no Ctrl+S)", st() == ["saved", "Saved"] and "first note" in (stored() or []), [st(), stored()])
    C.check("no file was downloaded and no file picker was shown", downloads == [] and P("() => window.__fs.picks.length") == 0)
    C.check("the old file-based wording is gone from the indicator", all(w not in P("() => noteflow.saveStat.title + noteflow.saveStat.textContent") for w in ["file yet", "No Saved File", "Not saved to a file"]))
    # ============================================== Ctrl+S: a backup, right now
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSave', false); }")
    type_note("second note", 230); a.page.wait_for_timeout(2500)
    C.check("with Auto-Save OFF a change stays 'Unsaved' (nothing is saved by itself)", st()[0] == "dirty" and "second note" not in (stored() or []), [st(), stored()])
    kb.press("Control+S"); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=6000)
    C.check("Ctrl+S backs up immediately: 'Saved', the note is in the backup", "second note" in stored() and st()[0] == "saved", [st(), stored()])
    C.check("…without a download, a file picker or any dialog", downloads == [] and P("() => window.__fs.picks.length") == 0 and dialogs == [])
    C.check("…and a short confirmation, not an error", a.page.locator("#toasts .toast", has_text="Saved on this device").count() >= 1)
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSave', true); }"); type_note("third note", 300); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    C.check("switching Auto-Save back on works again", "third note" in stored())
    # switching on saves what was waiting
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSave', false); }"); type_note("pending", 360); a.page.wait_for_timeout(300)
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSave', true); }"); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=6000)
    C.check("turning Auto-Save ON backs up the changes that were waiting", "pending" in stored())
    # ============================================== settings dialog
    a.page.locator('.topbar button[title^="Settings"]').click(); a.page.wait_for_timeout(300)
    dlg = a.page.locator(".dialog").inner_text()
    C.check("Settings has 'Auto-Save Workspace' (checked), Save and Export; no 'Save as' and no 'save into the file'", "Auto-Save Workspace" in dlg and "Export" in dlg and "Save as" not in dlg and "into the file" not in dlg and a.page.locator("#set-autoSave").is_checked(), dlg[:200])
    a.page.locator("#set-autoSave").uncheck(); a.page.wait_for_timeout(200)
    C.check("the toggle is stored on this device", P("() => JSON.parse(localStorage.getItem('noteflow.prefs.v1')).autoSave") is False)
    a.page.locator("#set-autoSave").check(); a.page.keyboard.press("Escape")

    # ============================================== rapid changes are not written one by one
    b0 = P("() => window.__batches")
    P("""() => { const nb = noteflow.panels.nb; for (let i = 0; i < 60; i++) nb.commit([...nb.items, { t: 'rect', x1: 10 + i, y1: 500, x2: 30 + i, y2: 520, color: '#000000', w: 2 }]); }""")
    until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000); b1 = P("() => window.__batches")
    C.check("60 changes in a row cause one or two backups, not 60 (and the last state is saved)", 1 <= b1 - b0 <= 3 and P("() => noteflow.changeSeq === noteflow.savedSeq"), b1 - b0)
    b0 = P("() => window.__batches"); t0 = P("() => performance.now()")
    for i in range(30):
        P("(i) => { const nb = noteflow.panels.nb; nb.commit([...nb.items, { t: 'rect', x1: 10 + i, y1: 560, x2: 30 + i, y2: 580, color: '#d32f2f', w: 2 }]); }", i); a.page.wait_for_timeout(330)
    mid = P("() => window.__batches") - b0
    C.check("while the user keeps changing things without a pause, a backup still happens at least every ~8 seconds", mid >= 1, mid)
    until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    # ============================================== storage stays small
    keys = P("async () => { const k = (await noteflow.idb.keys()).map(String); return { pg: k.filter((x) => x.startsWith('pg:')).length, sess: k.filter((x) => x.startsWith('session')).length }; }")
    C.check("after many backups there are no piles of copies: only the pages of the backup and of the one before it", keys["pg"] <= 4 and keys["sess"] == 2, keys)
    P("async () => { await noteflow.setLayout(['pdf','nb'], false); const { PDFDocument } = PDFLib; const d = await PDFDocument.create(); for (let i = 0; i < 40; i++) d.addPage([595, 842]); await noteflow.panels.pdf.openPdfBytes(await d.save(), 'big.pdf'); }")
    until("() => noteflow.panels.pdf.pdf && noteflow.panels.pdf.pdf.hash"); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=10000)
    P("() => { window.__gets.length = 0; }"); P("() => { const p = noteflow.panels.pdf; p.pages[0].items = [{ t: 'rect', x1: 1, y1: 1, x2: 50, y2: 50, color: '#000000', w: 2 }]; noteflow.onChange(p); }")
    until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    C.check("a backup never reads the PDF back out of storage just to see that it is there", not any(g.startswith("pdf:") for g in P("() => window.__gets")), P("() => window.__gets"))
    C.check("the PDF is stored once (not again with every backup)", P("async () => (await noteflow.idb.keys()).map(String).filter((k) => k.startsWith('pdf:')).length") == 1)

    # ============================================== recovery
    type_note("recover me", 420); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    a.page.reload(); a.page.wait_for_timeout(2500)
    got = P("() => JSON.stringify(noteflow.panels.nb.pages.map((p) => p.items.map((i) => i.text)))")
    C.check("after a refresh the latest work is back (notes and the PDF)", "recover me" in got and "third note" in got and P("() => !!noteflow.panels.pdf.pdf"), got)
    C.check("…and the indicator says 'Saved' (what is on screen is the backup)", st() == ["saved", "Saved"], st())
    P("() => { window.__b = 0; const o = noteflow.idb.batch.bind(noteflow.idb); noteflow.idb.batch = (p, d) => { window.__b++; if (p.length) window.__lastPuts = p.map((x) => x[0].slice(0, 3)); return o(p, d); }; }")
    P("() => noteflow.scheduleAutosave()"); a.page.wait_for_timeout(2600)
    C.check("the first backup after reopening writes only the small record, not the pages again", P("() => window.__lastPuts") and all(k in ("ses",) for k in P("() => window.__lastPuts")), P("() => window.__lastPuts"))
    # with Auto-Save off: unload warning only when changes would be lost
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSave', false); }")
    dialogs.clear(); a.page.reload(); a.page.wait_for_timeout(1500)
    C.check("closing with everything saved gives no warning", "beforeunload" not in dialogs, dialogs)
    P("() => { const p = noteflow.panels.nb; p.setTool('text'); }"); type_note("unsaved on purpose", 500)
    dialogs.clear(); a.page.reload(); a.page.wait_for_timeout(1500)
    C.check("with Auto-Save off, closing with unsaved changes asks first (they would be lost)", "beforeunload" in dialogs, dialogs)
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSave', true); }")

    # ============================================== failing and interrupted backups
    P("() => { noteflow.panels.nb.setTool('text'); }")
    type_note("before failure", 100); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    good = stored()
    P("""() => { window.__origBatch = noteflow.idb.batch.bind(noteflow.idb); noteflow.idb.batch = async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }; }""")
    type_note("during failure", 170); until("() => noteflow.saveStat.dataset.state === 'error'", timeout=8000)
    C.check("a failing backup is shown clearly: red 'Backup failed', the reason, and one notice", st()[1] == "Backup failed" and "out of storage" in P("() => noteflow.saveStat.title") and a.page.locator("#toasts .toast", has_text="Could not back up").count() == 1, st())
    C.check("the previous backup is untouched by the failure", stored() == good and not any("during failure" in x for x in stored()), stored())
    P("() => { noteflow.idb.batch = window.__origBatch; }"); a.page.locator(".savestat").click(); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    C.check("clicking the indicator tries again, and it recovers ('Saved', the change is in)", any("during failure" in x for x in stored()), stored())
    r = P("""async () => { const before = JSON.stringify(await noteflow.idb.get('session')); let err = null;
        try { await noteflow.idb.batch([['pg:atomic-test', [{ t: 'rect' }]], ['session', { version: 2, saved: 1, broken: true }], ['x:bad', () => 1]]); } catch (e) { err = e.name; }
        return { err, same: JSON.stringify(await noteflow.idb.get('session')) === before, none: (await noteflow.idb.get('pg:atomic-test')) === undefined }; }""")
    C.check("an interrupted write (the transaction fails half way) changes NOTHING: no new record, no stray page", r["err"] is not None and r["same"] and r["none"], r)
    # damaged newest backup -> the one before it
    type_note("older good", 240); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000); type_note("newest", 300); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    P("""async () => { const r = await noteflow.idb.get('session'); r.notebook[0].part = 'pg:does-not-exist'; await noteflow.idb.set('session', r); noteflow.autosavePaused = true; clearTimeout(noteflow.autosaveTimer); }""")
    a.page.reload(); a.page.wait_for_timeout(3000)
    got = P("() => JSON.stringify(noteflow.panels.nb.pages.map((p) => p.items.map((i) => i.text)))")
    C.check("when the newest backup is damaged the one before it is restored automatically, with a notice", "older good" in got and a.page.locator("#toasts .toast", has_text="restored from the one before it").count() == 1, got[:120])
    P("""async () => { for (const k of ['session', 'session-prev']) { const r = await noteflow.idb.get(k); if (r) { r.notebook[0].part = 'pg:gone'; await noteflow.idb.set(k, r); } } noteflow.autosavePaused = true; clearTimeout(noteflow.autosaveTimer); }""")
    a.page.reload(); a.page.wait_for_selector(".dialog", timeout=30000)
    C.check("when both are damaged nothing is thrown away: the user is asked, and automatic backup waits", "could not be restored" in a.page.locator(".dialog").inner_text() and P("() => noteflow.autosavePaused") is True)
    a.page.get_by_text("Discard them and start fresh").click(); a.page.wait_for_timeout(600)
    C.check("discarding starts clean and backing up works again", P("async () => (await noteflow.idb.get('session')) == null") and P("() => noteflow.autosavePaused") is False)

    # ============================================== Export is a separate act
    P("() => { noteflow.panels.nb.setTool('text'); }"); type_note("export me", 120); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    P(FAKE_FS); downloads.clear(); a.page.locator('.topbar button[title^="Export a copy"]').click(); a.page.wait_for_timeout(900)
    C.check("Export asks where to put the file (picker) and writes a valid .nfws workspace holding the work", P("() => window.__fs.picks.at(-1)") and P("() => window.__fs.picks.at(-1)").endswith(".nfws") and P("""async () => { const WS = await import('./js/workspace.js'); const ws = await WS.readWorkspace(await window.__fs.last.data.arrayBuffer()); return JSON.stringify(ws.notebook).includes('export me'); }""") is True)
    C.check("…and does not change the backup status (still 'Saved')", st() == ["saved", "Saved"], st())
    P("() => { delete window.showSaveFilePicker; }"); kb.press("Control+Shift+E"); a.page.wait_for_timeout(1200)
    C.check("without a file picker, Export downloads a .nfws file (Ctrl+Shift+E)", len(downloads) == 1 and downloads[0].endswith(".nfws"), downloads)
    downloads.clear(); kb.press("Control+S"); a.page.wait_for_timeout(800)
    C.check("Ctrl+S still never downloads", downloads == [])
    # ============================================== the old session database is moved over
    P("async () => { await noteflow.setLayout(['nb'], false); noteflow.panels.nb.setTool('text'); noteflow.panels.nb.zoomBy(0.5); }"); a.page.wait_for_timeout(300)
    type_note("kept across the rename", 160); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    MOVE = """async () => { const db = await noteflow.idb.open(); const rows = await new Promise((res) => { const out = []; const t = db.transaction('kv'); const rq = t.objectStore('kv').openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } }; t.oncomplete = () => res(out); });
      db.close(); await new Promise((res) => { const q = indexedDB.deleteDatabase('noteflow'); q.onsuccess = q.onerror = q.onblocked = res; });
      await new Promise((res) => { const q = indexedDB.open('dualnote', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); for (const [k, v] of rows) t.objectStore('kv').put(v, k); t.oncomplete = () => { q.result.close(); res(); }; }; }); }"""
    P(MOVE)
    a.page.reload(); a.page.wait_for_timeout(2500)
    got = P("() => JSON.stringify(noteflow.panels.nb.pages.map((p) => p.items.map((i) => i.text)))")
    names = P("async () => (await indexedDB.databases()).map((d) => d.name).sort().join()")
    C.check("on the first start under the new name the old session is restored and moved into 'noteflow'", "kept across the rename" in got and names == "noteflow", [got[:80], names])
    a.page.add_init_script("delete IDBFactory.prototype.databases;")
    P("() => noteflow.panels.nb.setTool('text')"); type_note("second move", 220); until("() => noteflow.saveStat.dataset.state === 'saved'", timeout=8000)
    P(MOVE); a.page.reload(); a.page.wait_for_timeout(2500)
    got2 = P("() => JSON.stringify(noteflow.panels.nb.pages.map((p) => p.items.map((i) => i.text)))")
    C.check("without indexedDB.databases() (older Firefox) the old session is still found and moved", "second move" in got2 and P("() => typeof indexedDB.databases") == "undefined", got2[:80])
    # ============================================== the global error notice (unchanged)
    a.page.evaluate("() => setTimeout(() => { throw new Error('boom one'); }, 10)"); a.page.wait_for_timeout(400)
    a.page.evaluate("() => setTimeout(() => { throw new Error('boom two'); }, 10)"); a.page.wait_for_timeout(400)
    C.check("an uncaught error shows ONE notice that says whether the work is safe, and is logged", a.page.locator("#toasts .toast", has_text="Something went wrong").count() == 1 and P("async () => (await import('./js/diagnostics.js')).entries().filter((e) => /boom/.test(e.msg)).length") == 2)
    errs = [e for e in a.errors if "boom" not in e and "quota" not in e.lower()]
    C.check("no page errors", not errs, errs)
sys.exit(0 if C.summary() else 1)
