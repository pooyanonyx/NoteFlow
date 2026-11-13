# NoteFlow

**Read it. Mark it up. Think it through.**
NoteFlow brings your PDFs, your notes and your ideas together in one calm, flexible workspace, and it works in the browser on your PC, tablet or phone.

---

## What is NoteFlow?

Studying and working with documents usually means juggling several apps: one to read a PDF, another to write notes, another to sketch, and yet another to map out ideas. NoteFlow puts all of that side by side.

Open a lecture PDF on the left, take notes on the right, and sketch a mind map of the chapter on a board next to them. Everything stays in one place, and you can save it all as a single file and pick up exactly where you left off.

There is nothing to install and no account to create. Open NoteFlow in your browser and start.

---

## Why you'll like it

- **One workspace instead of five apps.** PDF, notebook and board live together. Arrange them the way you like.
- **Mark up PDFs the way you would on paper.** Highlight text, scribble in the margins, add sticky notes and drop in shapes, then save the annotated PDF.
- **Notes that grow with you.** A notebook that expands page by page: blank, lined, grid, dotted, weekly planner and Cornell-notes paper, with adjustable line spacing and margins. Long text flows onto the next page by itself, like in a word processor.
- **Linked notes.** Link any note, text box, mind-map node or drawing to a PDF page, a marked region or a passage of text (and the other way round). Press **Link**, choose the two ends, and a chain mark appears on both; press it to jump to the other end, which is highlighted. Several notes can share a page or region. Links use the note's own id and the PDF's content hash, so they survive moving pages, changing the layout, saving and reopening. A link never outlives what it connects: when either end is deleted (a note, text box, node, drawing or annotation, a whole page, or the PDF itself being closed or replaced by a different file), the link is deleted with it, in every panel, and it is not saved in the workspace, so nobody has to hunt for broken links. (Undo of the deletion brings the note back with its link; a closed PDF's links do not come back.) The list of all links is under **Links**.
- **Smart linking** (off by default; set it in **Links**). While you work, NoteFlow can suggest a link when a note you wrote says the same thing as a passage of the PDF, even if it is reworded: it knows word forms, a few hundred groups of synonyms and Persian verb forms (English and Persian). It compares **only the pages you are looking at** (PDF page 20 with Notebook page 100, the board's visible area), never whole documents, and only typed text: handwriting, images and PDF pages without selectable text cannot be analyzed, and it says so. You confirm each suggestion (or say "Not related": it is remembered). Any match of at least 30% is offered as a suggestion. The third mode, *Suggest, and link on their own when confident*, makes the link immediately, with no card and no question, when a match is strong: a score of at least 55% (70% on a page with only a few sentences), at least two words matching exactly and three matching in all, no clash of numbers ("type 1" / "type 2"), and a clear lead over the next best place. Everything between 30% and that bar stays a suggestion, and a note is offered once per place, never as a pile of near-duplicates. The thresholds were calibrated on labelled English and Persian notes (`node tools/calibrate-smartlink.mjs`). Smart links are purple and tagged *Suggested* / *Auto* with their match percentage, so they are never confused with links you made. Plain local text similarity, no AI service, no network.
- **Snipping tool** (Snip button, Ctrl/⌘+Shift+S). Drag a rectangle over a PDF page, a Notebook page or the Board; NoteFlow re-renders exactly that area from its own data (sharp at any zoom, with the PDF's annotations, nothing else from the screen), shows a preview, and lets you **Copy** it or **Insert** it into any visible panel as an image you can move and resize. It is saved in the workspace.
- **Search everywhere** (Ctrl/⌘+Shift+F). Notebook pages, text boxes, notes, mind maps, board text and the text inside PDFs, with partial or whole-word matching, case-insensitive, and Persian-aware (Arabic/Persian letter forms, digits, ZWNJ and vowel marks are treated alike). Click a result to open the page with the match highlighted. PDF text is read in the background once and remembered on this device. Everything runs locally, offline.
- **Formatted text.** Bold, italic, underline, different sizes and colours inside one text box, bulleted and numbered lists. Change any of them while you type, from the toolbar, the Color button or the Brush sliders: the text stays open, the caret stays where it was, and only the selected text (or what you type next) changes. **What you choose is the tool's setting from then on** (colour, size, bold, italic, underline, opacity ...): deleting text, Backspace, moving the caret, finishing the edit, switching tools or starting another box never brings the old value back; new boxes and newly typed text use it, existing text is not changed. *Reset to default* in the Brush panel puts the Text tool's settings back.
- **A board for big ideas.** A white board or a blackboard for sketches, diagrams and brainstorming.
- **Mind maps in seconds.** Build a map from the keyboard, or draw links with your finger or pen.
- **Write in Persian and English.** Mix both in the same note, with full control over direction and alignment. Right-to-left notebooks put the red margin (or the Cornell cue column) on the right and use Persian day names and a Saturday week start in the planner.
- **Made for touch and stylus.** Pinch to zoom, scroll with two fingers, and rest your palm on the screen while you write with a pen.
- **Works offline and keeps your work private.** Your files stay on your device.

---

## Three canvases, one app

### PDF: read and annotate
Open any PDF and scroll through it like a single long page. Long documents stay smooth because NoteFlow only draws the pages you are looking at.

- **Highlight** whole words by dragging across the text.
- **Draw, underline and circle** with the pen and the marker.
- **Add typed text** and **sticky notes** anywhere on a page.
- **Insert pictures** such as screenshots, or paste them straight in.
- **Jump to any page**, zoom in and out, or fit the page to the width of your screen.
- **Save an annotated PDF.** Your marks appear on the page in any PDF viewer, and the file opens again in NoteFlow with everything still editable.

### Notebook: write and organise
A multi-page notebook for lecture notes, summaries and homework.

- **Scroll through all your pages** in one continuous flow.
- **Add a page** right after the one you are on, delete pages, or move them earlier or later.
- **Pick your paper:** blank, lined or grid.
- **Write on the lines.** On lined paper, text snaps to the ruling like handwriting: tap in a row, type, press Enter as often as you like, and every line stays on its printed line, at any text size, zoom or scroll position. Bigger letters simply take every second (or third) line. The **Snap to lines** button next to the text alignment buttons turns this off for text you want to place freely. Blank paper, grid paper, PDFs and boards keep ordinary free text.
- Use every drawing and writing tool, and **export the notebook as a PDF** to share or print.

### Board: sketch and brainstorm
A very large canvas for the things that do not fit on a page.

- **Whiteboard or blackboard** with one tap. Your dark ink automatically shows up light on the blackboard, and switching back restores everything exactly as it was.
- **Optional dotted grid** to keep diagrams tidy.
- **Fit** brings all your content back into view, and you can zoom out to see the whole board.
- **Export to PDF.** On a blackboard, choose between keeping the dark background or a print-friendly white version that saves ink.

---

## Your toolbox

| Tool | What it does |
|---|---|
| **Select** | Move, resize and delete anything you have drawn or written. |
| **Pen** | Write and draw in any colour, thickness and opacity. |
| **Marker** | Broad, see-through strokes (yellow by default) for highlighting. |
| **Highlight** *(PDF)* | Highlight whole words of text with one drag. |
| **Eraser** | Rub out just the part of a stroke you touch, not the whole line. You choose the size and see its outline. |
| **Text** | Type anywhere, in English, Persian or both. |
| **Note** | Sticky notes for comments and reminders. |
| **Shapes** | Line, arrow, rectangle, ellipse, triangle, diamond, pentagon, hexagon and star, plain or filled with colour. |
| **Mind map** | Nodes and connectors for ideas and relationships (see below). |
| **Hand** | Move around the page without changing anything. |
| **Pictures** | Insert an image, or paste a screenshot. |

Everything you do can be **undone and redone**, including erasing. Colours, thickness, opacity and brightness are one tap away in the toolbar.

---

## Mind mapping made easy

Mind maps are not locked to the board. You can build them on a **PDF page**, in a **notebook** or on the **board**, so you can map out a chapter right on top of the pages you are studying.

1. Open the **Mind map** menu in the toolbar and choose **Node**.
2. Tap anywhere to add your first idea and type it. The shape grows to fit your text.
3. Press **Tab** to add a **child** idea, or **Enter** to add a **sibling**. A connector is drawn for you.
4. Or choose **Link** and drag from one idea to another to connect them. Drop the link on empty space and a new connected idea appears there.

More you can do:

- Pick **curved, straight or elbow** connectors, and turn **arrowheads** on or off.
- **Double-tap a connector** to give the relationship a label such as "causes" or "leads to".
- Choose **rounded, oval or square** nodes, and **fill** them with colour.
- **Move an idea** and its connectors follow.
- **Delete a whole branch** with one action.
- Write ideas in **Persian or English**.

---

## Write in Persian and English

NoteFlow treats Persian as a first-class language, not an afterthought.

- Type **Persian, English or both in the same sentence**. Letters join correctly, and numbers and punctuation land where they should.
- Choose the **text direction** (left-to-right or right-to-left) and the **alignment** (left, centre or right) separately, so you are always in control.
- Persian works everywhere: text boxes, sticky notes and mind-map ideas.
- Your keyboard shortcuts keep working while a Persian keyboard layout is active.

---

## Arrange your workspace your way

The **Layout** menu decides which panels you see and in which order.

- **PDF Only**, **Notebook Only** or **Board Only** for full focus.
- **PDF + Notebook** (the default): read on one side, write on the other.
- **Notebook + PDF**, **PDF + Board** and **Notebook + Board** for other combinations.
- **PDF + Notebook + Board** for the full picture.
- **Customize panels** lets you choose up to three panels in any order, including two PDFs side by side to compare documents, or two notebooks.

Each panel keeps its own content. If you take a panel out of the layout, its content is not deleted, and it comes back when you add the panel again. On a phone, multiple panels become simple tabs you tap to switch between.

The toolbars float on top of your work, so opening and closing them never makes the page jump. Hide them for a clean, distraction-free view.

---

## Works on every device

- **PC and laptop:** mouse, trackpad and keyboard shortcuts.
- **Tablet and phone:** touch-friendly toolbars, pinch to zoom, two-finger scrolling and smooth, flick-to-scroll movement.
- **Stylus:** write with a pen while your palm rests on the screen. NoteFlow ignores accidental touches.
- **Not sure what a button does?** On a touch screen, **press and hold** any toolbar button to see its name and a short explanation. A quick tap works as usual.
- **Offline:** after your first visit, NoteFlow keeps working without an internet connection.
- **Installable:** if your browser offers it, use the **Install** button to add NoteFlow to your home screen or desktop like any other app.

---

## Your work stays yours

- **Your work saves itself.** With **Auto-Save Workspace** (Settings, on by default) every change is backed up **on this device** a moment after you make it, so closing the tab, refreshing or restarting never loses your work, and the workspace (PDFs, notebooks, boards, links) is back when you reopen NoteFlow. `Ctrl+S` (or the Save button) backs up right away; it never downloads a file or asks where to save. With Auto-Save off, only `Ctrl+S` saves, and closing with unsaved changes asks first.
- **A save indicator** next to Save describes that backup: **Saved** (the latest state is backed up), **Unsaved** (changes not backed up yet), **Backup failed** (red, with the reason; click to retry). A backup is written in one all-or-nothing step and read back to check it, and the one before it is kept: if the newest were ever damaged, the previous one is restored automatically. A backup that cannot be read is **kept, not overwritten**, until you decide.
- **Export a file** (the Export button, `Ctrl+Shift+E`) makes a portable `.nfws` copy of the whole workspace on your computer: to move it to another device or keep an archive. Exporting is separate from saving and does not change the Saved mark.
- **Export** to PDF from the PDF panel, the notebook and the board. Pen strokes, marker strokes and text highlights are written as **real PDF annotations** (visible in any PDF viewer); text, shapes and images are drawn on the page, and your editable NoteFlow data travels inside the file.
- **Older files keep working.** Workspaces, notebooks, boards and annotated PDFs saved before NoteFlow was renamed (`.dnws`, `.dnote`, `.dnboard`) open as before; when exported they are written in the new format (`.nfws`, `.nfnote`, `.nfboard`) and your original file is never overwritten. Your automatic backup moves over by itself.
- **Private by design.** NoteFlow runs in your browser. Your documents are not uploaded anywhere.

---

## Select, copy and arrange

Moving an item with the Select tool brings it to the front (a group moves together, in its own order). **Settings > Advanced > Sync Tools Across Panels** (on by default): every panel uses the same active tool and tool settings; turn it off to give each panel its own. A Mind-map Link can connect any two items (images, text, shapes, drawings, nodes): they become mind-map nodes without changing.

With the **Select** tool, drag a rectangle round items to select them (or `Shift+click` to add and remove, `Ctrl+A` for the whole page). Drag any selected item to move the group; a small bar offers **Duplicate** and **Delete**. `Ctrl+C`, `Ctrl+X`, `Ctrl+V` and `Ctrl+D` copy, cut, paste and duplicate (also into another panel); links stay with the original, and mind-map branches keep their connectors. Each action is one undo step. A finger still drags the view.

## Sources, pages and bookmarks

The **Sources** button opens a side panel that follows the page you are on:

- **Sources**: on a PDF page, the notes that cite it (page, region or passage) and the other pages that have notes; on a notebook page, the sources its notes cite, and long notes that cite nothing yet. **Quote a passage** lets you drag across PDF text and puts it into your notes as a quote, already linked to where it came from.
- **Pages**: thumbnails of every page, drawn only when they scroll into view (a limited number are kept in memory), with badges for links and bookmarks.
- **Outline**: your **bookmarks** (saved in the workspace) and the PDF's own table of contents.

## Settings

The gear button opens **Settings**: theme (system, light, dark), reduced motion, saving into the file automatically, pen pressure, Smart linking, a **Memory saver** for modest hardware, and troubleshooting (copy a diagnostic log, reset settings, clear this device's backup). Settings belong to the device, not to the workspace file.

## Faster with the keyboard

Single keys switch tools while you are not typing, so letters and spaces always go into your text.

| Key | Action |
|---|---|
| `V` / `H` | Select / Hand |
| `P` / `M` / `E` | Pen / Marker / Eraser |
| `T` / `N` / `S` | Text / Note / Shapes |
| `O` / `L` | Mind map: Node / Link |
| `F` | Fill on or off for shapes and nodes |
| Hold `Space` | Temporary Hand tool, then back to your tool |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo (`⌘` on a Mac) |
| `+` / `-` / `0` | Zoom in / out / fit |
| `Ctrl+A` / `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | Select all / copy / cut / paste / duplicate items |
| `Ctrl+S` / `Ctrl+Shift+E` | Save on this device now / export a workspace file |
| `Tab` / `Enter` | Mind map: add a child / add a sibling |

Press `?` any time to see the full list.

---

## Get started in a minute

1. **Open NoteFlow** in your browser.
2. **Drop a PDF** onto the page, or press **Open**.
3. **Highlight** a passage, then switch to the **Notebook** side and write what it means in your own words.
4. Open the **Mind map** menu and sketch how the ideas connect.
5. That is all: NoteFlow saves as you work. Press **Export** only when you want a file to keep or move.

---

## Ideas to try

- **Studying for an exam:** highlight the lecture slides, write summaries in the notebook and build a mind map of each topic.
- **Reading a paper:** keep the PDF and your notes side by side and annotate as you go.
- **Teaching or tutoring:** explain on a blackboard, then export it as a PDF for your students.
- **Brainstorming:** capture ideas on the board and link them into a map.
- **Writing in two languages:** take notes in Persian and English together, with each line aligned the way you want.

---

## Good to know

- Text highlighting works on PDFs with selectable text. Scanned pages, which are just pictures of text, can still be marked with the pen and marker.
- Mind-map connectors link ideas on the same page or board.
- The board is very large, but it does have edges.
- The NoteFlow interface is in English. You can write your own notes in Persian and English.

---

**NoteFlow: your PDFs, your notes and your ideas in one place.**

---

## For developers

NoteFlow has no build step: it is plain ES modules served as static files (`python3 -m http.server`, then open `index.html`).

| Part | Where |
| --- | --- |
| Data model, file formats, validation | `js/model.js` |
| Paper types, page settings, geometry, drawing | `js/paper.js` |
| Rich text content model (runs, lists) | `js/richtext.js` |
| Bidi ordering of mixed-direction text | `js/bidi.js` |
| Text layout and drawing (one code path for editing and for the saved result) | `js/render.js` |
| Text editor element (invisible input layer over the canvas) | `js/editor.js` |
| Text continuing across pages (pure) | `js/flow.js` |
| Per-tool default settings (used by the toolbar and by *Reset to default*) | `js/tools.js` |
| Toolbar, editing, pages, page-bitmap cache | `js/panel.js` |
| Several items selected, copy / paste / duplicate (the panel methods) | `js/panelselection.js` |
| Selection rectangles, copies, the copy buffer (pure) | `js/selection.js` |
| Exporting a workspace as a file (File System Access API) | `js/savefile.js` |
| Uncaught-error log (local only) | `js/diagnostics.js` |
| App preferences (theme, pen pressure, memory saver…) and the Settings dialog | `js/prefs.js`, `js/settingsui.js` |
| Side panel: Sources, Pages (thumbnails), Outline; its data | `js/sourcesui.js`, `js/sourcesmodel.js`, `js/pdfnav.js`, `js/bookmarks.js` |
| Smart linking: matching (worker), suggestions | `js/similar.js`, `js/similar.worker.js`, `js/matcher.js`, `js/smartlink.js` |
| Real PDF annotations on export (pure part) | `js/pdfnative.js`, `js/pdfio.js` |
| Workspace, autosave, shortcuts | `js/app.js`, `js/workspace.js`, `js/keys.js` |

### Tests

```
npm test                  # unit tests + browser tests
npm run test:unit         # node:test, no dependencies (Node 20+)
npm run test:e2e          # Playwright + Chromium (see tests/README.md)
python3 tests/run_e2e.py --jobs 3   # several test files at once (timing tests still run alone)
```

Tests run automatically on every push and pull request (`.github/workflows/ci.yml`).
After adding, removing or renaming a file run `npm run precache` (the offline file list in `precache.json`; a unit test fails when it is out of date) and bump `CACHE` in `sw.js` when a release changes files.

### File compatibility

Identifiers written by NoteFlow are `NoteFlow-workspace`, `NoteFlow-notebook`, `NoteFlow-board`, `NoteFlow-pdf-annotations` (extensions `.nfws`, `.nfnote`, `.nfboard`; embedded `noteflow_source.pdf` / `noteflow_annotations.json`). The old `DualNote-…` identifiers and `.dn…` extensions are still **read** everywhere (`LEGACY_*` in `js/model.js`, `js/workspace.js`, `js/pdfio.js`); the old IndexedDB database `dualnote` is copied into `noteflow` on first start. Pen strokes may carry a pressure value as a third number per point; older versions ignore it. Bookmarks are stored in the workspace `settings.bookmarks` (by PDF hash).

Notebook pages gained optional fields (`spacing`, `margin`, `margin_x`, `dir`, `cue`, `summary`, `week_start`) and text items gained optional `runs`, `lists`, `rp`, `fl`, `cont`, `ns`. They are only written when used; older files open unchanged, and older versions of the app ignore fields they do not know (new paper types show as blank paper there).
