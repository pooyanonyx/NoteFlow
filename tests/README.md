# NoteFlow tests

**Unit tests** (`tests/unit/*.test.mjs`, Node's built-in runner, nothing to install) cover the pure modules: paper geometry, caret / selection / hit-test geometry, rich text model, bidi, text layout (with a stub font measurer), page flow, file format round trips, tool defaults and project consistency (offline file list, module imports).

```
node --test "tests/unit/*.test.mjs"
```

**Browser tests** (`tests/test_*.py`, Playwright + Chromium) drive the real UI and measure real pixels:

| File | What it protects |
| --- | --- |
| `test_ruled.py`, `test_extra.py` | writing on the lines of lined paper (baselines on rules at every zoom / dpi), snap to lines, boards |
| `test_text.py` | rich text, "what you see while typing is what is saved", save / reopen, text continuing across pages |
| `test_text_settings.py` | Text tool formatting (bold / italic / underline / size / list) set before a box exists and applied to new boxes |
| `test_wrap_caret.py` | lines can be filled up to the page edge; the invisible editor and the canvas break lines in the same places, so the caret stays next to the text (zoom, dpr, size, Persian / English, inherited styles) |
| `test_nodes.py` | mind-map nodes on the notebook / PDF / board: auto-sized to their text, drag to draw, resize by handles in the Node tool (also while typing), + / - text size, minimum size, connectors stay attached |
| `test_outline.py` | the outline of the text being edited follows every wrap (drawn on the canvas from the text's layout, the editor element has the box's size) |
| `test_grow.py` | auto-sized text boxes: tap and type, the box starts small and grows from the edge its text is aligned to, wraps at the edge of the usable area of the notebook (ruled: onto the next rule) / PDF page / board, caret and editor lines stay consistent, re-editing keeps growing, bold / size on a selected box refit it |
| `test_caret_draw.py` | the caret and selection are drawn on the canvas from the text's own layout: caret vs the real ink of the text (sizes, zoom, dpr, Persian / English, left / centre / right), the invisible editor sits exactly on the canvas text and breaks lines in the same places, blinking, selection, Up / Down / Home / End |
| `test_tools_paper.py` | Reset to default per tool, independent tool settings, paper types and settings, right-to-left notebooks |
| `test_perf.py` | large notebooks: page bitmap cache, bounded memory, incremental autosave |
| `test_regress.py` | notes, mind maps, boards, PDFs, drawing / moving / erasing, keyboard isolation |

```
pip install playwright pillow numpy && playwright install chromium
python3 tests/run_e2e.py            # all (starts its own static server)
python3 tests/run_e2e.py text perf  # only files whose name contains one of the words
```
Set `NOTEFLOW_CHROME=/path/to/chrome` to use an existing browser.
