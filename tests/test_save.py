"""Saving: in place into a chosen file (File System Access API, with a stand-in for the browser's file picker), the save indicator, a failing save, the download fallback,
older (.dnws) workspaces, automatic saving into the file, a failing / damaged backup, the global error notice, and the move of the old session database."""
import sys, re, json
from playwright.sync_api import sync_playwright
from harness import App, Checker
C = Checker()

FAKE_FS = """() => {
  window.__fs = { picks: [], opens: [], files: {}, failNext: false, abortNext: false };
  const mk = (name, data) => { const h = { kind: 'file', name, writes: 0, data: data || null,
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    createWritable: async () => { if (window.__fs.failNext) { window.__fs.failNext = false; throw new Error('disk is full'); } let buf = null;
      return { write: async (b) => { buf = b; }, close: async () => { h.writes++; h.data = buf; }, abort: async () => {} }; },
    getFile: async () => new File([h.data], name) }; return h; };
  window.__mk = mk;
  window.showSaveFilePicker = async (o) => { window.__fs.picks.push(o.suggestedName); if (window.__fs.abortNext) { window.__fs.abortNext = false; const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
    const h = mk(o.suggestedName); window.__fs.last = h; return h; };
  window.showOpenFilePicker = async () => { const h = window.__fs.toOpen; window.__fs.opens.push(h.name); return [h]; };
}"""

