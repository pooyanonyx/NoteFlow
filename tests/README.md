# NoteFlow tests

**Unit tests** (`tests/unit/*.test.mjs`, Node's built-in runner, nothing to install) cover the pure modules: paper geometry, caret / selection / hit-test geometry, rich text model (also colour inside text), bidi, text layout (with a stub font measurer), page flow, file format round trips, tool defaults and project consistency (offline file list, module imports).

```
node --test "tests/unit/*.test.mjs"
```

**Browser tests** (`tests/test_*.py`, Playwright + Chromium) drive the real UI and measure real pixels:

| File | What it protects |
| --- | --- |
| `test_ruled.py`, `test_extra.py` | writing on the lines of lined paper (baselines on rules at every zoom / dpi), snap to lines, boards |
| `test_text.py` | rich text, "what you see while typing is what is saved", save / reopen, text continuing across pages |
| `test_text_settings.py` | Text tool formatting (bold / italic / underline / size / list) set before a box exists and applied to new boxes |
| `test_text_prefs.py` | settings are persistent preferences: colour / size / bold / italic / underline / opacity chosen (also while typing) stay chosen through Backspace, caret moves, finishing, new boxes, tool switching, English + Persian + mixed formatting; existing text is not changed; Reset to default; saved with the workspace |
| `test_smart_snip.py` | the Link button in the top bar; Smart linking (off by default, only the active pages are read, suggest / confirm / not related, auto mode (clear matches linked at once with no card, weaker ones only suggested), limits explained, stability, saved in the workspace); the Snipping tool (PDF / Notebook / Board -> copy or insert, quality and aspect ratio, move / resize, saved in the workspace, layouts) |
| `test_image_move.py` | dragging an inserted image (regular insert and Snipping Tool) to the next / previous / a far page with Select, at 25 % / 50 % / 150 % zoom: it lands on the page it covers most, inside that page, same size / aspect / picture, still selected and draggable, one Undo step, edge auto-scroll to reach a page out of view, page corners, save + reopen; other items unaffected |
| `test_links_cleanup.py` | links are deleted with what they connect: every surface and pair of surfaces, the Delete key, mind-map branches, deleting a page, closing / replacing a PDF, Undo / Redo, save + reopen (file and session backup), files that already hold orphaned links, and nothing deleted by mistake (edit, move, long text reflow, opening a workspace) |
| `test_links_search.py` | linked notes (pick mode, item / page / region / passage anchors, both directions, several links per place, layout changes, save + reopen, links to a PDF that is replaced / missing, a link made stale from outside) and global search (notebooks, PDF text, mind maps, Persian, live updates, highlight, speed) |
| `test_text_midformat.py` | formatting while typing: colour / size / bold / italic / underline changed in the middle of a sentence from the toolbar, the Color popup, the Brush sliders and the custom colour dialog without leaving the text (caret, selection, keyboard and content stay; selection or next-typed text only; one undo step per slider drag; Persian / English / mixed; leaving the box still works) |
| `test_wrap_caret.py` | lines can be filled up to the page edge; the invisible editor and the canvas break lines in the same places, so the caret stays next to the text (zoom, dpr, size, Persian / English, inherited styles) |
| `test_nodes.py` | mind-map nodes on the notebook / PDF / board: auto-sized to their text, drag to draw, resize by handles in the Node tool (also while typing), + / - text size, minimum size, connectors stay attached |
| `test_outline.py` | the outline of the text being edited follows every wrap (drawn on the canvas from the text's layout, the editor element has the box's size) |
| `test_grow.py` | auto-sized text boxes: tap and type, the box starts small and grows from the edge its text is aligned to, wraps at the edge of the usable area of the notebook (ruled: onto the next rule) / PDF page / board, caret and editor lines stay consistent, re-editing keeps growing, bold / size on a selected box refit it |
| `test_caret_draw.py` | the caret and selection are drawn on the canvas from the text's own layout: caret vs the real ink of the text (sizes, zoom, dpr, Persian / English, left / centre / right), the invisible editor sits exactly on the canvas text and breaks lines in the same places, blinking, selection, Up / Down / Home / End |
| `test_tools_paper.py` | Reset to default per tool, independent tool settings, paper types and settings, right-to-left notebooks |
| `test_perf.py` | large notebooks: page bitmap cache, bounded memory, incremental autosave |
| `test_regress.py` | notes, mind maps, boards, PDFs, drawing / moving / erasing, keyboard isolation |
| `test_save.py` | the backup on this device: the Saved / Unsaved / Backup failed indicator, Ctrl+S (never a download or a picker), Auto-Save (on by default, off, switching), rapid changes, storage kept small, recovery after refresh and restart, failing, interrupted (atomic) and damaged backups with the fallback to the previous one, Export as a separate act, moving the old `dualnote` database, the global error notice |
| `test_selection.py` | marquee / Shift+click / Ctrl+A, group move / delete / duplicate (one undo step), copy / cut / paste (also to another panel), links not shared with copies, mind-map copies, touch still scrolls, pen pressure |
| `test_pdf_quote.py` | quoting from real PDFs with awkward layouts (columns drawn across both, reversed drawing order, hyphenated wraps, paragraphs, lists): exact text |
| `test_toolbar_actions.py` | Link and Quote in the top bar and Sources (one definition, pressed state); Node and Link as separate tools on every panel |
| `test_toolsync.py`, `test_stack_mindlinks.py` | Sync Tools Across Panels; bring-to-front on move (undo/redo, save/reopen); mind-map links between any items |
| `test_sources.py`, `test_pdfnav.py` | the Sources panel (follows the page, backlinks, Quote a passage) and the Pages / Outline tabs (thumbnails with bounded memory, outline, bookmarks saved in the workspace) |
| `test_pdf_export.py` | real PDF annotations on export, read back and drawn by pdf.js; rotated pages; the exported file reopens with every item unchanged |
| `test_worker.py` | Smart linking in a Web Worker: same results as the main thread, fallback, no long freeze, worker ended when idle |
| `test_paste_expiry.py`, `test_polish.py` | one Ctrl+V pastes once; the Smart linking countdown (15 s) for suggestions and the "Check now" notice; the slim Link bar; the Snipping Tool owning the cursor; a new Note shown at once |
| `test_platform.py` | Settings, dark theme and its contrast, reduce motion, memory saver, branding, accessibility (dialogs, focus, names), pages below the toolbars |

`python3 tests/run_e2e.py --jobs 3` runs several files at once; `test_perf` and `test_caret_draw` always run alone.

```
pip install playwright pillow numpy && playwright install chromium
python3 tests/run_e2e.py            # all (starts its own static server)
python3 tests/run_e2e.py text perf  # only files whose name contains one of the words
```
Set `NOTEFLOW_CHROME=/path/to/chrome` to use an existing browser.
