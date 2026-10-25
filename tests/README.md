# NoteFlow tests

**Unit tests** (`tests/unit/*.test.mjs`, Node's built-in runner, nothing to install) cover the pure modules: paper geometry, rich text model, bidi, text layout (with a stub font measurer), page flow, file format round trips, tool defaults and project consistency (offline file list, module imports).

```
node --test "tests/unit/*.test.mjs"
```

**Browser tests** (`tests/test_*.py`, Playwright + Chromium) drive the real UI and measure real pixels:

| File | What it protects |
| --- | --- |
| `test_ruled.py`, `test_extra.py` | writing on the lines of lined paper (baselines on rules at every zoom / dpi), snap to lines, boards |
| `test_text.py` | rich text, "what you see while typing is what is saved", save / reopen, text continuing across pages |
| `test_tools_paper.py` | Reset to default per tool, independent tool settings, paper types and settings, right-to-left notebooks |
| `test_perf.py` | large notebooks: page bitmap cache, bounded memory, incremental autosave |
| `test_regress.py` | notes, mind maps, boards, PDFs, drawing / moving / erasing, keyboard isolation |

```
pip install playwright pillow numpy && playwright install chromium
python3 tests/run_e2e.py            # all (starts its own static server)
python3 tests/run_e2e.py text perf  # only files whose name contains one of the words
```
Set `NOTEFLOW_CHROME=/path/to/chrome` to use an existing browser.