with sync_playwright() as pw:
    a = App(pw, width=1400, height=900); kb = a.page.keyboard
    P = lambda js, arg=None: a.ev(js, arg)
    st = lambda: P("() => { const b = noteflow.saveStat; return [b.hidden, b.dataset.state, b.textContent]; }")
    def type_note(text, y=160):
        a.page.mouse.click(*a.screen_of(100, y)); a.page.wait_for_timeout(150); kb.type(text, delay=5); a.finish(); a.page.wait_for_timeout(200)
    P(FAKE_FS); P("() => { const p = noteflow.panels.nb; p.zoomBy(0.5); p.render(); }")        # (zoomed out: every position used below is on screen)
    C.check("a brand new workspace shows no save indicator", st()[0] is True, st())
    type_note("first note")
    C.check("after an edit it says the work is not in a file yet (and is backed up on this device)", st()[1] == "dirty" and "Not saved to a file" in st()[2] and "backed up on this device" in P("() => noteflow.saveStat.title"), st())
    a.page.locator('.topbar button[title^="Save everything"]').click(); a.page.wait_for_timeout(600)
    C.check("Save asks where once (suggested name ends .nfws), writes the file, and the indicator says Saved", P("() => window.__fs.picks") == ["workspace.nfws"] and P("() => window.__fs.last.writes") == 1 and st()[1:] == ["saved", "Saved"], [P("() => window.__fs.picks"), st()])
    n = P("""async () => { const WS = await import('./js/workspace.js'); const b = window.__fs.last.data; const ws = await WS.readWorkspace(await b.arrayBuffer()); return JSON.stringify(ws.notebook).includes('first note'); }""")
    C.check("the written file is a valid workspace holding the note", n is True)
    type_note("second note", 260)
    C.check("a new edit marks it as unsaved changes again", st()[1] == "dirty" and "Unsaved changes" in st()[2], st())
    kb.press("Control+S"); a.page.wait_for_timeout(600)
    C.check("Ctrl+S overwrites the SAME file: no new picker, a second write, Saved", P("() => window.__fs.picks.length") == 1 and P("() => window.__fs.last.writes") == 2 and st()[1] == "saved", [P("() => window.__fs.last.writes"), st()])
    kb.press("Control+Alt+S"); a.page.wait_for_timeout(600)
    C.check("Ctrl+Alt+S asks for a new name (Save as)", P("() => window.__fs.picks.length") == 2)
    type_note("third", 360); P("() => { window.__fs.abortNext = true; }"); kb.press("Control+Alt+S"); a.page.wait_for_timeout(500)
    C.check("cancelling the picker changes nothing: still unsaved, no error notice", st()[1] == "dirty" and a.page.locator("#toasts .toast", has_text="Could not save").count() == 0, st())
    P("() => { window.__fs.failNext = true; }"); kb.press("Control+S"); a.page.wait_for_timeout(700)
    C.check("a failing write is reported (red indicator, clear notice) and the work stays unsaved", st()[1] == "error" and a.page.locator("#toasts .toast", has_text="Could not save the workspace: disk is full").count() == 1, st())
    kb.press("Control+S"); a.page.wait_for_timeout(700)
    C.check("…and the next try succeeds", st()[1] == "saved", st())

    # opening: a current file is saved back in place; an older one never is
    P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); window.__fs.toOpen = window.__mk('mine.nfws', blob); }""")
    a.page.locator('.topbar button[title^="Open a workspace"]').click(); a.page.wait_for_timeout(900)
    P("() => { window.__fs.picks.length = 0; }"); type_note("after open", 200); kb.press("Control+S"); a.page.wait_for_timeout(600)
    C.check("a workspace opened from a .nfws file is saved back into that file (no picker)", P("() => window.__fs.picks.length") == 0 and P("() => window.__fs.toOpen.writes") == 1 and P("() => noteflow.wsName") == "mine.nfws", P("() => window.__fs.toOpen.writes"))
    P("""async () => { const WS = await import('./js/workspace.js'); const blob = await WS.writeWorkspace(noteflow.collect()); window.__fs.toOpen = window.__mk('old.dnws', blob); }""")
    a.page.locator('.topbar button[title^="Open a workspace"]').click(); a.page.wait_for_timeout(900)
    type_note("edit of an old file", 300); kb.press("Control+S"); a.page.wait_for_timeout(600)
    C.check("an older .dnws workspace is never overwritten: saving asks for a new .nfws name and the original stays untouched", P("() => window.__fs.toOpen.writes") == 0 and P("() => window.__fs.picks.at(-1)") == "old.nfws" and st()[1] == "saved", [P("() => window.__fs.picks"), st()])

    # automatic saving into the file (opt in)
    P("() => { noteflow.fileSaveDelay = 700; }"); w0 = P("() => window.__fs.last.writes")
    type_note("no auto", 400); a.page.wait_for_timeout(1500)
    C.check("automatic saving into the file is off by default", P("() => window.__fs.last.writes") == w0 and st()[1] == "dirty")
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSaveFile', true); }"); type_note("auto on", 450); a.page.wait_for_timeout(1700)
    C.check("when switched on, a change is written into the file after a pause, without notice", P("() => window.__fs.last.writes") == w0 + 1 and st()[1] == "saved" and a.page.locator("#toasts .toast", has_text="Saved to").count() == 0, [w0, P("() => window.__fs.last.writes"), st()])
    P("async () => { (await import('./js/prefs.js')).prefs.set('autoSaveFile', false); }")

    # a failing backup on this device
    P("""() => { const o = noteflow.idb.set.bind(noteflow.idb); window.__origSet = o; noteflow.idb.set = async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }; }""")
    type_note("will not back up", 500); a.page.wait_for_timeout(3600)
    C.check("when the device cannot store the backup the indicator turns red and says so (once, in a notice)", st()[1] == "error" and "Not backed up" in st()[2] and a.page.locator("#toasts .toast", has_text="Could not back up").count() == 1, [st(), P("() => noteflow.saveStat.title")])
    P("() => { noteflow.idb.set = window.__origSet; }"); type_note("fine again", 550); a.page.wait_for_timeout(3600)
    C.check("…and recovers by itself when storing works again", st()[1] in ("dirty", "saved") and P("() => noteflow.autosaveOk") is True, st())

    # download fallback
    P("() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; noteflow.fileHandle = null; noteflow.wsName = null; }")
    type_note("fallback", 600)
    with a.page.expect_download() as dl: kb.press("Control+S")
    d = dl.value
    C.check("without the file picker API Save downloads a .nfws file, as before", d.suggested_filename.endswith(".nfws"), d.suggested_filename)
    import zipfile; z = zipfile.ZipFile(d.path()); man = json.loads(z.read("manifest.json"))
    C.check("…in the NoteFlow format", man["format"] == "NoteFlow-workspace", man["format"])

    # global error notice
    P("() => { window.__e = 0; }")
    a.page.evaluate("() => setTimeout(() => { throw new Error('boom one'); }, 10)"); a.page.wait_for_timeout(400)
    a.page.evaluate("() => setTimeout(() => { throw new Error('boom two'); }, 10)"); a.page.wait_for_timeout(400)
    C.check("an uncaught error shows ONE notice that says whether the work is safe, and is logged for diagnostics",
            a.page.locator("#toasts .toast", has_text="Something went wrong").count() == 1 and P("async () => (await import('./js/diagnostics.js')).entries().filter((e) => /boom/.test(e.msg)).length") == 2)
    a.errors[:] = [e for e in a.errors if "boom" not in e]

    # damaged session: not overwritten until the user decides
    a.page.reload(); a.page.wait_for_timeout(1500)
    P("""async () => { noteflow.autosavePaused = true; clearTimeout(noteflow.autosaveTimer); await noteflow.idb.set('session', { version: 2, saved: Date.now(), settings: {}, notebook: [{ paper: 'lined', part: 'pg:missing' }], board: null, board2: null, links: null, notebook2: null }); }""")
    a.page.reload(); a.page.wait_for_selector(".dlg, .dialog, [role=dialog]", timeout=30000)
    txt = a.page.locator(".dlg, .dialog, [role=dialog]").first.inner_text()
    C.check("a damaged last session is explained (not silently dropped)", "could not be restored" in txt, txt[:120])
    a.page.get_by_text("Keep the backup, work without backup").click(); a.page.wait_for_timeout(300)
    C.check("keeping it pauses the automatic backup and the indicator warns", P("() => noteflow.autosavePaused") is True)
    type_note("typed while paused", 160); a.page.wait_for_timeout(3600)
    still = P("async () => { const r = await noteflow.idb.get('session'); return r && r.notebook && r.notebook[0].part; }")
    C.check("the damaged backup is left untouched while paused", still == "pg:missing", still)
    a.page.reload(); a.page.wait_for_selector(".dlg, .dialog, [role=dialog]", timeout=30000)
    a.page.get_by_text("Discard it and start fresh").click(); a.page.wait_for_timeout(500)
    C.check("discarding removes it and the backup works again", P("async () => (await noteflow.idb.get('session')) == null") is True and P("() => noteflow.autosavePaused") is False)

    # the old session database is moved over
    P("async () => { await noteflow.setLayout(['nb'], false); noteflow.panels.nb.setTool('text'); noteflow.panels.nb.zoomBy(0.5); }"); a.page.wait_for_timeout(300)
    type_note("kept across the rename", 160); a.page.wait_for_timeout(3600)
    P("""async () => { const db = await noteflow.idb.open(); const rows = await new Promise((res) => { const out = []; const t = db.transaction('kv'); const rq = t.objectStore('kv').openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } }; t.oncomplete = () => res(out); });
      db.close(); await new Promise((res) => { const q = indexedDB.deleteDatabase('noteflow'); q.onsuccess = q.onerror = q.onblocked = res; });
      await new Promise((res) => { const q = indexedDB.open('dualnote', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); for (const [k, v] of rows) t.objectStore('kv').put(v, k); t.oncomplete = () => { q.result.close(); res(); }; }; }); }""")
    C.check("(setup) the session now exists only in the old 'dualnote' database", P("async () => (await indexedDB.databases()).map((d) => d.name).sort().join()") == "dualnote")
    a.page.reload(); a.page.wait_for_timeout(2500)
    got = P("() => JSON.stringify(noteflow.panels.nb.pages.map((p) => p.items.map((i) => i.text)))")
    C.check("on the first start under the new name the old session is restored from it", "kept across the rename" in got, got)
    names = P("async () => (await indexedDB.databases()).map((d) => d.name).sort().join()")
    C.check("…copied into the 'noteflow' database, and the old one removed afterwards", names == "noteflow", names)
    errs = [e for e in a.errors if "disk is full" not in e]          # (the failing write of the test is logged on purpose)
    # a browser without indexedDB.databases() (older Firefox): the same move, found by opening the old database
    a.page.add_init_script("delete IDBFactory.prototype.databases;")
    P("() => noteflow.panels.nb.setTool('text')"); type_note("second move", 220); a.page.wait_for_timeout(3600)
    P("""async () => { const db = await noteflow.idb.open(); const rows = await new Promise((res) => { const out = []; const t = db.transaction('kv'); const rq = t.objectStore('kv').openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } }; t.oncomplete = () => res(out); });
      db.close(); await new Promise((res) => { const q = indexedDB.deleteDatabase('noteflow'); q.onsuccess = q.onerror = q.onblocked = res; });
      await new Promise((res) => { const q = indexedDB.open('dualnote', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); for (const [k, v] of rows) t.objectStore('kv').put(v, k); t.oncomplete = () => { q.result.close(); res(); }; }; }); }""")
    a.page.reload(); a.page.wait_for_timeout(2500)
    got2 = P("() => JSON.stringify(noteflow.panels.nb.pages.map((p) => p.items.map((i) => i.text)))")
    C.check("without indexedDB.databases() the old session is still found and moved", "second move" in got2 and P("() => typeof indexedDB.databases") == "undefined", got2)
    # and with no old database at all, starting up creates nothing under the old name
    a.page.reload(); a.page.wait_for_timeout(1500)
    C.check("nothing is left under the old database name", P("async () => { const r = await new Promise((res) => { const q = indexedDB.open('dualnote'); let fresh = false; q.onupgradeneeded = () => { fresh = true; }; q.onsuccess = () => { q.result.close(); indexedDB.deleteDatabase('dualnote'); res(fresh); }; }); return r; }") is True)
    C.check("no page errors", not errs, errs)
sys.exit(0 if C.summary() else 1)
