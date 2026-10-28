// One panel (PDF or notebook): canvas view with pan/zoom, all drawing tools, selection with resize
// handles, text/note editing, undo/redo, toolbars. Touch, pen and mouse all use Pointer Events.
import * as M from "./model.js";
import * as R from "./render.js";
import * as PDF from "./pdfio.js";
import * as K from "./keys.js";
import * as P from "./paper.js";
import * as T from "./tools.js";
import * as RT from "./richtext.js";
import * as F from "./flow.js";
import { RichEditor } from "./editor.js";
import { el, icon, toast, dialog, popup, closePopup, paletteContent, customColorDialog, brushContent, paperContent } from "./ui.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TOOL_INFO = {
  select: ["Select", "Select, move, resize, recolour or delete. Double-tap text/notes to edit. Drag empty space to scroll."],
  pen: ["Pen", "Freehand pen"], mark: ["Marker", "Semi-transparent highlighter marker"],
  hltext: ["Highlight", "Drag across PDF text to highlight whole words"], eraser: ["Eraser", "Erase part of a pen or marker stroke by dragging over it (size: Brush button); other items are removed whole"],
  text: ["Text", "Tap to add a text box"], note: ["Note", "Tap to stick a sticky note on the page"],
  shape: ["Shapes", "Pick a shape (line, arrow, rectangle, ellipse, triangle, ...) and draw it"],
  node: ["Node", "Mind map: tap to add a node, drag to move it (Tab = child, Enter = sibling)"],
  link: ["Link", "Mind map: drag from one node to another to connect them (drop on empty space = new node)"],
  pan: ["Hand", "Drag to scroll"],
};
const PDF_TOOLS = ["select", "pan", "pen", "mark", "hltext", "eraser", "text", "note", "shape"];
const NB_TOOLS = ["select", "pan", "pen", "mark", "eraser", "text", "note", "shape"];
const BOARD_TOOLS = ["select", "pan", "pen", "mark", "eraser", "text", "note", "shape"];
const SEP_AFTER = new Set(["pan", "eraser", "shape", "link"]);
const GROUP_OF_TOOL = T.TOOL_GROUP;                // every creating tool has its OWN settings (tools.js)
const MIND_TOOLS = ["node", "link"];                  // on every panel (PDF, notebook, board) these two tools live in one "Mind map" menu button
const OLD_SHAPE_TOOLS = ["line", "arrow", "rect", "ellipse"];     // separate tools of older versions / workspaces -> Shapes tool
const STYLE_TO_ITEM = { color: "color", width: "w", size: "size", alpha: "alpha", bright: "bright" };
const SIZE_LADDER = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128];
const stepSize = (z, dir) => (dir > 0 ? SIZE_LADDER.find((x) => x > z + 0.01) ?? z : [...SIZE_LADDER].reverse().find((x) => x < z - 0.01) ?? z);
const HANDLE_R = 7;                       // drawn handle radius (screen px)
const MAX_IMAGE_SIDE = 2400;
const GAP = 12;                      // space between pages in the continuous PDF view (page units)
const RASTER_BUDGET = 40e6;          // max total pixels of cached page bitmaps (memory limit)
const RASTER_MAX = 12;               // max cached page bitmaps
const LAYER_BUDGET = 56e6, LAYER_MAX = 16;   // rendered notebook pages / annotation layers kept as bitmaps (pixels, count)
const freeCanvas = (c) => { try { c.width = c.height = 0; } catch { /* ignore */ } };

export class Panel {
  constructor(app, key, kind, label) {
    this.app = app; this.key = key; this.kind = kind; this.label = label;
    this.name = null;                     // file name shown in the title
    this.pages = kind === "nb" ? [{ paper: "lined", items: [] }] : kind === "board" ? [{ paper: "white", grid: false, items: [] }] : [];
    this.cur = 0; this.dirty = false; this.history = new M.History();
    this.view = { scale: 1, tx: 0, ty: 0, fit: kind !== "board", init: kind !== "board" };     // a board starts at 100 %, centred (see onResize)
    this.cw = 300; this.ch = 300; this.dpr = window.devicePixelRatio || 1;
    this.tool = "pen";
    this.groups = T.toolDefaults(kind);
    this.curStyle = { ...this.groups.pen };
    this.recent = [];
    this.selected = null; this.live = null; this.preview = null; this.action = null;
    this.editing = null; this.pointers = new Map(); this.gesture = null; this.lastPen = 0; this.lastTap = null;
    this.pdf = null; this.sizes = []; this.words = null; this.wordsPage = -1; this.pageToken = 0;
    // continuous PDF view: page layout + cached page bitmaps (only pages near the screen are rendered)
    this.layers = new Map(); this.layerTick = 0; this.layerTimer = 0;        // finished drawings of whole pages, so scrolling only copies bitmaps
    this.rasters = new Map(); this.rasterJob = null; this.rasterTimer = 0; this.badPages = new Set();
    this.sizeJobs = new Map(); this.offs = null; this.docW = 595; this.docH = 842; this.vp = 0; this.vpLock = null; this.fling = 0;
    this.fmt = { dir: "ltr", align: "left" }; this.fmtKey = "";      // text direction / alignment used for new text
    this.caretOn = true; this.caretTimer = 0; this.caretColor = null;   // the caret of the rich text editor is drawn on the canvas (see drawRichCaret); it blinks on this timer
    this.snapLines = true;                                          // text written on lined paper follows the printed rules (see render.js "writing on ruled paper")
    this.shapeKind = "rect"; this.fill = { shape: false, mind: false }; this.textStyle = { ...T.EXTRAS_DEFAULT.text }; this.fillKey = "";  // Shapes tool: active shape + Fill switch (Shapes and Mind map keep their own)
    this._bc = new WeakMap(); this.eraserPos = null;
    this.connStyle = "curve"; this.connArrow = true; this.nodeKind = "round"; this.mindKey = ""; this.linkTarget = null; this._nm = null;   // mind map defaults
    if (kind === "nb") { this.layout(); this.view.ty = 14; }
    if (kind === "board") this.layout();
    this._raf = 0; this.barsOpen = true;
    this.buildDom();
    if (this.shapeBtn) this.updateShapeBtn();               // (the Shapes button names the active shape from the start)
    this.setTool("pen", true);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.stage);
    this.ui();
  }

  // ------------------------------------------------------------------ state
  get items() { return this.pages[this.cur]?.items ?? []; }
  get fillOn() { return !!this.fill[this.tool === "node" || this.tool === "link" ? "mind" : "shape"]; }
  set fillOn(v) { this.fill[this.tool === "node" || this.tool === "link" ? "mind" : "shape"] = !!v; }
  get drawList() { return this.live ?? this.items; }
  get hasPage() { return this.kind !== "pdf" || !!this.pdf; }
  get minZoom() { return this.kind === "board" ? 0.06 : 0.2; }
  pageDims() { return this.sizeOf(this.cur); }
  continuous() { return true; }                                      // PDF and notebook share one continuous page column
  shown() { return this.continuous() ? this.vp : this.cur; }         // page number shown in the toolbar
  defSize() { return this.sizes[0] || this.sizes.find(Boolean) || [595, 842]; }
  sizeOf(i) { return this.kind === "nb" ? [M.PAGE_W, M.PAGE_H] : this.kind === "board" ? [M.BOARD_W, M.BOARD_H] : (this.sizes[i] || this.defSize()); }
  snap() { return this.pages.map((p) => (this.kind === "nb" ? M.clonePage(p) : { paper: p.paper, items: p.items.slice() })); }
  restoreSnap(s) {                                    // (a board keeps its current background / grid: those are settings, not undo steps)
    this.pages = s.map((p) => (this.kind === "nb" ? M.clonePage(p)
      : this.kind === "board" ? { paper: this.pages[0]?.paper || "white", grid: !!this.pages[0]?.grid, items: p.items.slice() } : { items: p.items.slice() }));
  }

  // -------------------------------------------------------------------- DOM
  buildDom() {
    const mk = (cls) => el("div", { class: cls });
    this.titleEl = el("span", { class: "ptitle" });
    // The toggle is an icon button with a clear on / off state; undo / redo live next to it so they stay reachable while the toolbars are hidden.
    this.barsBtn = el("button", { class: "btn small barsbtn", type: "button", "aria-expanded": "true", onclick: () => this.setBars(!this.barsOpen), title: `Show or hide this panel's toolbars (${K.MOD}+.)` },
      icon("tools"), el("span", { class: "lbl" }, "Toolbars"), icon("chevdown", "tiny chev"));
    this.hactions = el("span", { class: "hactions" }, this.barsBtn);
    const head = el("header", { class: "phead" }, this.titleEl, this.hactions);

    this.fileInput = el("input", { type: "file", hidden: true, onchange: () => this.onFile() });
    this.imgInput = el("input", { type: "file", accept: "image/*", hidden: true, onchange: () => this.onImageFile() });
    const b = (ic, lbl, title, fn, cls = "") => {
      const x = el("button", { class: "btn " + cls, type: "button", title, "aria-label": title, onclick: fn }, icon(ic), lbl ? el("span", { class: "lbl" }, lbl) : null);
      return x;
    };
    this.b = {};
    const fileBar = mk("bar");
    if (this.kind === "pdf") {
      this.b.open = b("open", "Open", "Open a PDF", () => this.pickFile(".pdf,application/pdf"));
      this.b.save = b("save", "Save PDF", "Save a copy of the PDF with your annotations", () => this.saveAnnotated());
      fileBar.append(this.b.open, this.b.save);
    } else if (this.kind === "board") {
      this.b.new = b("plus", "New", "New board", () => this.newBoard());
      this.b.open = b("open", "Open", "Open a board (.dnboard)", () => this.pickFile(".dnboard,application/json,.json"));
      this.b.save = b("save", "Save", "Save the board (.dnboard)", () => this.saveBoard());
      this.b.export = b("pdf", "PDF", "Export the board as a PDF", () => this.exportBoard());
      fileBar.append(this.b.new, this.b.open, this.b.save, this.b.export);
    } else {
      this.b.new = b("plus", "New", "New notebook", () => this.newNotebook());
      this.b.open = b("open", "Open", "Open a notebook (.dnote)", () => this.pickFile(".dnote,application/json,.json"));
      this.b.save = b("save", "Save", "Save the notebook (.dnote)", () => this.saveNotebook());
      this.b.export = b("pdf", "PDF", "Export all pages as a PDF", () => this.exportNotebook());
      fileBar.append(this.b.new, this.b.open, this.b.save, this.b.export);
    }
    this.b.undo = b("undo", "", `Undo (${K.MOD}+Z)`, () => this.undo());
    this.b.redo = b("redo", "", `Redo (${K.MOD}+Shift+Z)`, () => this.redo());
    for (const u of [this.b.undo, this.b.redo]) u.classList.add("small", "icon-only");
    this.hactions.prepend(this.b.undo, this.b.redo);
    this.b.paste = b("paste", "Paste", "Paste an image (e.g. a screenshot) or text", () => this.app.pasteButton(this));
    this.b.image = b("image", "Image", "Insert an image from a file or the camera", () => this.imgInput.click());
    fileBar.append(el("span", { class: "gap" }), this.b.paste, this.b.image);

    const pageBar = mk("bar");
    this.b.prev = b("prev", "", "Previous page", () => this.goto(this.cur - 1));
    this.pageInput = el("input", { type: "number", class: "pageno", min: 1, inputMode: "numeric", "aria-label": "Page number",
      onchange: () => this.goto(+this.pageInput.value - 1), onfocus: (e) => e.target.select() });
    this.pageCount = el("span", { class: "pcount" });
    this.b.next = b("next", "", "Next page", () => this.goto(this.cur + 1));
    this.b.zout = b("minus", "", "Zoom out (-)", () => this.zoomBy(1 / 1.25));
    this.b.zin = b("plus", "", "Zoom in (+)", () => this.zoomBy(1.25));
    this.b.fit = b("fit", "Fit", "Fit page to width (0)", () => this.fitView());
    if (this.kind === "board") {                    // a board is one big canvas: zoom, fit, background, grid (no page controls)
      this.b.fit.title = "Fit all content in view";
      this.bgBtn = el("button", { class: "btn", type: "button", title: "Switch between a whiteboard and a blackboard", onclick: () => this.toggleBoardBg() }, icon("sun"), el("span", { class: "lbl" }, "White"));
      this.gridBtn = el("button", { class: "btn", type: "button", "aria-pressed": "false", title: "Show or hide the dotted grid", onclick: () => this.toggleGrid() }, icon("dots"), el("span", { class: "lbl" }, "Grid"));
      pageBar.append(this.b.zout, this.b.zin, this.b.fit, el("span", { class: "gap" }), this.bgBtn, this.gridBtn);
    } else pageBar.append(this.b.prev, this.pageInput, this.pageCount, this.b.next, el("span", { class: "gap" }), this.b.zout, this.b.zin, this.b.fit);
    if (this.kind === "nb") {
      this.b.add = b("plus", "Page", "Insert a new page after this one", () => this.addPage());
      this.b.del = b("trash", "", "Delete this page", () => this.deletePage());
      this.b.earlier = b("prev", "Move", "Move this page earlier", () => this.movePage(-1), "mv");
      this.b.later = b("next", "Move", "Move this page later", () => this.movePage(1), "mv");
      this.paper = el("select", { class: "paper", "aria-label": "Paper", title: "Paper of this page", onchange: () => this.setPaper(this.paper.value) },
        P.PAPERS.map((k) => el("option", { value: k }, P.PAPER_NAMES[k])));
      this.paperBtn = el("button", { class: "btn", type: "button", title: "Paper settings: line spacing, margin, direction, layout", "aria-haspopup": "dialog", onclick: () => this.openPaper() }, icon("paper"), el("span", { class: "lbl" }, "Paper"), icon("chevdown", "tiny"));
      pageBar.append(el("span", { class: "gap" }), this.b.add, this.b.del, this.b.earlier, this.b.later, this.paper, this.paperBtn);
    }

    const toolBar = mk("bar tools");
    this.toolBtns = {};
    for (const k of (this.kind === "pdf" ? PDF_TOOLS : this.kind === "board" ? BOARD_TOOLS : NB_TOOLS)) {
      let x;
      if (k === "shape") {          // one button for all shapes: shows the active shape, opens the shape menu
        this.shapeIcon = el("span", { class: "shico" }, icon(this.shapeKind));
        x = el("button", { class: "btn tool", type: "button", title: K.hint(TOOL_INFO[k][1], K.TOOL_KEYS[k]), "aria-label": TOOL_INFO[k][0], "aria-haspopup": "menu",
          "aria-pressed": "false", onclick: () => this.openShapes() }, this.shapeIcon, el("span", { class: "lbl" }, TOOL_INFO[k][0]), icon("chevdown", "tiny"));
        this.shapeBtn = x;
      } else {
        x = el("button", { class: "btn tool", type: "button", title: K.hint(TOOL_INFO[k][1], K.TOOL_KEYS[k]), "aria-label": TOOL_INFO[k][0],
          "aria-pressed": "false", onclick: () => this.setTool(k) }, icon(k), el("span", { class: "lbl" }, TOOL_INFO[k][0]));
      }
      this.toolBtns[k] = x; toolBar.append(x);
      if (k === "shape") {                                       // one button for the mind-map tools (Node, Link): same idea as the Shapes menu
        this.mindBtn = el("button", { class: "btn tool", type: "button", "aria-label": "Mind map", "aria-haspopup": "menu", "aria-pressed": "false",
          title: `Mind map: nodes and connectors (${K.TOOL_KEYS.node} node, ${K.TOOL_KEYS.link} link)`, onclick: () => this.openMindMenu() },
          icon("node"), el("span", { class: "lbl" }, "Mind map"), icon("chevdown", "tiny"));
        this.toolBtns.node = this.toolBtns.link = this.mindBtn; toolBar.append(this.mindBtn);
      }
      if (SEP_AFTER.has(k)) toolBar.append(el("span", { class: "tsep" }));            // group: pointer & hand | draw | text & shapes & mind map
    }
    this.fillBtn = el("button", { class: "btn tool fillbtn", type: "button", "aria-label": "Fill", "aria-pressed": "false", disabled: true,
      title: "Fill closed shapes with the colour", onclick: () => this.toggleFill() }, icon("fill"), el("span", { class: "lbl" }, "Fill"));
    toolBar.append(this.fillBtn);
    this.colorBtn = el("button", { class: "btn", type: "button", title: "Choose a colour", onclick: () => this.openColor() },
      el("span", { class: "cdot" }), el("span", { class: "lbl" }, "Color"), icon("chevdown", "tiny"));
    this.brushBtn = el("button", { class: "btn", type: "button", title: "Thickness, opacity, brightness, text size", onclick: () => this.openBrush() },
      icon("brush"), el("span", { class: "lbl" }, "Brush"), icon("chevdown", "tiny"));
    const fb = (ic, title, fn) => el("button", { class: "btn tool fmt", type: "button", title, "aria-label": title, "aria-pressed": "false", onclick: fn }, icon(ic));
    this.fmtBtns = {
      ltr: fb("ltr", "Text direction: left-to-right (English)", () => this.setFmt({ dir: "ltr" })),
      rtl: fb("rtl", "Text direction: right-to-left (Persian)", () => this.setFmt({ dir: "rtl" })),
      left: fb("alignleft", "Align text to the left", () => this.setFmt({ align: "left" })),
      center: fb("aligncenter", "Center text", () => this.setFmt({ align: "center" })),
      right: fb("alignright", "Align text to the right", () => this.setFmt({ align: "right" })),
    };
    const F = this.fmtBtns;
    this.snapBtn = fb("ruled", "Snap text to the ruled lines: every line sits on a line of the paper, whatever the text size", () => this.setSnap(!this.snapDisplay()));
    this.snapSep = el("span", { class: "fsep" });
    this.rtBtns = {
      b: fb("bold", `Bold (${K.MOD}+B)`, () => this.richCmd("b")), i: fb("italic", `Italic (${K.MOD}+I)`, () => this.richCmd("i")), u: fb("underline", `Underline (${K.MOD}+U)`, () => this.richCmd("u")),
      ul: fb("bullets", `Bulleted list (${K.MOD}+Shift+8)`, () => this.richCmd("ul")), ol: fb("numbered", `Numbered list (${K.MOD}+Shift+7)`, () => this.richCmd("ol")),
      smaller: fb("minus", "Smaller text (the selected words, or the whole box)", () => this.richCmd("smaller")), bigger: fb("plus", "Bigger text (the selected words, or the whole box)", () => this.richCmd("bigger")),
    };
    this.sizeLbl = el("span", { class: "sizelbl", title: "Text size" });
    const RB = this.rtBtns;
    this.richGroup = el("span", { class: "richgrp" }, el("span", { class: "fsep" }), RB.b, RB.i, RB.u, el("span", { class: "fsep" }), RB.ul, RB.ol, el("span", { class: "fsep" }), RB.smaller, this.sizeLbl, RB.bigger);
    this.fmtGroup = el("span", { class: "fmtgrp", role: "group", "aria-label": "Text format", hidden: true },
      F.ltr, F.rtl, el("span", { class: "fsep" }), F.left, F.center, F.right, this.snapSep, this.snapBtn, this.richGroup);
    for (const ev of ["pointerdown", "mousedown"]) this.fmtGroup.addEventListener(ev, (e) => e.preventDefault());   // keep the text cursor in the editor
    this.buildMindGroup();
    toolBar.append(this.fmtGroup, this.mindGroup, el("span", { class: "gap" }), this.colorBtn, this.brushBtn);

    this.bars = el("div", { class: "bars" }, fileBar, pageBar, toolBar);

    this.canvas = el("canvas", { class: "view", "aria-label": this.label });
    this.ctx = this.canvas.getContext("2d");
    this.ta = el("textarea", { class: "editor", hidden: true, rows: 1, dir: "auto", spellcheck: false, autocapitalize: "off",
      oninput: () => this.positionEditor(), onblur: () => this.finishEdit(),
      onkeydown: (e) => this.onEditorKey(e) });
    this.rt = new RichEditor({ onInput: () => this.onRichInput(), onSelection: () => this.onRichSel(), onKey: (e) => this.onRichKey(e), onBlur: () => this.finishEdit() });
    this.msg = el("div", { class: "msg" });
    this.stage = el("div", { class: "stage", tabIndex: -1 }, this.canvas, this.ta, this.rt.el, this.msg);
    this.stage.addEventListener("scroll", () => { if (this.stage.scrollLeft || this.stage.scrollTop) { this.stage.scrollLeft = 0; this.stage.scrollTop = 0; } });   // (the view is moved by the app only, never by the browser)
    this.body = el("div", { class: "pbody" }, this.stage, this.bars);    // bars overlay the stage (position:absolute), they take no layout space
    this.root = el("section", { class: "panel", dataset: { key: this.key, kind: this.kind } }, head, this.body, this.fileInput, this.imgInput);

    const s = this.stage;
    s.addEventListener("pointerdown", (e) => this.onDown(e));
    s.addEventListener("pointermove", (e) => this.onMove(e));
    s.addEventListener("pointerup", (e) => this.onUp(e));
    s.addEventListener("pointercancel", (e) => this.onUp(e, true));
    s.addEventListener("pointerleave", () => { if (this.eraserPos && !this.action) { this.eraserPos = null; this.render(); } });
    s.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    s.addEventListener("contextmenu", (e) => e.preventDefault());
    this.root.addEventListener("pointerdown", () => this.app.setActive(this), true);
    this.root.addEventListener("focusin", () => this.app.setActive(this));
    this.setBars(true);
  }

  setBars(open) {
    this.barsOpen = open;
    this.bars.hidden = !open;
    this.barsBtn.classList.toggle("on", open); this.barsBtn.classList.toggle("open", open); this.barsBtn.setAttribute("aria-expanded", String(open));   // (the bars float over the page: nothing is resized or moved)
  }

  // ------------------------------------------------------------------- tools
  /** temp = a temporary switch (hold Space for Hand): the selection stays, and the tool to return to is remembered by beginTempTool. */
  setTool(tool, silent = false, temp = false) {
    this.finishEdit();
    if (!temp) this.tempPrev = null;                                 // choosing a tool by hand ends any temporary switch
    this.tool = tool; this.linkTarget = null; if (tool !== "eraser") this.eraserPos = null;
    this.colorBtn.disabled = tool === "eraser";                       // the eraser has a size but no colour
    for (const [k, x] of Object.entries(this.toolBtns)) { x.classList.toggle("on", k === tool); x.setAttribute("aria-pressed", String(k === tool)); }
    if (this.mindBtn) { const on = tool === "node" || tool === "link"; this.mindBtn.classList.toggle("on", on); this.mindBtn.setAttribute("aria-pressed", String(on)); }
    this.stage.dataset.tool = tool;
    if (tool !== "select" && this.selected !== null && !temp) this.selected = null;
    const g = GROUP_OF_TOOL[tool];
    if (g) this.curStyle = { ...this.groups[g] };
    this.updateColorDot();
    if (tool === "hltext") this.ensureWords();
    if (!silent) this.render();
  }
  groupKey() { return GROUP_OF_TOOL[this.tool] || null; }
  updateColorDot() { this.colorBtn.querySelector(".cdot").style.background = this.curStyle.color; }

  applyStyle(key, value, commit = true) {
    this.curStyle[key] = value;
    const g = this.groupKey();
    if (g) this.groups[g][key] = value;
    if (key === "color") this.updateColorDot();
    if (commit && this.tool === "select" && this.selected !== null) {
      const d = this.items[this.selected];
      if (!d) return;
      const field = STYLE_TO_ITEM[key];
      if (field in d || key === "alpha" || key === "bright") {
        const v = key === "width" || key === "size" ? Number(value) : value;
        let n = { ...d, [field]: v };
        if (key === "color" && d.fill) n.fill = v;                  // a filled shape stays filled with its colour
        if (key === "size" && d.t === "text" && d.runs) n = F.withContent(n, RT.applyAll(RT.contentOf(d), { z: null }));   // one size for the whole box again
        if (key === "size" && d.t === "text" && d.ruled === true) n = R.ruledNormalize(n);
        if (key === "size") n = this.fitGrown(n);
        if (JSON.stringify(n) !== JSON.stringify(d)) {
          const items = this.items.slice(); items[this.selected] = n;
          this.commit(items, { keepSel: true, flowIdx: d.t === "text" ? this.selected : null });
        }
      }
    }
    this.render();
  }
  rememberColor(hex) {
    this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, 10);
  }
  openColor() {
    this.finishEdit();
    const pick = (hex) => { closePopup(); this.rememberColor(hex); this.applyStyle("color", hex); };
    popup(this.colorBtn, paletteContent({ recent: this.recent, onPick: pick,
      onCustom: async () => { closePopup(); const hex = await customColorDialog(this.curStyle.color); if (hex) pick(hex); } }));
  }
  openBrush() {
    this.finishEdit();
    const g = GROUP_OF_TOOL[this.tool], tool = this.tool;
    const box = brushContent({ getStyle: () => this.curStyle, widthEnabled: this.tool !== "hltext", eraser: this.tool === "eraser",
      onInput: (k, v) => this.applyStyle(k, v, false), onCommit: (k, v) => this.applyStyle(k, v, true),
      ...(g ? { onReset: () => this.resetTool(tool), isDefault: () => this.isToolDefault(tool),
        resetTitle: `Restore the ${T.GROUP_LABEL[g]} settings (colour, thickness, opacity, brightness, text size${g === "text" ? ", bold / italic / underline / list" : g === "shape" ? ", shape, fill" : g === "mind" ? ", connectors, nodes, fill" : ""}) to their defaults. Other tools are not changed.` } : {}) });
    this.brushBox = box;
    popup(this.brushBtn, box, { onClose: () => { if (this.brushBox === box) this.brushBox = null; } });
  }
  // ------------------------------------------------------------ reset to default
  toolDefaultsNow() { return T.toolDefaults(this.kind, this.boardIsDark()); }
  /** Are all settings of this tool (style + the tool's own options) what a new panel starts with? */
  isToolDefault(tool = this.tool) {
    const g = GROUP_OF_TOOL[tool]; if (!g) return true;
    if (!T.sameStyle(this.groups[g], this.toolDefaultsNow()[g])) return false;
    if (g === "text") return Object.keys(T.EXTRAS_DEFAULT.text).every((k) => this.textStyle[k] === T.EXTRAS_DEFAULT.text[k]);
    if (g === "shape") return this.shapeKind === T.EXTRAS_DEFAULT.shape.shapeKind && this.fill.shape === T.EXTRAS_DEFAULT.shape.fill;
    if (g === "mind") { const e = T.EXTRAS_DEFAULT.mind; return this.connStyle === e.connStyle && this.connArrow === e.connArrow && this.nodeKind === e.nodeKind && this.fill.mind === e.fill; }
    return true;
  }
  /** Put the settings of ONE tool back to their original values; every other tool and every unrelated preference stays as it is. */
  resetTool(tool = this.tool) {
    const g = GROUP_OF_TOOL[tool]; if (!g) return false;
    this.groups[g] = { ...this.toolDefaultsNow()[g] };
    if (GROUP_OF_TOOL[this.tool] === g) this.curStyle = { ...this.groups[g] };
    if (g === "text") this.textStyle = { ...T.EXTRAS_DEFAULT.text };
    if (g === "shape") { this.shapeKind = T.EXTRAS_DEFAULT.shape.shapeKind; this.fill.shape = T.EXTRAS_DEFAULT.shape.fill; this.updateShapeBtn(); }
    if (g === "mind") { const e = T.EXTRAS_DEFAULT.mind; this.connStyle = e.connStyle; this.connArrow = e.connArrow; this.nodeKind = e.nodeKind; this.fill.mind = e.fill; }
    this.fillKey = ""; this.mindKey = ""; this.fmtKey = ""; this.updateColorDot();
    if (this.brushBox) this.brushBox.update(this.curStyle, this.tool !== "hltext");
    this.render();
    toast(`${T.GROUP_LABEL[g]} reset to default.`);
    return true;
  }
  resetRow(tool) {                                   // the same button in every tool's settings menu
    const g = GROUP_OF_TOOL[tool];
    return el("div", { class: "resetrow" }, el("button", { class: "btn small reset", type: "button", title: `Restore the ${T.GROUP_LABEL[g]} settings to their defaults. Other tools are not changed.`,
      "aria-label": `Reset ${T.GROUP_LABEL[g]} to default`, disabled: this.isToolDefault(tool), onclick: () => { closePopup(); this.resetTool(tool); } }, icon("reset"), "Reset to default"));
  }

  // ------------------------------------------------------------ view / zoom
  onResize() {
    const r = this.stage.getBoundingClientRect();
    if (this.root.hidden || r.width === 0 || r.height === 0) return;     // hidden panel (layout switch): keep its view exactly as it is
    this.cw = Math.max(50, Math.round(r.width)); this.ch = Math.max(50, Math.round(r.height));
    this.dpr = window.devicePixelRatio || 1;
    if (this.pendingCenter) { const c = this.pendingCenter; this.pendingCenter = null; this.applyCenter(c); }
    this.canvas.width = Math.round(this.cw * this.dpr); this.canvas.height = Math.round(this.ch * this.dpr);
    this.canvas.style.width = this.cw + "px"; this.canvas.style.height = this.ch + "px";
    this.root.classList.toggle("narrow", r.width < 700);      // icons only, so the toolbars use fewer rows
    if (this.kind === "board" && !this.view.init && this.offs) { this.view.init = true; this.fitContent(false); }
    else if (this.view.fit && this.hasPage) this.fitView(false); else this.clampView();
    this.positionEditor();
    this.render(); this.scheduleRaster();
  }
  fitView(userAction = true) {
    if (this.kind === "board") { this.fitContent(userAction); return; }
    const doc = this.continuous() && this.offs, v = this.view;
    const w = doc ? this.sizeOf(this.vp)[0] : this.pageDims()[0];
    const margin = this.cw < 500 ? 6 : 14;
    const topDoc = doc ? -v.ty / v.scale : 0;                          // document position at the top edge of the view (kept when the width changes)
    v.scale = clamp((this.cw - 2 * margin) / w, this.minZoom, 6);
    v.fit = true;
    if (doc) {
      v.tx = (this.cw - this.docW * v.scale) / 2;
      v.ty = userAction ? margin - this.offs[this.vp] * v.scale : -topDoc * v.scale;
      this.clampView();
    } else { v.tx = (this.cw - w * v.scale) / 2; v.ty = margin; }
    if (userAction) { this.render(); this.scheduleRaster(); }
  }
  clampView(m = 80) {
    const v = this.view, s = v.scale;
    if (this.continuous() && this.offs) {                      // whole document = one tall column
      const dw = this.docW * s, dh = this.docH * s;
      v.tx = dw <= this.cw ? (this.cw - dw) / 2 : clamp(v.tx, this.cw - dw - m, m);
      v.ty = dh <= this.ch - 16 ? clamp(v.ty, 8, this.ch - dh - 8) : clamp(v.ty, this.ch - dh - m, m);
      return;
    }
    const [w, h] = this.pageDims(), pw = w * s, ph = h * s;
    v.tx = pw <= this.cw ? (this.cw - pw) / 2 : clamp(v.tx, this.cw - pw - m, m);
    v.ty = ph <= this.ch - 16 ? clamp(v.ty, 8, this.ch - ph - 8) : clamp(v.ty, this.ch - ph - m, m);
  }
  zoomAt(factor, cx, cy) {
    const old = this.view.scale, s = clamp(old * factor, this.minZoom, 6), k = s / old;
    this.view.tx = cx - (cx - this.view.tx) * k; this.view.ty = cy - (cy - this.view.ty) * k;
    this.view.scale = s; this.view.fit = false;
    this.clampView(); this.positionEditor(); this.render(); this.scheduleRaster();
  }
  zoomBy(f) { this.zoomAt(f, this.cw / 2, this.ch / 2); }
  /** Top-left corner of the active page, in document space (0,0 for a notebook page). */
  origin() {
    if (this.continuous() && this.offs) return [(this.docW - this.sizeOf(this.cur)[0]) / 2, this.offs[this.cur] || 0];
    return [0, 0];
  }
  pageToScreen(x, y) { const [ox, oy] = this.origin(), v = this.view; return [v.tx + (ox + x) * v.scale, v.ty + (oy + y) * v.scale]; }
  toPage(e) {
    const r = this.stage.getBoundingClientRect();
    return this.screenToPage(e.clientX - r.left, e.clientY - r.top);
  }
  screenToPage(sx, sy) { const [ox, oy] = this.origin(), v = this.view; return { x: (sx - v.tx) / v.scale - ox, y: (sy - v.ty) / v.scale - oy }; }
  clampP(p) { const [w, h] = this.pageDims(); return { x: clamp(p.x, 0, w), y: clamp(p.y, 0, h) }; }

  // ------------------------------------------- continuous PDF: layout of all pages
  // Every page has a slot in one tall column, so scrolling is smooth and page numbers are exact.
  // Page sizes are read lazily (20 at a time, a few pages before they are needed); until then a page
  // takes the size of page 1. Page bitmaps are only made for pages on / next to the screen.
  layout() {
    const n = this.pages.length, o = new Float64Array(n + 1);
    let y = 0, W = 0;
    for (let i = 0; i < n; i++) { const s = this.sizeOf(i); o[i] = y; y += s[1] + GAP; if (s[0] > W) W = s[0]; }
    o[n] = y; this.offs = o; this.docW = W || 595; this.docH = Math.max(1, y - GAP);
  }
  relayoutKeep() {                                   // sizes changed: keep the current page where it is on screen
    const had = this.offs, i = this.vp, before = had ? had[i] : 0;
    this.layout();
    if (had) this.view.ty -= (this.offs[i] - before) * this.view.scale;
    this.clampView(); this.positionEditor();
  }
  pageAt(y) {                                        // page whose slot starts at or above document-y
    const o = this.offs, n = this.pages.length;
    if (!o || n < 1) return 0;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }
  pageNearest(y) {
    const i = this.pageAt(y);
    return i < this.pages.length - 1 && y > this.offs[i] + this.sizeOf(i)[1] + GAP / 2 ? i + 1 : i;
  }
  visibleRange() {
    if (!this.offs) return [0, 0];
    const s = this.view.scale;
    return [this.pageAt(-this.view.ty / s), this.pageAt((this.ch - this.view.ty) / s)];
  }
  pageVisible(i) { const [lo, hi] = this.visibleRange(); return i >= lo && i <= hi; }
  syncVp() {                                         // which page is "the current one" while scrolling
    if (!this.offs) return;
    let v = this.pageNearest((0.35 * this.ch - this.view.ty) / this.view.scale);
    const L = this.vpLock;
    if (L) { if (Math.abs(this.view.ty - L.ty) < 1.5 && Math.abs(this.view.scale - L.s) < 1e-6) v = L.n; else this.vpLock = null; }
    if (v !== this.vp) this.onVp(v);
  }
  onVp(v) {
    this.vp = v;
    if ((!this.action || this.action.type === "pan") && this.selected === null && !this.editing) this.setCur(v);
    this.updatePageUi();
    this.ensureSizesAround();
  }
  updatePageUi() {
    const n = this.pages.length, has = this.hasPage, v = this.shown();
    if (document.activeElement !== this.pageInput) this.pageInput.value = has ? v + 1 : "";
    this.b.prev.disabled = !(has && v > 0); this.b.next.disabled = !(has && v < n - 1);
    if (this.kind === "nb") {
      this.b.earlier.disabled = !(has && v > 0); this.b.later.disabled = !(has && v < n - 1);
      this.paper.value = this.pages[v]?.paper || "lined";
    }
  }
  /** Make page i the page that drawing / editing applies to. */
  setCur(i) {
    if (i === this.cur) return false;
    this.cur = i; this.selected = null; this.live = null; this.preview = null;
    this.words = null; this.wordsPage = -1;
    if (this.tool === "hltext") this.ensureWords();
    return true;
  }
  activateAt(sy) {                                   // page under screen-y becomes the active page
    if (!this.continuous() || !this.offs) return;
    const i = this.pageNearest((sy - this.view.ty) / this.view.scale);
    if (this.setCur(i)) this.ui();
  }
  scrollToPage(n) {
    if (!this.offs) return;
    n = clamp(Math.round(n) || 0, 0, this.pages.length - 1);
    this.setCur(n); this.vp = n;
    const margin = this.cw < 500 ? 6 : 14;
    this.view.ty = margin - this.offs[n] * this.view.scale;
    this.clampView(); this.positionEditor();
    this.vpLock = { n, ty: this.view.ty, s: this.view.scale };
    this.ui(); this.render(); this.scheduleRaster(); this.ensureSizesAround();
  }
  ensureWords() {                                    // text boxes of the active page (for the Highlight tool)
    if (this.kind !== "pdf" || !this.pdf || this.wordsPage === this.cur) return;
    const i = this.cur, doc = this.pdf.doc;
    this.wordsPage = i; this.words = null;
    PDF.pageWords(doc, i).then((w) => { if (this.pdf && this.pdf.doc === doc && this.cur === i) this.words = w; })
      .catch(() => { if (this.wordsPage === i) this.wordsPage = -1; });
  }
  loadSizes(lo, hi) {
    const doc = this.pdf && this.pdf.doc;
    if (!doc) return Promise.resolve();
    const ok = () => this.pdf && this.pdf.doc === doc, jobs = [];
    for (let i = Math.max(0, lo); i < Math.min(this.pages.length, hi); i++) {
      if (this.sizes[i]) continue;
      let j = this.sizeJobs.get(i);
      if (!j) {
        j = PDF.pageSize(doc, i).then((s) => { if (ok()) this.sizes[i] = s; })
          .catch(() => { if (ok()) this.sizes[i] = this.defSize(); })
          .finally(() => this.sizeJobs.delete(i));
        this.sizeJobs.set(i, j);
      }
      jobs.push(j);
    }
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs).then(() => { if (ok()) { this.relayoutKeep(); this.render(); this.scheduleRaster(); } });
  }
  ensureSizesAround() {                              // when within 5 pages of the loaded end, read the next 20 sizes
    if (!this.offs || this.kind !== "pdf") return;
    const n = this.pages.length, v = this.vp, [lo, hi] = this.visibleRange();
    let m = -1;
    for (let i = v; i <= Math.min(n - 1, v + 5); i++) if (!this.sizes[i]) { m = i; break; }
    if (m >= 0) this.loadSizes(m, m + 20).catch(() => {});
    m = -1;
    for (let i = v - 1; i >= Math.max(0, v - 5); i--) if (!this.sizes[i]) { m = i; break; }
    if (m >= 0) this.loadSizes(m - 19, m + 1).catch(() => {});
    this.loadSizes(lo, hi + 1).catch(() => {});
  }
  resetDoc() {                                       // called when another PDF is opened / closed
    this.rasterJob?.cancel(); this.rasterJob = null; clearTimeout(this.rasterTimer); this.stopFling();
    for (const r of this.rasters.values()) freeCanvas(r.canvas);
    this.rasters.clear(); this.badPages = new Set(); this.sizeJobs = new Map();
    this.sizes = []; this.offs = null; this.vp = 0; this.vpLock = null; this.words = null; this.wordsPage = -1;
  }

  // ----------------------------------------------------- touch momentum scroll
  stopFling() { if (this.fling) { cancelAnimationFrame(this.fling); this.fling = 0; } }
  flingFrom(samples) {
    const now = performance.now(), s = (samples || []).filter((p) => now - p.t < 100);
    if (s.length < 2) return;
    const a = s[0], b = s[s.length - 1], dt = b.t - a.t;
    if (dt < 8) return;
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    if (Math.hypot(vx, vy) < 0.15) return;
    this.startFling(vx, vy);
  }
  startFling(vx, vy) {
    this.stopFling();
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(50, now - last); last = now;
      const v = this.view; v.tx += vx * dt; v.ty += vy * dt;
      const px = v.tx, py = v.ty; this.clampView();
      if (v.tx !== px) vx = 0;
      if (v.ty !== py) vy = 0;
      const k = Math.exp(-dt / 325); vx *= k; vy *= k;
      this.render(); this.scheduleRaster();
      this.fling = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    this.fling = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------- PDF page bitmaps
  wantFor(i) {                                       // bitmap scale for page i at the current zoom
    const [w, h] = this.sizeOf(i);
    let want = clamp(this.view.scale * this.dpr, 0.5, 6);
    while (w * want * h * want > 14e6 && want > 0.5) want *= 0.9;
    return want;
  }
  needsRaster(i) {
    if (this.badPages.has(i)) return false;
    const r = this.rasters.get(i), want = this.wantFor(i);
    return !r || r.scale < want * 0.9 || r.scale > want * 2.5;
  }
  missingVisible() {
    const [lo, hi] = this.visibleRange();
    for (let i = lo; i <= hi; i++) if (!this.rasters.has(i) && !this.badPages.has(i)) return true;
    return false;
  }
  scheduleRaster() {
    if (this.kind !== "pdf" || !this.pdf || !this.offs) return;
    clearTimeout(this.rasterTimer);
    // a page that is on screen with no bitmap yet starts at once; re-sharpening after a zoom waits for it to settle
    this.rasterTimer = setTimeout(() => this.pumpRaster(), this.missingVisible() ? 0 : 120);
  }
  async pumpRaster() {
    if (this.kind !== "pdf" || !this.pdf || !this.offs) return;
    this.ensureSizesAround();
    const doc = this.pdf.doc, n = this.pages.length, [lo, hi] = this.visibleRange(), c = this.vp, wanted = [];
    let px = 0;
    for (const r of this.rasters.values()) px += r.canvas.width * r.canvas.height;
    for (let i = Math.max(0, lo - 1); i <= Math.min(n - 1, hi + 1); i++) {
      if (!this.needsRaster(i)) continue;
      if (i < lo || i > hi) {                      // pre-render of a neighbour: only if it fits in the memory budget (else it would be evicted at once)
        const [w, h] = this.sizeOf(i), want = this.wantFor(i);
        if (px + w * want * h * want > RASTER_BUDGET || (!this.rasters.has(i) && this.rasters.size >= RASTER_MAX)) continue;
      }
      wanted.push(i);
    }
    const vis = (i) => (i >= lo && i <= hi ? 0 : 1);
    wanted.sort((a, b) => vis(a) - vis(b) || Math.abs(a - c) - Math.abs(b - c));
    const cur = this.rasterJob;
    if (cur) {
      if (wanted.includes(cur.page) && Math.abs(cur.scale / this.wantFor(cur.page) - 1) < 0.1) return;   // still useful: let it finish
      cur.cancel();
    }
    if (!wanted.length) { this.evictRasters(); return; }
    const i = wanted[0], want = this.wantFor(i), j = PDF.renderRaster(doc, i, want);
    const job = { page: i, scale: want, cancel: () => j.cancel() };
    this.rasterJob = job;
    try {
      const canvas = await j.promise;
      if (canvas && this.pdf && this.pdf.doc === doc) {
        const old = this.rasters.get(i);
        this.rasters.set(i, { canvas, scale: want });
        if (old) freeCanvas(old.canvas);
        this.evictRasters(); this.render();
      } else if (canvas) freeCanvas(canvas);
    } catch (e) {
      if (this.pdf && this.pdf.doc === doc) { console.error(e); this.badPages.add(i); }
    } finally { if (this.rasterJob === job) this.rasterJob = null; }
    if (this.pdf && this.pdf.doc === doc) this.pumpRaster();
  }
  evictRasters() {                                   // keep memory low: drop bitmaps of pages far from the screen
    if (!this.offs || !this.pdf) return;
    const [lo, hi] = this.visibleRange(), c = this.vp, doc = this.pdf.doc;
    let total = 0;
    for (const r of this.rasters.values()) total += r.canvas.width * r.canvas.height;
    const order = [...this.rasters.keys()].filter((i) => i < lo || i > hi).sort((a, b) => Math.abs(b - c) - Math.abs(a - c));
    for (const i of order) {
      const r = this.rasters.get(i), far = i < lo - 2 || i > hi + 2;
      if (!(far || total > RASTER_BUDGET || this.rasters.size > RASTER_MAX)) continue;
      total -= r.canvas.width * r.canvas.height;
      freeCanvas(r.canvas); this.rasters.delete(i); PDF.releasePage(doc, i);
    }
  }

  // ----------------------------------------------------------------- drawing
  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }
  draw() {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = "#c9ccd1"; ctx.fillRect(0, 0, this.cw, this.ch);
    this.updateFmtUi(); this.updateFillUi(); this.updateMindUi();
    this.msg.hidden = this.hasPage;
    if (!this.hasPage) return;
    this.drawDoc(ctx);
    this.drawEraserCursor(ctx);
  }
  /** Continuous view (PDF and notebook): draws only the pages that are on screen. */
  drawDoc(ctx) {
    if (!this.offs) return;
    this.syncVp();
    const v = this.view, s = v.scale, [lo, hi] = this.visibleRange();
    ctx.save();
    ctx.translate(v.tx, v.ty); ctx.scale(s, s);
    for (let i = lo; i <= hi; i++) {
      const [w, h] = this.sizeOf(i), isCur = i === this.cur;
      ctx.save();
      ctx.translate((this.docW - w) / 2, this.offs[i]);
      const board = this.kind === "board", page = this.pages[i];
      if (!board) { const m = ctx.getTransform(); ctx.translate((Math.round(m.e) - m.e) / m.a, (Math.round(m.f) - m.f) / m.d); }      // the page edge on a whole device pixel: crisp lines, and a cached page bitmap is copied 1:1 (identical to drawing it live)
      if (!board) { ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 8 / s; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.shadowColor = "transparent"; }   // (no soft shadow around a huge board: blurring a 4000 px rectangle every frame is far too slow)
      // A page nobody is changing is drawn once into a bitmap (paper + all its items) and then only copied while scrolling / panning.
      const changing = isCur && (this.live || this.editing), cached = !board && !changing && (this.kind === "nb" || page.items.length > 0);
      if (this.kind === "nb") { if (cached) ctx.drawImage(this.pageLayer(i, w, h, page).canvas, 0, 0, w, h); else R.drawPaper(ctx, w, h, page); }
      else if (board) R.drawBoardBg(ctx, w, h, page, [-v.tx / s, -v.ty / s, (this.cw - v.tx) / s, (this.ch - v.ty) / s]);
      else { const r = this.rasters.get(i); if (r) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(r.canvas, 0, 0, w, h); } if (cached) ctx.drawImage(this.pageLayer(i, w, h, page).canvas, 0, 0, w, h); }
      const list = isCur ? this.drawList : page.items;
      if (cached ? (isCur && this.preview) : (list.length || (isCur && this.preview))) {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
        const nodes = this.nodeMapFor(list, isCur ? this.preview : null);
        const o = board ? { theme: R.boardTheme(page.paper), bg: R.BOARD_COLORS[page.paper], nodes } : { nodes };
        const vis = board ? [-v.tx / s, -v.ty / s, (this.cw - v.tx) / s, (this.ch - v.ty) / s] : null;
        for (let k = 0; !cached && k < list.length; k++) {
          if (vis && list[k].t !== "conn") { const bb = this.boundsOf(list[k]); if (bb[2] < vis[0] || bb[0] > vis[2] || bb[3] < vis[1] || bb[1] > vis[3]) continue; }   // off-screen items are skipped
          const ed = isCur && this.editing && this.editing.idx === k ? this.editing : null;
          if (ed && ed.rich) this.drawEditBg(ctx, list[k]);
          R.drawItem(ctx, list[k], { ...o, skipText: !!ed && !ed.rich });          // (a text box being edited is drawn live like any other, so typing looks like the result)
        }
        if (isCur && this.preview) for (const p of [].concat(this.preview)) { if (this.editing && this.editing.rich && p.t === "text") this.drawEditBg(ctx, p); R.drawItem(ctx, p, o); }
        if (isCur && this.linkTarget && o.nodes) { const n = o.nodes.get(this.linkTarget); if (n) { ctx.strokeStyle = "#1976d2"; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.strokeRect(Math.min(n.x1, n.x2) - 5, Math.min(n.y1, n.y2) - 5, Math.abs(n.x2 - n.x1) + 10, Math.abs(n.y2 - n.y1) + 10); } }
        ctx.restore();
      }
      if (isCur && this.editing && this.editing.rich) this.drawRichCaret(ctx);
      if (isCur && this.selected !== null && list[this.selected]) this.drawSelection(ctx, list[this.selected]);
      ctx.restore();
    }
    ctx.restore();
    const list = this.drawList;
    const hs = this.handleSubject(list); if (hs) this.drawHandles(ctx, hs.d, hs.i);
  }
  /** The item the resize handles belong to: the selected one, or the node whose text is being typed (it can be resized without leaving the editor). None with the Link tool. */
  handleSubject(list = this.drawList) {
    if (this.tool === "link") return null;
    const ed = this.editing;
    if (ed) { const d = ed.idx === null ? ed.proto : list[ed.idx]; return d && d.t === "node" && !ed.rich ? { d, i: ed.idx } : null; }
    return this.selected !== null && list[this.selected] ? { d: list[this.selected], i: this.selected } : null;
  }
  /** The caret and the selection of the text box that is being edited, drawn in the same frame as its text and from the same layout (render.js caretAt / selectionRects).
   *  The editor element only supplies the character offsets: where they are on the page is never read back from the browser's own text engine. */
  drawRichCaret(ctx) {
    const d = this.editedItem(); if (!d || d.t !== "text") return;
    const [a, b] = this.rt.getSel(), s = this.view.scale;
    ctx.save();
    if (a !== b) { ctx.fillStyle = "rgba(25,118,210,.32)"; for (const r of R.selectionRects(d, a, b)) ctx.fillRect(r.x0, r.top, r.x1 - r.x0, r.bottom - r.top); }
    else if (this.caretOn) {
      const c = R.caretAt(d, a), w = Math.max(1.4 / s, c.size * 0.06);                    // (at least 1.4 screen px thick, thicker with big letters)
      if (!this.caretColor) this.caretColor = getComputedStyle(this.stage).getPropertyValue("--accent").trim() || "#1976d2";
      ctx.fillStyle = this.caretColor; ctx.fillRect(c.x - w / 2, c.top, w, c.bottom - c.top);
    }
    ctx.restore();
  }
  /** The caret shows (solid) now and starts blinking again; called whenever the text or the selection changed. */
  caretReset() {
    clearInterval(this.caretTimer); this.caretTimer = 0; this.caretOn = true;
    if (!this.editing || !this.editing.rich) return;
    if (!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) this.caretTimer = setInterval(() => { this.caretOn = !this.caretOn; this.render(); }, 530);
  }
  caretStop() { clearInterval(this.caretTimer); this.caretTimer = 0; this.caretOn = true; }
  /** The light backing of a free text box while it is edited (on ruled paper the lines show through). */
  /** The box of the text being edited: a light backing (not on ruled paper / a blackboard) and the dashed outline. Both come from the same layout as the text and are drawn in the same
   *  frame, so the outline follows every wrap at once (the browser's element for it used to be sized by the browser's own, later, layout of an invisible copy of the text). */
  drawEditBg(ctx, d) {
    if (d.t !== "text") return;
    const b = R.textBox(d), s = this.view.scale; ctx.save();
    if (d.ruled !== true && !(this.kind === "board" && R.boardTheme(this.pages[this.cur].paper))) { ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
    if (!this.caretColor) this.caretColor = getComputedStyle(this.stage).getPropertyValue("--accent").trim() || "#1976d2";
    ctx.strokeStyle = this.caretColor; ctx.lineWidth = 1.5 / s; ctx.setLineDash([5 / s, 3.5 / s]);
    ctx.strokeRect(b[0] - 0.75 / s, b[1] - 0.75 / s, b[2] - b[0] + 1.5 / s, b[3] - b[1] + 1.5 / s);
    ctx.restore();
  }
  /** Bitmap of a finished page (notebook: paper + items; PDF: the annotations). Rebuilt when its items / paper / fonts / pictures change or the zoom moved a lot. */
  pageLayer(i, w, h, page) {
    const pdf = this.kind === "pdf", want = this.wantFor(i), tick = ++this.layerTick;
    const sig = pdf ? "" : [page.paper, page.spacing, page.margin, page.margin_x, page.dir, page.cue, page.summary, page.week_start].join("|"), ep = R.assetEpoch + ":" + R.fontEpoch;
    let L = this.layers.get(i);
    const fresh = !!L && L.items === page.items && L.sig === sig && L.ep === ep;
    if (fresh) {
      L.used = tick;
      if (L.scale < want * 0.9 || L.scale > want * 2.5) this.scheduleLayers();      // zoomed: keep showing the old bitmap, sharpen it when the zoom settles
      return L;
    }
    const canvas = L ? L.canvas : document.createElement("canvas");
    R.renderPage(canvas, w, h, page.items, { paper: pdf ? null : page, scale: want });
    R.stats.pageBuilds++;
    L = { canvas, scale: want, items: page.items, sig, ep, used: tick };
    this.layers.set(i, L);
    this.evictLayers();
    return L;
  }
  scheduleLayers() {
    if (this.layerTimer) return;
    this.layerTimer = setTimeout(() => {
      this.layerTimer = 0;
      for (const [i, L] of this.layers) if (L.scale < this.wantFor(i) * 0.9 || L.scale > this.wantFor(i) * 2.5) this.layers.delete(i);
      this.render();
    }, 150);
  }
  evictLayers() {
    let px = 0; for (const L of this.layers.values()) px += L.canvas.width * L.canvas.height;
    if (this.layers.size <= LAYER_MAX && px <= LAYER_BUDGET) return;
    const [lo, hi] = this.visibleRange(), order = [...this.layers.entries()].filter(([i]) => i < lo || i > hi).sort((a, b) => a[1].used - b[1].used);
    for (const [i, L] of order) { if (this.layers.size <= LAYER_MAX && px <= LAYER_BUDGET) break; px -= L.canvas.width * L.canvas.height; L.canvas.width = L.canvas.height = 0; this.layers.delete(i); }
  }
  geom(i, list = this.drawList) {
    const d = list[i];
    return d.t === "text" ? R.textBox(d) : M.geomBox(d, null, d.t === "conn" ? this.nodeMapFor(list) : null);
  }
  boundsOf(d) { let b = this._bc.get(d); if (!b) { b = R.itemBounds(d, null); this._bc.set(d, b); } return b; }     // (items are replaced, not edited in place, so this cache stays valid)
  /** id -> node for the connectors of this item list (cached per list; extra = items being previewed, e.g. a node still being typed). */
  nodeMapFor(list, extra = null) {
    const ex = extra ? [].concat(extra) : [];
    if (!(M.hasConns(list) || M.hasConns(ex))) return null;
    const c = this._nm;
    if (c && c.list === list && c.extra === extra) return c.map;
    const map = M.nodeIndex(list); for (const d of ex) if (d.t === "node" && d.id) map.set(d.id, d);
    this._nm = { list, extra, map };
    return map;
  }
  selInfo(d, i) {
    const g = i === null ? M.geomBox(d) : this.geom(i), e = 3 / Math.max(1, this.view.scale * 0.6) + M.halfWidth(d);      // handle gap in page units
    return { g, e, pos: M.handlePositions(d, g, e) };
  }
  drawSelection(ctx, d) {
    if (this.editing) return;
    const i = this.selected, { g, e } = this.selInfo(d, i), s = this.view.scale;
    ctx.save();
    ctx.strokeStyle = "#1976d2"; ctx.lineWidth = 1.4 / s; ctx.setLineDash([5 / s, 4 / s]);
    if (d.t === "conn") {                                   // a connector: highlight its path
      const gg = M.connGeometry(d, this.nodeMapFor(this.drawList) || new Map());
      if (gg) { ctx.setLineDash([]); ctx.strokeStyle = "rgba(25,118,210,.45)"; ctx.lineWidth = d.w + 8 / s; ctx.beginPath(); gg.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      ctx.restore(); return;
    }
    if (d.t === "line" || d.t === "arrow") ctx.strokeRect(g[0] - e, g[1] - e, g[2] - g[0] + 2 * e, g[3] - g[1] + 2 * e);
    else ctx.strokeRect(g[0] - e, g[1] - e, g[2] - g[0] + 2 * e, g[3] - g[1] + 2 * e);
    ctx.restore();
  }
  drawHandles(ctx, d, i = this.selected) {
    const { pos } = this.selInfo(d, i), v = this.view;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const [x, y] of Object.values(pos)) {
      const [hx, hy] = this.pageToScreen(x, y);
      ctx.beginPath(); ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#1976d2"; ctx.stroke();
    }
    ctx.restore();
  }
  handleAt(sx, sy, ptype) {
    const hs = this.handleSubject(this.items); if (!hs) return null;
    const { pos } = this.selInfo(hs.d, hs.i), v = this.view;
    const r = ptype === "touch" ? 24 : 14;
    let best = null, bd = r;
    for (const [name, [x, y]] of Object.entries(pos)) {
      const [px, py] = this.pageToScreen(x, y), d = Math.hypot(px - sx, py - sy);
      if (d <= bd) { bd = d; best = name; }
    }
    return best;
  }

  // -------------------------------------------------------------- hit testing
  tol() { return Math.max(3, 10 / this.view.scale); }
  hitItem(list, i, p, tol) {
    const d = list[i];
    if (d.t === "text") { const b = R.textBox(d); return p.x >= b[0] - tol && p.x <= b[2] + tol && p.y >= b[1] - tol && p.y <= b[3] + tol; }
    return M.hitTest(d, p.x, p.y, tol, d.t === "conn" ? this.nodeMapFor(list) : null);
  }
  hit(p, list = this.items) {
    const tol = this.tol();
    for (let i = list.length - 1; i >= 0; i--) if (this.hitItem(list, i, p, tol)) return i;
    return null;
  }

  // ------------------------------------------------------------- committing
  commit(newItems, { keepSel = false, select = null, flowIdx = null } = {}) {
    newItems = M.pruneOrphans(newItems);                                  // a deleted node takes its connectors with it
    this.history.push(this.snap(), this.cur);
    this.pages[this.cur].items = newItems;
    if (flowIdx !== null && newItems[flowIdx] && newItems[flowIdx].t === "text") { newItems = null; this.reflowAt(this.cur, flowIdx); newItems = this.pages[this.cur].items; }   // a long text box continues on the next page
    this.live = null; this.preview = null;
    this.selected = select !== null ? select : (keepSel ? this.selected : null);
    if (this.selected !== null && this.selected >= newItems.length) this.selected = null;
    this.dirty = true;
    this.app.onChange(this);
    this.ui(); this.render();
  }
  // ---- keyboard: temporary tool, panel-level shortcuts (the app routes keys here; typing in a field never reaches this code)
  beginTempTool(tool) {
    if (this.editing || this.action || this.tempPrev != null || !this.toolBtns[tool] || this.tool === tool) return false;
    this.tempPrev = this.tool; this.setTool(tool, false, true);
    return true;
  }
  endTempTool() {
    if (this.tempPrev == null) return false;
    const prev = this.tempPrev; this.tempPrev = null;
    if (this.toolBtns[prev]) { this.setTool(prev, false, true); if (!["select", "node", "link"].includes(prev)) this.selected = null; this.render(); }
    return true;
  }
  scrollViewBy(dx, dy) { this.stopFling(); this.view.tx -= dx; this.view.ty -= dy; this.clampView(); this.positionEditor(); this.render(); this.scheduleRaster(); }
  /** Plain-key shortcuts for this panel. Returns true when the key was used. (Key repeat is ignored for tool / toggle keys.) */
  handleKey(e, key) {
    if (this.editing || this.root.hidden || !this.hasPage) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && key === ".") { this.setBars(!this.barsOpen); return true; }
    if (mod || e.altKey) return false;
    if (!e.shiftKey) {
      const tool = K.TOOL_BY_KEY[key];
      if (tool && this.toolBtns[tool]) { if (!e.repeat && !this.action) this.setTool(tool); return true; }
      if (key === K.FILL_KEY.toLowerCase() && !this.fillBtn.hidden) { if (!e.repeat && !this.fillBtn.disabled) this.toggleFill(); return true; }
    }
    const step = e.shiftKey ? 240 : 60;
    switch (key) {
      case "+": this.zoomBy(1.15); return true;
      case "-": this.zoomBy(1 / 1.15); return true;
      case "0": if (e.shiftKey) return false; this.fitView(); return true;
      case "ArrowUp": this.scrollViewBy(0, -step); return true;
      case "ArrowDown": this.scrollViewBy(0, step); return true;
      case "ArrowLeft": this.scrollViewBy(-step, 0); return true;
      case "ArrowRight": this.scrollViewBy(step, 0); return true;
      case "PageUp": this.scrollViewBy(0, -0.9 * this.ch); return true;
      case "PageDown": this.scrollViewBy(0, 0.9 * this.ch); return true;
      case "Home": if (this.kind === "board") this.fitContent(); else this.goto(0); return true;
      case "End": if (this.kind === "board") this.fitContent(); else this.goto(this.pages.length - 1); return true;
    }
    return false;
  }
  undo() { if (this.editing || this.action) return; if (this.history.canUndo()) this.historyStep(this.history.undoStep(this.snap())); }
  redo() { if (this.editing || this.action) return; if (this.history.canRedo()) this.historyStep(this.history.redoStep(this.snap())); }
  async historyStep([state, idx]) {
    this.restoreSnap(state);
    this.selected = null; this.live = null; this.preview = null; this.dirty = true;
    idx = clamp(idx, 0, this.pages.length - 1);
    if (this.kind === "nb") { this.layout(); this.vp = clamp(this.vp, 0, this.pages.length - 1); this.clampView(); }   // pages may have been added / removed
    this.setCur(idx);
    if (!this.pageVisible(idx)) this.scrollToPage(idx); else this.ui();
    this.render();
    this.app.onChange(this); this.ui();
  }

  // ----------------------------------------------------------------- pointers
  styleExtra() { return { alpha: this.curStyle.alpha, bright: this.curStyle.bright }; }
  onWheel(e) {
    e.preventDefault();
    if (!this.hasPage) return;
    this.stopFling();
    const r = this.stage.getBoundingClientRect(), k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.ch : 1;
    if (e.ctrlKey || e.metaKey) { this.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top); return; }
    this.view.tx -= (e.shiftKey ? e.deltaY : e.deltaX) * k; this.view.ty -= (e.shiftKey ? 0 : e.deltaY) * k;
    if (!this.continuous()) this.view.fit = false;
    this.clampView(); this.positionEditor(); this.render(); this.scheduleRaster();
  }
  local(e) { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  onDown(e) {
    if (!this.hasPage || e.button > 0) return;
    this.stopFling();
    const inEditor = e.target === this.ta || this.rt.el.contains(e.target);
    const wasEditing = !!this.editing && !inEditor;
    const l0 = this.local(e), onNodeHandle = wasEditing && (this.tool === "node" || this.tool === "select") && !!this.handleAt(l0.x, l0.y, e.pointerType);      // (checked before the editor closes)
    if (wasEditing) this.finishEdit();
    if (inEditor) return;
    e.preventDefault();
    this.stage.setPointerCapture(e.pointerId);
    const l = this.local(e);
    this.pointers.set(e.pointerId, { x: l.x, y: l.y, type: e.pointerType });
    if (wasEditing && this.pointers.size === 1 && !(onNodeHandle && this.selected !== null)) { this.action = { type: "none" }; return; }       // this tap only closes the editor (a press on a handle of the node just typed goes on to resize it)
    if (e.pointerType === "pen") this.lastPen = performance.now();
    if (this.pointers.size === 2) { this.startGesture(); return; }
    if (this.pointers.size > 2) return;
    if (e.pointerType === "touch" && performance.now() - this.lastPen < 1200) { this.action = { type: "palm" }; return; }   // palm rejection while a pen is in use
    closePopup();
    this.toolDown(e, l);
  }
  onMove(e) {
    const pt = this.pointers.get(e.pointerId);
    if (!pt) { this.onHover(e); return; }
    const l = this.local(e); pt.x = l.x; pt.y = l.y;
    if (this.gesture) { this.updateGesture(); return; }
    if (!this.action) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    this.toolMove(e, l, evs.length ? evs : [e]);
  }
  onUp(e, cancelled = false) {
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;
    try { this.stage.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (this.gesture) { if (this.pointers.size < 2) this.gesture = null; this.action = null; return; }
    if (!this.action) return;
    if (cancelled) { this.cancelAction(); return; }
    this.toolUp(e, this.local(e));
  }
  startGesture() {
    this.cancelAction();
    const [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.gesture = { dist, scale: this.view.scale, wx: (cx - this.view.tx) / this.view.scale, wy: (cy - this.view.ty) / this.view.scale };
  }
  updateGesture() {
    const [a, b] = [...this.pointers.values()], g = this.gesture;
    if (!b) return;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.view.scale = clamp(g.scale * dist / g.dist, this.minZoom, 6); this.view.fit = false;
    this.view.tx = cx - g.wx * this.view.scale; this.view.ty = cy - g.wy * this.view.scale;
    this.clampView(); this.positionEditor(); this.render(); this.scheduleRaster();
  }
  cancelAction() { this.action = null; this.preview = null; this.live = null; this.render(); }

  toolDown(e, l) {
    if (this.continuous() && this.tool !== "pan") {        // the page under the finger/pen becomes the active page
      const onHandle = this.tool === "select" && this.handleAt(l.x, l.y, e.pointerType);
      if (!onHandle) this.activateAt(l.y);
    }
    if (this.tool === "hltext") this.ensureWords();
    const p = this.toPage(e), t = this.tool;
    if (t === "pan") { this.action = { type: "pan", last: l }; return; }
    if (t === "select") {
      const h = this.handleAt(l.x, l.y, e.pointerType);
      if (h) {
        this.action = { type: "resize", h, orig: this.items[this.selected], tbox: this.geom(this.selected, this.items), base: this.items.slice(), e: this.selInfo(this.items[this.selected], this.selected).e };
        return;
      }
      const idx = this.hit(p);
      if (idx !== null) { this.selected = idx; this.action = { type: "move", idx, p0: p, orig: this.items[idx], moved: false, l0: l }; this.render(); }
      else { this.selected = null; this.action = { type: "pan", last: l, tap: true, l0: l }; this.render(); }
      return;
    }
    if (t === "pen" || t === "mark") {
      const c = this.clampP(p);
      this.action = { type: "stroke", pts: [[c.x, c.y]] };
      this.updateStrokePreview();
      return;
    }
    if (t === "shape" || t === "hltext") { this.action = { type: "shape", p0: this.clampP(p), l0: l, moved: false }; return; }
    if (t === "eraser") { this.live = this.items.slice(); this.action = { type: "erase", last: p, changed: false }; this.eraseAt(p); return; }
    if (t === "text" || t === "note") { this.action = { type: "tap", p, l0: l, moved: false }; return; }
    if (t === "node") {                                       // tap empty space = new auto-sized node, drag = a node of the dragged size; an item that is hit is selected / moved / resized like with Select
      const h = this.handleAt(l.x, l.y, e.pointerType);
      if (h) { this.action = { type: "resize", h, orig: this.items[this.selected], tbox: this.geom(this.selected, this.items), base: this.items.slice(), e: this.selInfo(this.items[this.selected], this.selected).e }; return; }
      const idx = this.hit(p);
      if (idx !== null) { this.selected = idx; this.action = { type: "move", idx, p0: p, orig: this.items[idx], moved: false, l0: l }; this.render(); }
      else { this.selected = null; this.action = { type: "nodetap", p, l0: l, moved: false }; this.render(); }
      return;
    }
    if (t === "link") {                                       // drag from a node; on empty space the finger scrolls
      const idx = this.hit(p), d = idx !== null ? this.items[idx] : null;
      if (d && d.t === "node") { this.selected = idx; this.action = { type: "link", from: d.id, l0: l }; this.render(); }
      else this.action = { type: "pan", last: l };
      return;
    }
  }
  toolMove(e, l, evs) {
    const a = this.action;
    if (a.type === "palm" || a.type === "none") return;
    if (a.type === "pan") {
      this.view.tx += l.x - a.last.x; this.view.ty += l.y - a.last.y; a.last = l;
      if (!this.continuous()) this.view.fit = false;
      (a.samples || (a.samples = [])).push({ t: performance.now(), x: l.x, y: l.y }); if (a.samples.length > 8) a.samples.shift();
      if (a.l0 && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) > 6) a.tap = false;
      this.clampView(); this.render(); this.scheduleRaster(); return;
    }
    const p = this.toPage(e);
    if (a.type === "stroke") {
      for (const ev of evs) {
        const c = this.clampP(this.toPage(ev)), last = a.pts[a.pts.length - 1];
        if (Math.hypot(c.x - last[0], c.y - last[1]) >= 0.4) a.pts.push([c.x, c.y]);
      }
      this.updateStrokePreview(); return;
    }
    if (a.type === "shape") {
      if (Math.hypot(l.x - a.l0.x, l.y - a.l0.y) > 3) a.moved = true;
      this.preview = this.shapeItems(a.p0, this.clampP(p), e.shiftKey); this.render(); return;
    }
    if (a.type === "erase") { this.eraseAt(p); return; }
    if (a.type === "move") {
      const dx = p.x - a.p0.x, dy = p.y - a.p0.y;
      if (!a.moved && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) > 4) a.moved = true;
      if (a.moved) { this.live = this.items.slice(); this.live[a.idx] = this.settle(M.translate(a.orig, dx, dy)); this.render(); }
      return;
    }
    if (a.type === "resize") {
      const c = this.clampP(p);
      this.live = this.items.slice();
      this.live[this.selected] = this.clampNode(this.settle(M.resizeItem(a.orig, a.h, c.x, c.y, a.tbox, a.e, e.shiftKey)), a.h);
      this.render(); return;
    }
    if (a.type === "tap" && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) > 8) a.moved = true;
    if (a.type === "nodetap" && Math.hypot(l.x - a.l0.x, l.y - a.l0.y) > 8) { a.moved = true; this.preview = [this.dragNode(a.p, this.clampP(p))]; this.render(); }
    if (a.type === "link") {
      const c = this.clampP(p), idx = this.hit(c), tn = idx !== null && this.items[idx].t === "node" && this.items[idx].id !== a.from ? this.items[idx].id : null;
      this.linkTarget = tn; const st = this.curStyle;
      this.preview = [{ t: "conn", from: a.from, toPt: [c.x, c.y], style: this.connStyle, arrow: false, color: st.color, w: Math.max(1.5, st.width) }];
      this.render();
    }
  }
  toolUp(e, l) {
    const a = this.action; this.action = null;
    if (a.type === "palm" || a.type === "none") return;
    const p = this.toPage(e);
    if (a.type === "pan") {
      if (a.tap) this.tapSelect(null, l);
      else if (this.continuous() && e.pointerType === "touch") this.flingFrom(a.samples);
      return;
    }
    if (a.type === "stroke") {
      const pts = a.pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      const st = this.curStyle;
      this.commit([...this.items, { t: this.tool, pts, color: st.color, w: st.width, ...this.styleExtra() }]);
      return;
    }
    if (a.type === "shape") {
      const c = this.clampP(p);
      this.preview = null;
      if (this.tool === "hltext") {
        const items = this.shapeItems(a.p0, c, false);
        if (items.length && Math.hypot(c.x - a.p0.x, c.y - a.p0.y) >= 3) this.commit([...this.items, ...items]); else this.render();
      } else if (Math.hypot(c.x - a.p0.x, c.y - a.p0.y) >= 2) this.commit([...this.items, this.shapeItems(a.p0, c, e.shiftKey)[0]]);
      else this.render();
      return;
    }
    if (a.type === "erase") {
      const live = this.live; this.live = null;
      if (e.pointerType === "touch") this.eraserPos = null;
      if (live && a.changed) this.commit(live); else this.render();
      return;
    }
    if (a.type === "move") {
      const live = this.live; this.live = null;
      if (a.moved && live) { const dx = p.x - a.p0.x, dy = p.y - a.p0.y; if (Math.hypot(dx, dy) >= 0.5) { this.commit(live, { keepSel: true, flowIdx: a.idx }); return; } }
      this.render(); this.tapSelect(a.idx, l); return;
    }
    if (a.type === "resize") {
      const live = this.live; this.live = null;
      if (live && JSON.stringify(live[this.selected]) !== JSON.stringify(this.items[this.selected])) this.commit(live, { keepSel: true, flowIdx: this.selected }); else this.render();
      return;
    }
    if (a.type === "tap" && !a.moved) this.tapCreate(a.p);
    if (a.type === "nodetap" && !a.moved) this.createNodeAt(a.p);
    if (a.type === "nodetap" && a.moved) { const n = this.dragNode(a.p, this.clampP(p)); this.preview = null; this.startEdit(null, n, null); }
    if (a.type === "link") this.finishLink(a, this.clampP(p));
  }
  deleteSelected() {
    if (this.selected === null || this.editing || this.action || !this.items[this.selected]) return false;
    const items = this.items.slice(); items.splice(this.selected, 1);
    this.commit(items); return true;
  }
  deselect() { if (this.selected !== null) { this.selected = null; this.render(); } }
  async saveSeparately() { return this.kind === "pdf" ? this.saveAnnotated() : this.kind === "board" ? this.saveBoard() : this.saveNotebook(); }
  tapSelect(idx, l) {                       // double-tap on text / note edits it
    const now = performance.now(), prev = this.lastTap;
    if (idx !== null && idx !== undefined && prev && prev.idx === idx && now - prev.t < 450) {
      const d = this.items[idx];
      if (d && (d.t === "text" || d.t === "note" || d.t === "node" || d.t === "conn")) { this.lastTap = null; this.startEdit(idx); return; }   // double-tap edits text / node / connector label
    }
    this.lastTap = idx === null ? null : { idx, t: now };
    this.app.onSelect?.(this);
    this.syncStyleToSelection();
  }
  syncStyleToSelection() {
    if (this.tool !== "select" || this.selected === null) return;
    const d = this.items[this.selected];
    if (!d) return;
    this.curStyle = { color: d.color ?? this.curStyle.color, width: d.w ?? this.curStyle.width, size: d.size ?? this.curStyle.size,
      alpha: M.itemAlpha(d), bright: M.itemBright(d) };
    this.updateColorDot();
  }
  tapCreate(p) {
    const t = this.tool, idx = this.hit(p), [w, h] = this.pageDims(), st = this.curStyle;
    if (idx !== null && this.items[idx].t === t) { this.selected = idx; this.startEdit(idx); return; }
    if (t === "text") {
      const geo = this.kind === "nb" ? this.pageGeo() : null;
      const f = this.fmt, r2 = (v) => Math.round(v * 100) / 100;
      // New text starts as a tiny auto-sized box (g) at the tapped point and grows with the text, from the edge it is aligned to, up to the edge of the writing area of this
      // surface (see textBounds), where it wraps. Nothing has to be sized by hand: tap and type.
      const [blo, bhi] = this.textBounds(), ax = clamp(p.x, blo, bhi);                    // (a tap in the margin / cue column / outside the writing area starts at its edge)
      const w0 = r2(2 * R.TEXT_PAD + st.size * 1.2), x0 = f.align === "right" ? ax - w0 : f.align === "center" ? ax - w0 / 2 : ax;
      const proto = { t: "text", x: r2(x0), y: clamp(p.y - st.size * 0.7, 0, h - 10), w: w0, g: true, dir: f.dir, align: f.align,
        text: "", color: st.color, size: st.size, ...this.styleExtra() };
      if (this.linedPage()) {                                  // ruled paper: the first line goes in the tapped row, every line rests on a rule
        proto.ruled = this.snapLines;
        if (proto.ruled) { proto.y = R.ruledYFromTap(p.y, st.size, h, geo.pitch, geo.lastRule); if (geo.pitch !== M.RULE_PITCH) proto.rp = geo.pitch; }
      }
      this.startEdit(null, proto);
    } else {
      const proto = { t: "note", x: clamp(p.x, 0, w - M.NOTE_W), y: clamp(p.y, 0, h - M.NOTE_H), w: M.NOTE_W, h: M.NOTE_H, dir: this.fmt.dir, align: this.fmt.align,
        text: "", color: st.color, size: st.size, ...this.styleExtra() };
      this.startEdit(null, proto);
    }
  }
  updateStrokePreview() {
    const st = this.curStyle;
    this.preview = { t: this.tool, pts: this.action.pts, color: st.color, w: st.width, ...this.styleExtra() };
    this.render();
  }
  shapeItems(a, b, shift) {
    const st = this.curStyle;
    if (this.tool === "hltext") return this.regionRects(a, b).map((r) => ({ t: "hl", x1: r[0], y1: r[1], x2: r[2], y2: r[3], color: st.color, ...this.styleExtra() }));
    const kind = M.shapeKindInfo(this.shapeKind);
    let x2 = b.x, y2 = b.y;
    if (shift && kind.closed) {
      const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      x2 = a.x + (b.x >= a.x ? s : -s); y2 = a.y + (b.y >= a.y ? s : -s);
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    const item = { t: kind.t, x1: r2(a.x), y1: r2(a.y), x2: r2(x2), y2: r2(y2), color: st.color, w: st.width, ...this.styleExtra() };
    if (kind.t === "shape") item.kind = kind.id;
    if (kind.closed && this.fillOn) item.fill = st.color;                 // Fill on: interior in the drawing colour, outline stays
    return [item];
  }
  eraserRadius() { return Math.max(1, this.groups.eraser.width / 2); }
  /**
   * Eraser step: pen / marker strokes lose only the part under the eraser (swept from the previous position to p, so fast drags leave no gaps);
   * every other item (shapes, text, nodes, connectors ...) is removed whole when touched, exactly as before.
   * The whole drag is one undo step (see toolUp).
   */
  eraseAt(p) {
    const a = this.action, prev = a && a.last ? a.last : p, r = this.eraserRadius(), tol = this.tol(), live = this.live;
    const A = [prev.x, prev.y], Bp = [p.x, p.y], x0 = Math.min(A[0], Bp[0]) - r, y0 = Math.min(A[1], Bp[1]) - r, x1 = Math.max(A[0], Bp[0]) + r, y1 = Math.max(A[1], Bp[1]) + r;
    let changed = false;
    const out = [];
    for (let i = 0; i < live.length; i++) {
      const d = live[i];
      if (d.t === "pen" || d.t === "mark") {
        const bb = this.boundsOf(d);
        if (bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1) { out.push(d); continue; }           // far from the eraser
        const pieces = M.erasePen(d, A, Bp, r);
        if (pieces) { out.push(...pieces); changed = true; } else out.push(d);
      } else if (this.hitItem(live, i, p, tol)) changed = true;
      else out.push(d);
    }
    if (a) a.last = p;
    const [sx, sy] = this.pageToScreen(p.x, p.y); this.eraserPos = { x: sx, y: sy };
    if (changed) { this.live = out; this.selected = null; if (a) a.changed = true; }
    this.render();
  }
  /** The eraser's outline follows the pointer (mouse / pen hover, or the finger while erasing). */
  onHover(e) {
    if (this.tool !== "eraser" || e.pointerType === "touch") return;
    const l = this.local(e); this.eraserPos = { x: l.x, y: l.y }; this.render();
  }
  drawEraserCursor(ctx) {
    if (this.tool !== "eraser" || !this.eraserPos || this.root.hidden) return;
    const r = Math.max(2, this.eraserRadius() * this.view.scale), { x, y } = this.eraserPos;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = "rgba(120,120,120,.12)"; ctx.fill();
    ctx.lineWidth = 2.6; ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(20,20,20,.85)"; ctx.stroke();
    ctx.restore();
  }
  /** Rectangles (one per text line) covering the words between a and b (reading order). */
  regionRects(a, b) {
    const words = this.words;
    if (!words || !words.length) return [];
    const nearest = (pt) => {
      let best = 0, bd = Infinity;
      words.forEach((w, i) => {
        const dx = Math.max(w.x0 - pt.x, 0, pt.x - w.x1), dy = Math.max(w.y0 - pt.y, 0, pt.y - w.y1), d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    const i = nearest(a), j = nearest(b), lo = Math.min(i, j), hi = Math.max(i, j), lines = new Map();
    for (const w of words.slice(lo, hi + 1)) {
      const r = lines.get(w.line);
      if (!r) lines.set(w.line, [w.x0, w.y0, w.x1, w.y1]);
      else { r[0] = Math.min(r[0], w.x0); r[1] = Math.min(r[1], w.y0); r[2] = Math.max(r[2], w.x1); r[3] = Math.max(r[3], w.y1); }
    }
    return [...lines.values()].map((r) => r.map((v) => Math.round(v * 100) / 100));
  }

  // ------------------------------------------------------- shapes + fill
  openShapes() {
    this.finishEdit();
    if (this.tool !== "shape") this.setTool("shape");
    const grid = el("div", { class: "shapegrid", role: "menu" }, M.SHAPE_KINDS.map((k) => el("button", {
      class: "shp" + (k.id === this.shapeKind ? " on" : ""), type: "button", role: "menuitemradio", "aria-checked": String(k.id === this.shapeKind),
      title: k.label, "aria-label": k.label, onclick: () => { closePopup(); this.setShape(k.id); } }, icon(k.id), el("span", { class: "slab" }, k.label))));
    popup(this.shapeBtn, el("div", { class: "shapemenu" }, grid, this.resetRow("shape")));                      // pressing the Shapes button again closes the menu
  }
  setShape(id) {
    this.shapeKind = M.shapeKindInfo(id).id;
    this.updateShapeBtn();
    this.setTool("shape");
    this.fillKey = ""; this.updateFillUi();
  }
  updateShapeBtn() {
    const k = M.shapeKindInfo(this.shapeKind);
    this.shapeIcon.replaceChildren(icon(k.id));
    this.shapeBtn.title = `Shapes - active: ${k.label} (${K.TOOL_KEYS.shape})`;
  }
  fillTarget() {                                     // a selected closed shape (the Fill button then edits that shape)
    if ((this.tool === "select" || this.tool === "node" || this.tool === "link") && this.selected !== null) { const d = this.items[this.selected]; if (d && M.isClosedShape(d)) return d; }
    return null;
  }
  fillEnabled() { return !!this.fillTarget() || this.tool === "node" || (this.tool === "shape" && M.shapeKindInfo(this.shapeKind).closed); }
  updateFillUi() {
    const en = this.fillEnabled(), d = this.fillTarget(), on = en && (d ? !!d.fill : this.fillOn);
    const sel = (this.tool === "select" || this.tool === "node" || this.tool === "link") ? this.selItem() : null;
    const show = this.tool === "shape" || this.tool === "node" || (!!sel && (M.isClosedShape(sel) || sel.t === "line" || sel.t === "arrow")), key = show + "|" + en + "|" + on;
    if (key === this.fillKey) return;
    this.fillKey = key; this.fillBtn.hidden = !show;               // contextual: only next to shapes (disabled for open shapes such as lines)
    this.fillBtn.disabled = !en; this.fillBtn.classList.toggle("on", on); this.fillBtn.setAttribute("aria-pressed", String(on));
    this.fillBtn.title = en ? `Fill closed shapes with the colour: ${on ? "on" : "off"} (${K.FILL_KEY})` : "Fill applies to closed shapes (rectangle, ellipse, ...); lines have no interior";
  }
  toggleFill() {
    const d = this.fillTarget();
    if (d) {
      const n = { ...d };
      if (d.fill) delete n.fill; else n.fill = d.color;
      const items = this.items.slice(); items[this.selected] = n; this.commit(items, { keepSel: true });
      this.fillOn = !!n.fill;
    } else if (this.fillEnabled()) this.fillOn = !this.fillOn;
    this.fillKey = ""; this.updateFillUi(); this.render();
  }

  // ------------------------------------------------------------------ board
  applyCenter([cx, cy]) { const v = this.view; v.tx = this.cw / 2 - cx * v.scale; v.ty = this.ch / 2 - cy * v.scale; this.clampView(); }
  /** 'Fit': show all content (or the middle of an empty board at 100 %). */
  fitContent(userAction = true) {
    const v = this.view, b = R.contentBounds(this.pages[0]?.items || []);
    if (!b) { v.scale = clamp(1, this.minZoom, 6); this.applyCenter([M.BOARD_W / 2, M.BOARD_H / 2]); }
    else {
      const m = 50, bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
      v.scale = clamp(Math.min((this.cw - 2 * m) / bw, (this.ch - 2 * m) / bh, 1.5), this.minZoom, 6);
      this.applyCenter([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    }
    v.fit = false; this.render();
  }
  boardIsDark() { return this.pages[0]?.paper === "black"; }
  /** New text / pen ink follows the board: black ink on a whiteboard, white ink on a blackboard (only when the default ink was in use). */
  syncInkToBg() {
    const dark = this.boardIsDark(), from = dark ? T.INK_LIGHT : T.INK_DARK, to = dark ? T.INK_DARK : T.INK_LIGHT;
    for (const g of T.LEGACY_DRAW_GROUPS) if (this.groups[g].color === from) this.groups[g].color = to;
    if (this.curStyle.color === from && T.LEGACY_DRAW_GROUPS.includes(GROUP_OF_TOOL[this.tool])) this.curStyle.color = to;
    this.updateColorDot();
  }
  setBoardBg(paper) {
    const pg = this.pages[0];
    if (!pg || pg.paper === paper || !M.BOARD_BGS.includes(paper)) return;
    pg.paper = paper; this.syncInkToBg();
    this.dirty = true; this.app.onChange(this); this.ui(); this.render();     // nothing on the board is modified: only how it is drawn
  }
  toggleBoardBg() { this.setBoardBg(this.boardIsDark() ? "white" : "black"); }
  toggleGrid() { const pg = this.pages[0]; pg.grid = !pg.grid; this.dirty = true; this.app.onChange(this); this.ui(); this.render(); }
  updateBoardUi() {
    if (this.kind !== "board" || !this.bgBtn) return;
    const dark = this.boardIsDark();
    this.bgBtn.replaceChildren(icon(dark ? "moon" : "sun"), el("span", { class: "lbl" }, dark ? "Black" : "White"));
    this.bgBtn.classList.toggle("on", dark);
    this.gridBtn.classList.toggle("on", !!this.pages[0]?.grid); this.gridBtn.setAttribute("aria-pressed", String(!!this.pages[0]?.grid));
  }
  /** Grow nodes (of loaded documents) whose text does not fit inside them; never shrinks, so a size chosen by hand is kept. */
  refitNodes() {
    for (const pg of this.pages) {
      pg.items = pg.items.map((d) => {
        if (d.t !== "node") return d;
        const fit = R.nodeFit(d, d.text), w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
        if (w >= fit.w - 0.5 && h >= fit.h - 0.5) return d;
        const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2);
        return { ...d, x1, y1, x2: Math.round((x1 + Math.max(w, fit.w)) * 100) / 100, y2: Math.round((y1 + Math.max(h, fit.h)) * 100) / 100 };
      });
    }
  }
  boardData() { this.finishEdit(); const pg = this.pages[0]; return { paper: pg.paper, grid: !!pg.grid, items: pg.items.slice() }; }
  setBoard(data, name) {
    this.finishEdit();
    this.pages = [{ paper: data.paper, grid: !!data.grid, items: data.items.slice() }];
    this.refitNodes();
    this.name = name; this.history.clear(); this.dirty = false; this.cur = 0; this.selected = null;
    this.syncInkToBg();
    this.view.init = !this.root.hidden;                                   // a hidden panel is centred when it is first shown
    this.showPage(0);
    this.app.onChange(this, { clean: true });
  }
  async newBoard() {
    if (!(await this.app.confirmReplace(this, "start a new board"))) return;
    this.setBoard({ paper: "white", grid: false, items: [] }, null);
  }
  async saveBoard() {
    this.finishEdit();
    const base = (this.name || "board").replace(/\.dnboard$/i, "");
    await this.app.saveBlob(new Blob([M.boardToJson(this.pages[0])], { type: "application/json" }), `${base}.dnboard`);
    this.dirty = false; this.app.onChange(this, { clean: true }); this.ui();
    return true;
  }
  async exportBoard() {
    this.finishEdit();
    const pg = this.pages[0];
    if (!pg.items.length) { toast("The board is empty - nothing to export."); return; }
    let printFriendly = false;
    if (pg.paper === "black") {                                             // dark board: print on the dark background, or white paper with dark ink?
      const choice = await dialog({ title: "Export the blackboard as PDF",
        content: el("div", {}, el("p", {}, "As shown keeps the dark background. Print-friendly uses a white background and turns light ink dark, which saves ink when printed.")),
        buttons: [{ label: "Cancel", value: "cancel" }, { label: "Print-friendly (white)", value: "print" }, { label: "As shown (dark)", value: "shown", primary: true }] });
      if (!choice || choice === "cancel") return;
      printFriendly = choice === "print";
    }
    const busy = this.app.busy("Exporting PDF…");
    try {
      const bytes = await PDF.exportBoardPdf(pg, { printFriendly });
      await this.app.saveBlob(new Blob([bytes], { type: "application/pdf" }), `${(this.name || "board").replace(/\.dnboard$/i, "")}.pdf`);
    } catch (e) { console.error(e); toast("Could not export the PDF: " + (e.message || e), 5000); }
    finally { busy.done(); }
  }

  // ------------------------------------------------------------------ mind map
  openMindMenu() {                                    // PDF / notebook: choose the Node or Link tool
    this.finishEdit();
    const row = (tool, ic, label, desc) => el("button", { class: "mi" + (this.tool === tool ? " on" : ""), type: "button", role: "menuitemradio", "aria-checked": String(this.tool === tool),
      title: desc, onclick: () => { closePopup(); this.setTool(tool); } }, icon(ic), el("span", { class: "mlab" }, label, el("small", {}, desc)), el("kbd", {}, K.TOOL_KEYS[tool]));
    popup(this.mindBtn, el("div", { class: "menu mindmenu", role: "menu" },
      row("node", "node", "Node", "Tap to add a node. Tab = child, Enter = sibling."),
      row("link", "link", "Link", "Drag from one node to another to connect them."), el("div", { class: "msep" }), this.resetRow("node")));
  }
  buildMindGroup() {
    const mb = (ic, title, fn) => el("button", { class: "btn tool fmt", type: "button", title, "aria-label": title, "aria-pressed": "false", onclick: fn }, icon(ic));
    const sep = () => el("span", { class: "fsep" });
    this.mindBtns = {
      child: mb("child", "Add a child node to the selected node (Tab)", () => this.addChild()),
      sibling: mb("sibling", "Add a sibling node next to the selected node (Enter)", () => this.addSibling()),
      branch: mb("branchdel", "Delete the selected node and everything below it (Shift+Delete)", () => this.deleteBranch()),
      curve: mb("curve", "Curved connectors", () => this.setConn({ style: "curve" })),
      line: mb("line", "Straight connectors", () => this.setConn({ style: "line" })),
      elbow: mb("elbow", "Elbow connectors", () => this.setConn({ style: "elbow" })),
      arrow: mb("arrow", "Arrowheads on connectors (on / off, independent of the connector type)", () => this.setConn({ arrow: !this.mindState().arrow })),
      round: mb("node", "Rounded nodes", () => this.setNodeKind("round")),
      ellipse: mb("ellipse", "Oval nodes", () => this.setNodeKind("ellipse")),
      rect: mb("rect", "Square nodes", () => this.setNodeKind("rect")),
      smaller: mb("minus", "Smaller text in the node (the selected node, or new nodes)", () => this.nodeSizeStep(-1)),
      bigger: mb("plus", "Bigger text in the node (the selected node, or new nodes)", () => this.nodeSizeStep(1)),
    };
    this.nodeSizeLbl = el("span", { class: "sizelbl", title: "Text size of the node" });
    const B = this.mindBtns;
    this.mindGroup = el("span", { class: "fmtgrp mindgrp", role: "group", "aria-label": "Mind map", hidden: true },
      B.child, B.sibling, B.branch, sep(), B.curve, B.line, B.elbow, sep(), B.arrow, sep(), B.round, B.ellipse, B.rect, sep(), B.smaller, this.nodeSizeLbl, B.bigger);   // connector type | arrowheads on / off | node shape | text size
    for (const ev of ["pointerdown", "mousedown"]) this.mindGroup.addEventListener(ev, (e) => e.preventDefault());
  }
  selItem() { return this.selected !== null ? (this.items[this.selected] || null) : null; }
  selNode() { const d = this.selItem(); return d && d.t === "node" ? d : null; }
  mindState() {
    const d = this.selItem(), node = d && d.t === "node" ? d : null, conn = d && d.t === "conn" ? d : null;
    return { show: this.tool === "node" || this.tool === "link" || !!node || !!conn, node, conn,
      style: conn ? conn.style : this.connStyle, arrow: conn ? conn.arrow !== false : this.connArrow, kind: node ? node.kind : this.nodeKind };
  }
  updateMindUi() {
    const m = this.mindState(), hasParent = !!m.node && this.items.some((c) => c.t === "conn" && c.to === m.node.id);
    const sz = m.node ? m.node.size : (this.editing && !this.editing.rich && this.editing.proto && this.editing.proto.t === "node" ? this.editing.proto.size : this.curStyle.size);
    const key = [m.show, !!m.node, hasParent, !!m.conn, m.style, m.arrow, m.kind, sz].join("|");
    if (key === this.mindKey) return;
    this.mindKey = key; this.mindGroup.hidden = !m.show;
    const B = this.mindBtns; this.nodeSizeLbl.textContent = String(Math.round(sz * 10) / 10);
    B.smaller.disabled = B.bigger.disabled = !!m.conn;
    B.child.disabled = !m.node; B.sibling.disabled = !hasParent; B.branch.disabled = !m.node;
    const on = { curve: m.style === "curve", line: m.style === "line", elbow: m.style === "elbow", arrow: m.arrow, round: m.kind === "round", ellipse: m.kind === "ellipse", rect: m.kind === "rect" };
    for (const [k, v] of Object.entries(on)) { B[k].classList.toggle("on", v); B[k].setAttribute("aria-pressed", String(v)); }
  }
  setConn(patch) {                                   // connector look: the selected connector, or all connectors of the selected node; also the default for new ones
    if ("style" in patch) this.connStyle = patch.style;
    if ("arrow" in patch) this.connArrow = patch.arrow;
    const d = this.selItem(); let items = null;
    if (d && d.t === "conn") { items = this.items.slice(); items[this.selected] = { ...d, ...patch }; }
    else if (d && d.t === "node") items = this.items.map((c) => (c.t === "conn" && (c.from === d.id || c.to === d.id) ? { ...c, ...patch } : c));
    if (items && JSON.stringify(items) !== JSON.stringify(this.items)) this.commit(items, { keepSel: true });
    this.mindKey = ""; this.updateMindUi(); this.render();
  }
  setNodeKind(k) {
    this.nodeKind = k;
    const d = this.selNode();
    if (d && d.kind !== k) { const items = this.items.slice(); items[this.selected] = { ...d, kind: k }; this.commit(items, { keepSel: true }); }
    this.mindKey = ""; this.updateMindUi(); this.render();
  }
  nodeProto(x1, y1, w = 120, h = 48) {
    const st = this.curStyle, f = this.fmt, r2 = (v) => Math.round(v * 100) / 100;
    const [PW, PH] = this.pageDims();
    x1 = clamp(x1, 10, PW - w - 10); y1 = clamp(y1, 10, PH - h - 10);
    const n = { t: "node", id: M.newId(), kind: this.nodeKind, x1: r2(x1), y1: r2(y1), x2: r2(x1 + w), y2: r2(y1 + h), text: "", color: st.color,
      w: Math.max(1.5, st.width), size: st.size, g: true, dir: f.dir, align: "center", ...this.styleExtra() };
    if (this.fillOn) n.fill = st.color;
    return n;
  }
  connProto(from, to) { const st = this.curStyle; return { t: "conn", from, to, style: this.connStyle, arrow: this.connArrow, color: st.color, w: Math.max(1.5, st.width) }; }
  /** A node drawn by dragging (like a shape): its box is the dragged rectangle (at least 60 x 36), sized by hand, so it has no g. */
  dragNode(p0, p1) {
    const x1 = Math.min(p0.x, p1.x), y1 = Math.min(p0.y, p1.y), n = this.nodeProto(x1, y1, Math.max(60, Math.abs(p1.x - p0.x)), Math.max(36, Math.abs(p1.y - p0.y)));
    delete n.g; return n;
  }
  /** A node being resized never gets narrower than 60 or lower than its text needs at that width; the side that is not dragged stays. */
  clampNode(n, h) {
    if (n.t !== "node") return n;
    let x1 = Math.min(n.x1, n.x2), x2 = Math.max(n.x1, n.x2), y1 = Math.min(n.y1, n.y2), y2 = Math.max(n.y1, n.y2);
    if (x2 - x1 < 60) { if (h.includes("w")) x1 = x2 - 60; else x2 = x1 + 60; }
    const need = R.nodeFitAt(n, n.text, x2 - x1).h;
    if (y2 - y1 < need) { if (h.includes("n")) y1 = y2 - need; else y2 = y1 + need; }
    const r2 = (v) => Math.round(v * 100) / 100;
    return { ...n, x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2) };
  }
  /** A node after its text, text size or format changed: an auto-sized one (g) is exactly as big as its text needs (it also shrinks); one sized by hand keeps its width and
   *  only gets taller if its text needs it. The top left corner stays; the node is kept on the page; its connectors follow because they are drawn from the node's box. */
  fitNode(d, domH = 0) {
    if (d.t !== "node") return d;
    const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2), w0 = Math.abs(d.x2 - d.x1), h0 = Math.abs(d.y2 - d.y1), [PW, PH] = this.pageDims(), r2 = (v) => Math.round(v * 100) / 100;
    let w, h;
    if (d.g) { const f = R.nodeFit(d, d.text, domH); w = f.w; h = f.h; } else { w = w0; h = Math.max(h0, R.nodeFitAt(d, d.text, w0).h); }
    const nx = Math.max(0, Math.min(x1, PW - w - 4)), ny = Math.max(0, Math.min(y1, PH - h - 4));
    return { ...d, x1: r2(nx), y1: r2(ny), x2: r2(nx + w), y2: r2(ny + h) };
  }
  /** The + / − buttons of the Mind map group: the text size of the selected node (the node follows), or of the next nodes when none is selected. While a node is typed the change is live. */
  nodeSizeStep(dir) {
    const ed = this.editing;
    if (ed && !ed.rich) {
      const d = ed.idx === null ? ed.proto : this.items[ed.idx];
      if (d && d.t === "node") {
        const z = stepSize(d.size, dir); if (z === d.size) return;
        if (ed.idx === null) { ed.proto.size = z; this.curStyle = { ...this.curStyle, size: z }; this.positionEditor(); }
        else { const keep = ed.idx, ta = this.ta.value; this.finishEdit(); const n = this.items[keep]; if (n) { const items = this.items.slice(); items[keep] = this.fitNode({ ...n, size: z }); this.commit(items, { keepSel: true }); this.startEdit(keep); void ta; } }
        this.mindKey = ""; this.updateMindUi(); this.render(); return;
      }
    }
    const d = this.selNode();
    if (d) {
      const z = stepSize(d.size, dir);
      if (z !== d.size) { const items = this.items.slice(); items[this.selected] = this.fitNode({ ...d, size: z }); this.commit(items, { keepSel: true }); }
    } else { const z = stepSize(this.curStyle.size, dir); this.curStyle = { ...this.curStyle, size: z }; const g = GROUP_OF_TOOL[this.tool]; if (g) this.groups[g] = { ...this.curStyle }; }
    this.mindKey = ""; this.updateMindUi(); this.render();
  }
  createNodeAt(p) { const n = this.nodeProto(p.x - 60, p.y - 24); this.startEdit(null, n, null); }
  revealBox(x1, y1, x2, y2) {                        // scroll just enough to see a box
    const v = this.view, s = v.scale, [ox, oy] = this.origin(), m = 50;
    const L = v.tx + (ox + x1) * s, T = v.ty + (oy + y1) * s + 0, Rr = v.tx + (ox + x2) * s, Bb = v.ty + (oy + y2) * s;
    if (L < m) v.tx += m - L; else if (Rr > this.cw - m) v.tx -= Rr - (this.cw - m);
    if (T < m + 90) v.ty += m + 90 - T; else if (Bb > this.ch - m) v.ty -= Bb - (this.ch - m);          // (the toolbars float over the top edge)
    this.clampView(); this.render();
  }
  childrenOf(id, items = this.items) { const nodes = M.nodeIndex(items); return items.filter((c) => c.t === "conn" && c.from === id).map((c) => nodes.get(c.to)).filter(Boolean); }
  /** New child below / beside the node: placed next to its existing children, connected, and ready for typing. */
  addChild(id = null) {
    const P = M.nodeIndex(this.items).get(id ?? this.selNode()?.id);
    if (!P) { toast("Select a node first."); return; }
    const kids = this.childrenOf(P.id), w = 120, h = 48, px2 = Math.max(P.x1, P.x2), px1 = Math.min(P.x1, P.x2);
    const x1 = kids.length ? Math.min(kids[0].x1, kids[0].x2) : (px2 + M.NODE_GAP_X + w <= this.pageDims()[0] - 20 ? px2 + M.NODE_GAP_X : px1 - M.NODE_GAP_X - w);
    const y1 = kids.length ? Math.max(...kids.map((k) => Math.max(k.y1, k.y2))) + M.NODE_GAP_Y : (P.y1 + P.y2) / 2 - h / 2;
    const n = this.nodeProto(x1, y1, w, h);
    this.revealBox(n.x1, n.y1, n.x2, n.y2);
    this.startEdit(null, n, [this.connProto(P.id, n.id)]);
  }
  addSibling() {
    const S = this.selNode();
    if (!S) { toast("Select a node first."); return; }
    const pc = this.items.find((c) => c.t === "conn" && c.to === S.id);
    if (!pc) { toast("The top node has no siblings - use Add child."); return; }
    const kids = this.childrenOf(pc.from), h = 48;
    const n = this.nodeProto(Math.min(S.x1, S.x2), Math.max(...kids.map((k) => Math.max(k.y1, k.y2))) + M.NODE_GAP_Y, 120, h);
    this.revealBox(n.x1, n.y1, n.x2, n.y2);
    this.startEdit(null, n, [this.connProto(pc.from, n.id)]);
  }
  deleteBranch() {                                   // the node and every node reachable below it (its connectors go with them)
    const S = this.selNode();
    if (!S) return;
    const ids = new Set([S.id]), stack = [S.id];
    while (stack.length) { const id = stack.pop(); for (const c of this.items) if (c.t === "conn" && c.from === id && !ids.has(c.to)) { ids.add(c.to); stack.push(c.to); } }
    this.commit(this.items.filter((d) => !(d.t === "node" && ids.has(d.id))));
    if (ids.size > 1) toast(`Deleted ${ids.size} nodes (undo with Ctrl+Z).`);
  }
  finishLink(a, c) {
    this.preview = null;
    const tn = this.linkTarget; this.linkTarget = null;
    const from = this.items.find((d) => d.t === "node" && d.id === a.from);
    if (!from) { this.render(); return; }
    if (tn) {
      if (this.items.some((d) => d.t === "conn" && d.from === a.from && d.to === tn)) { toast("These nodes are already connected."); this.render(); return; }
      this.commit([...this.items, this.connProto(a.from, tn)], { keepSel: true }); return;
    }
    const cx = (from.x1 + from.x2) / 2, cy = (from.y1 + from.y2) / 2;
    if (Math.hypot(c.x - cx, c.y - cy) > 90 && !(from.x1 <= c.x && c.x <= from.x2 && from.y1 <= c.y && c.y <= from.y2)) {   // dropped on empty space: a new node there, linked
      const n = this.nodeProto(c.x - 60, c.y - 24);
      this.startEdit(null, n, [this.connProto(a.from, n.id)]);
    } else this.render();
  }
  /** Keys for the board: Tab = child, Enter = sibling, F2 = edit, Shift+Delete = delete branch. */
  boardKey(e) {
    if (this.editing || e.ctrlKey || e.metaKey || e.altKey) return false;
    const d = this.selItem();
    if (!d) return false;
    if (e.key === "Tab" && d.t === "node") { this.addChild(); return true; }
    if (e.key === "Enter" && d.t === "node") { this.addSibling(); return true; }
    if (e.key === "F2" && ["node", "conn", "text", "note"].includes(d.t)) { this.startEdit(this.selected); return true; }
    if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace") && d.t === "node") { this.deleteBranch(); return true; }
    return false;
  }

  // ------------------------------------------------- text direction / alignment
  // dir (ltr|rtl) and align (left|center|right) are separate item properties. Old items without them keep the previous
  // behaviour (direction detected per line). this.fmt is what NEW text gets; it only changes when the user presses a button.
  textTarget() {                                     // the text / note the format buttons act on
    if (this.editing) return this.editing.idx !== null ? this.items[this.editing.idx] : this.editing.proto;
    if ((this.tool === "select" || this.tool === "node") && this.selected !== null) { const d = this.items[this.selected]; if (d && (d.t === "text" || d.t === "note" || d.t === "node")) return d; }
    return null;
  }
  displayFmt() {
    const d = this.textTarget();
    if (this.editing && this.editing.fmt) return this.editing.fmt;
    return d ? R.effectiveFmt(d) : this.fmt;
  }
  updateFmtUi() {
    const show = !!this.textTarget() || this.tool === "text" || this.tool === "note";
    const f = show ? this.displayFmt() : null, snapShow = show && this.snapApplies(), snapOn = snapShow && this.snapDisplay();
    const rs = show ? this.richState() : null, tx = this.textTarget();
    const key = f ? f.dir + "|" + f.align + "|" + (snapShow ? (snapOn ? "S1" : "S0") : "-") + "|" + (rs ? [rs.b, rs.i, rs.u, rs.list, rs.z].join(",") : "-") + "|" + (tx && tx.t === "text" ? "T" : "") : "";
    if (key === this.fmtKey) return;
    this.fmtKey = key; this.fmtGroup.hidden = !show;
    if (!f) return;
    const isText = !!(tx && tx.t === "text") || this.tool === "text";
    this.richGroup.hidden = !isText;
    if (rs) {
      const on = { b: rs.b === true, i: rs.i === true, u: rs.u === true, ul: rs.list === "b", ol: rs.list === "n" };
      for (const [k, v] of Object.entries(on)) { this.rtBtns[k].classList.toggle("on", v); this.rtBtns[k].setAttribute("aria-pressed", String(v)); }
      this.sizeLbl.textContent = rs.z === null ? "–" : String(Math.round(rs.z * 10) / 10);
    }
    this.snapBtn.hidden = this.snapSep.hidden = !snapShow;
    this.snapBtn.classList.toggle("on", snapOn); this.snapBtn.setAttribute("aria-pressed", String(snapOn));
    const on = { ltr: f.dir === "ltr", rtl: f.dir === "rtl", left: f.align === "left", center: f.align === "center", right: f.align === "right" };
    for (const [k, b] of Object.entries(this.fmtBtns)) { b.classList.toggle("on", on[k]); b.setAttribute("aria-pressed", String(on[k])); }
  }
  /** Bold / italic / underline / list / size state of what is edited (the caret or selection), or of the selected text box. Cached: it is read when the selection changes. */
  richState() {
    const ed = this.editing;
    if (ed && ed.rich) {
      if (this.rstateKey !== "e") { this.rstate = this.rt.styleNow(); this.rstateKey = "e"; }
      return this.rstate;
    }
    const d = this.textTarget();
    if (d && d.t === "text") {
      if (this.rstateItem !== d) { const c = RT.contentOf(d), st = RT.styleOfRange(c, 0, c.text.length, d.size); st.list = c.lists && c.lists.every((x) => x === c.lists[0]) ? c.lists[0] : ""; this.rstate = st; this.rstateItem = d; }
      return this.rstate;
    }
    if (this.tool === "text") { const ts = this.textStyle; return { b: ts.b, i: ts.i, u: ts.u, list: ts.list, z: this.curStyle.size }; }       // Text tool, nothing open: the settings the next new text box gets
    return { b: false, i: false, u: false, list: "", z: this.curStyle.size };
  }
  /** Rich text commands (toolbar and keys). While editing they apply to the selection (or to what is typed next); on a selected box, to the whole box. */
  richCmd(kind) {
    const ed = this.editing, ladder = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128];
    const step = (z, dir) => (dir > 0 ? ladder.find((x) => x > z + 0.01) ?? z : [...ladder].reverse().find((x) => x < z - 0.01) ?? z);
    if (ed && ed.rich) {
      const rs = this.richState();
      if (kind === "b" || kind === "i" || kind === "u") this.rt.toggle(kind);
      else if (kind === "ul") this.rt.setList("b"); else if (kind === "ol") this.rt.setList("n");
      else if (kind === "smaller" || kind === "bigger") this.rt.setSize(step(rs.z ?? this.editedItem().size, kind === "bigger" ? 1 : -1));
      this.rt.focus(); return;
    }
    const d = this.textTarget();
    if (!d || d.t !== "text") {                          // no text box open or selected: these are the settings of the Text tool, used by the next box that is created
      if (this.tool === "text") this.setTextDefault(kind, kind === "bigger" || kind === "smaller" ? step(this.curStyle.size, kind === "bigger" ? 1 : -1) : null);
      return;
    }
    let c = RT.contentOf(d), n = null;
    if (kind === "b" || kind === "i" || kind === "u") { const all = RT.styleOfRange(c, 0, c.text.length, d.size)[kind] === true; c = RT.applyAll(c, { [kind]: !all }); n = F.withContent(d, c); }
    else if (kind === "ul" || kind === "ol") { c = RT.toggleList(c, 0, c.text.length, kind === "ul" ? "b" : "n"); n = F.withContent(d, c); }
    else { const z = step(d.size, kind === "bigger" ? 1 : -1); n = F.withContent({ ...d, size: z }, RT.applyAll(c, { z: null })); if (n.ruled === true) n = R.ruledNormalize(n); }
    if (n) n = this.fitGrown(n);
    if (n && JSON.stringify(n) !== JSON.stringify(d)) { const items = this.items.slice(); items[this.selected] = n; this.commit(items, { keepSel: true, flowIdx: this.selected }); }
    this.fmtKey = ""; this.rstateItem = null; this.updateFmtUi(); this.render();
  }
  /** Bold / italic / underline / list / size chosen on the Text tool while no text box is open (they are kept with the tool, saved, and reset by its Reset to default). */
  setTextDefault(kind, size) {
    const ts = this.textStyle;
    if (kind === "b" || kind === "i" || kind === "u") ts[kind] = !ts[kind];
    else if (kind === "ul") ts.list = ts.list === "b" ? "" : "b";
    else if (kind === "ol") ts.list = ts.list === "n" ? "" : "n";
    else if (size !== null && size !== this.curStyle.size) this.applyStyle("size", size, true);
    this.fmtKey = ""; this.updateFmtUi(); this.render();
  }
  setFmt(patch) {
    this.fmt = { ...this.fmt, ...patch };            // an explicit choice also becomes the default for new text
    const ed = this.editing;
    if (ed) {
      const d = ed.idx !== null ? this.items[ed.idx] : ed.proto;
      const before = ed.grow ? this.editedItem() : null;
      ed.fmt = { ...(ed.fmt || R.effectiveFmt(d)), ...patch };
      if (before) ed.grow = this.growFor({ ...before, ...ed.fmt });         // the box stays where it is; it now grows from the edge of the new alignment
      this.refreshEditing();
    } else {
      const d = this.textTarget();
      if (d) {
        const f = { ...R.effectiveFmt(d), ...patch };
        if (f.dir !== d.dir || f.align !== d.align) { const items = this.items.slice(); items[this.selected] = this.fitGrown({ ...d, ...f }); this.commit(items, { keepSel: true }); }
      }
    }
    this.fmtKey = ""; this.updateFmtUi(); this.render();
  }

  // ------------------------------------------------- writing on the lines of lined paper
  // A text item on lined paper is "ruled" (ruled: true): its line pitch and its baselines follow the printed rules, see render.js.
  // New text on a lined page is ruled while "snap to lines" is on (default). Old text (no ruled flag) is moved onto the lines the
  // first time it is edited; text made with snapping off (ruled: false) stays where it was put.
  linedPage() { return this.kind === "nb" && P.RULED_PAPERS.includes(this.pages[this.cur]?.paper); }       // lined and Cornell paper have printed rules
  /** Does the snap button make sense now? (text on a lined notebook page; not for sticky notes, mind-map nodes, PDFs or boards) */
  snapApplies() {
    if (!this.linedPage()) return false;
    const d = this.textTarget();
    return d ? d.t === "text" : this.tool === "text";
  }
  /** State shown on the snap button: the text being edited / selected, else the default for new text. */
  snapDisplay() {
    const d = this.textTarget();
    if (d && d.t === "text") return (this.editing ? this.editedItem() : d).ruled === true;
    return this.snapLines;
  }
  setSnap(on) {
    this.snapLines = on;                                                // an explicit choice also becomes the default for new text
    const ed = this.editing;
    if (ed) {
      const d = ed.idx !== null ? this.items[ed.idx] : ed.proto;
      if (d && d.t === "text") { ed.ruled = on; this.refreshEditing(); }
    } else {
      const d = this.textTarget();
      if (d && d.t === "text" && (d.ruled === true) !== on) {
        const n = on ? R.ruledNormalize({ ...d, ruled: true }) : { ...d, ruled: false };
        const items = this.items.slice(); items[this.selected] = n; this.commit(items, { keepSel: true });
      }
    }
    this.fmtKey = ""; this.updateFmtUi(); this.render();
  }
  /** The item being edited with everything pending applied: format, snap to lines, and (text boxes) the content of the editor. */
  editedItem() {
    const ed = this.editing;
    if (!ed) return null;
    const base = ed.idx !== null ? this.items[ed.idx] : ed.proto;
    if (!base || base.t !== "text") return base;
    const key = [base, ed.fmt, ed.ruled, ed.auto, ed.content, ed.grow, this.cur, this.pagePitch()], m = ed.memo;       // (one object per state: its layout is computed once)
    if (m && m.key.every((v, i) => v === key[i])) return m.d;
    let d = this.withEditState(base, ed);
    if (ed.content) d = F.withContent(d, ed.content);
    if (ed.grow) d = R.growBox(d, ed.grow);
    ed.memo = { key, d };
    return d;
  }
  /** The usable x range [lo, hi] of the surface for a text box (page units). Notebook: the writing area (on ruled paper inside the margin / cue column, else 12 from the page edges);
   *  PDF page: the page less a small margin; board: what is on screen now (a board is huge, text should wrap where the user is looking), never beyond the board. */
  textBounds(d = null) {
    const [w] = this.pageDims();
    if (this.kind === "nb") { const geo = this.pageGeo(), onLines = geo.ruled && (d ? d.ruled === true : this.snapLines); return onLines ? [geo.x0, geo.x1] : [12, w - 12]; }
    if (this.kind === "board") {
      const a = this.screenToPage(0, 0).x, b = this.screenToPage(this.cw, 0).x, lo = Math.max(4, a + 12), hi = Math.min(w - 4, b - 12);
      return hi - lo >= M.TEXT_BOX_MIN_W ? [lo, hi] : [4, w - 4];
    }
    return [4, w - 4];
  }
  /** The anchor and limits an auto-sized box grows within: the anchor is kept off the edge so that a box always has at least the narrowest default width to grow into. */
  growFor(d) {
    const [lo0, hi0] = this.textBounds(d), f = R.fmtOf(d), align = f ? f.align : "left", MIN = M.TEXT_BOX_MIN_W;
    const lo = Math.min(lo0, d.x), hi = Math.max(hi0, d.x + d.w);
    let a = R.anchorX(d, align);
    a = align === "right" ? Math.max(a, Math.min(lo + MIN, hi)) : align === "center" ? clamp(a, Math.min(lo + MIN / 2, hi), Math.max(hi - MIN / 2, lo)) : Math.min(a, Math.max(hi - MIN, lo));
    return { a, lo, hi };
  }
  /** A settled auto-sized box whose text, size or format was changed outside the editor: as wide as its (new) text again. */
  fitGrown(d) { return d && d.t === "text" && d.g && R.fmtOf(d) ? R.growBox(d, this.growFor(d), true) : d; }
  withEditState(base, ed) {
    let d = ed.fmt ? { ...base, ...ed.fmt } : base;
    const want = ed.ruled !== undefined ? ed.ruled : (base.ruled === undefined && ed.auto ? true : base.ruled);
    if (want === true) d = R.ruledNormalize(this.withPitch({ ...d, ruled: true }));
    else if (want === false && d.ruled !== false) d = { ...d, ruled: false };
    return d;
  }
  /** The text box carries the line pitch of the paper it is written on (omitted for the usual 24). */
  withPitch(d, pitch = this.pagePitch()) { const o = { ...d }; if (pitch === M.RULE_PITCH) delete o.rp; else o.rp = pitch; return o; }
  pageSpec(i = this.cur) { return P.paperSpec(this.pages[i] || "blank"); }
  pagePitch(i = this.cur) { return this.pageSpec(i).spacing; }
  pageGeo(i = this.cur) { return P.geometry(this.pageSpec(i), M.PAGE_W, M.PAGE_H); }
  /** A settled text item while it is moved / resized: ruled text always lands on the lines. */
  settle(d) { return d && d.t === "text" && d.ruled === true ? R.ruledNormalize(d) : d; }

  // --------------------------------------------------------------- text edit
  startEdit(idx, proto = null, extra = null) {
    this.finishEdit();
    const d = idx !== null ? this.items[idx] : proto;
    this.editing = { idx, proto, fmt: null, extra, rich: d.t === "text", page0: this.cur, base: null };
    if (idx !== null && d.t === "text" && d.ruled === undefined && this.snapLines && this.linedPage()) this.editing.auto = true;   // old text: put it on the lines
    this.editingItem = d;
    if (d.t === "text" && d.g) this.editing.grow = this.growFor(d);              // an auto-sized box: its anchor and the room the surface gives it, fixed for this edit
    if (d.t === "text") {                               // text boxes: rich text (invisible editor over the live canvas text)
      this.ta.hidden = true;
      const fresh = idx === null, ts = this.textStyle;
      let c = RT.contentOf(d);
      if (fresh && ts.list) c = RT.makeContent(c.text, null, [ts.list]);                     // a new box starts as the list the Text tool is set to
      this.editing.content = c;
      this.rt.show(); this.rt.setContent(c, this.richCfg(this.editedItem()));
      this.positionEditor(); this.syncLive(); this.render();
      this.rt.focus(); this.rt.setSel(c.text.length, c.text.length); this.caretReset();
      if (fresh && (ts.b || ts.i || ts.u)) this.rt.pending = { ...(ts.b ? { b: true } : {}), ...(ts.i ? { i: true } : {}), ...(ts.u ? { u: true } : {}) };    // what is typed first is bold / italic / underlined
      this.fmtKey = ""; this.rstateKey = "";
      return;
    }
    this.ta.value = (d.t === "conn" ? d.label : d.text) || "";
    if (proto && proto.t === "node") this.preview = [proto, ...(extra || [])];       // the new node (and its link) is visible while its text is typed
    this.ta.hidden = false;
    this.positionEditor();
    this.render();
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length);
  }
  // ---- rich text editing: the page canvas draws the live text, the editor element is only the (invisible) input layer on top of it
  richCfg(d) { return { base: d.size, s: this.view.scale, ruled: d.ruled === true, pitch: d.rp || M.RULE_PITCH, fmt: (this.editing && this.editing.fmt) || R.fmtOf(d), indent: R.listIndent(d.size), wraps: this.wrapsFor(d) }; }
  /** Width and offset (css px) of every paragraph of the invisible editor: the middle of the range of widths that breaks it into the canvas' lines (see R.paragraphWraps), anchored on the side the text is aligned to. */
  wrapsFor(d) {
    const mw = R.textInnerWidth(d); if (!mw || d.t !== "text") return null;
    const s = this.view.scale, fmt = (this.editing && this.editing.fmt) || R.fmtOf(d), C = mw * s;
    return R.paragraphWraps(d).map((o) => {
      const align = fmt ? fmt.align : (o.rtl ? "right" : "left"), pad = o.indent * s;
      const t = o.hi === Infinity ? (mw - o.indent) * s + 1.5 : (o.lo + o.hi) / 2 * s, B = t + pad;
      return { w: t + "px", ml: (align === "right" ? C - B : align === "center" ? (C - B) / 2 : 0) + "px" };
    });
  }
  /** Show the edited text through the normal drawing code: the item is replaced by its live version in the list that is drawn. */
  syncLive() {
    const ed = this.editing; if (!ed || !ed.rich) return;
    const d = this.editedItem();
    if (ed.idx !== null) { this.live = this.items.slice(); this.live[ed.idx] = d; } else this.preview = d;
  }
  positionRich() {
    const d = this.editedItem(), v = this.view, s = v.scale, [ox, oy] = this.origin(), el = this.rt.el;
    if (!d) return;
    this.rt.restyle(this.richCfg(d));
    const mw = R.textInnerWidth(d), L = R.layoutRich(d), l0 = L.lines[0], cs = getComputedStyle(el), bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
    el.style.width = (mw ? mw : Math.max(140, L.width + d.size)) * s + "px";                         // exactly the canvas' text area (editor.js adds its wrap slack per paragraph, on the side the text does not start from)
    el.style.height = Math.max(l0.h, L.height) * s + "px"; el.style.minHeight = l0.h * s + "px"; el.style.padding = R.TEXT_PAD * s + "px";   // (the element covers exactly the canvas' box, so a click anywhere on it stays in the editor; its height is never left to the browser's own layout of the invisible text)
    const baseY = v.ty + (oy + d.y + R.TEXT_PAD + l0.base) * s;                                  // where the canvas puts the first baseline
    el.style.left = v.tx + (ox + d.x) * s - bl + "px";
    el.style.top = baseY - R.domBaseline(l0.maxSize * s, l0.h * s) - R.TEXT_PAD * s - bt + "px";   // so the caret of the first line sits on it, whatever the font
  }
  onRichInput() {
    const ed = this.editing; if (!ed || !ed.rich) return;
    ed.content = this.rt.getContent();
    if (!this.rt.composing) this.liveFlow();                                  // (never rebuild the editor in the middle of an IME composition)
    this.syncLive(); this.positionEditor(); this.onRichSel(); this.revealCaret(); this.render();
  }
  /** Keep the caret on screen while typing / moving (the browser used to do this by scrolling the stage itself, which shifted the canvas). */
  revealCaret() {
    const d = this.editedItem(); if (!d || d.t !== "text" || !this.hasPage) return;
    const [a, b] = this.rt.getSel(), c = R.caretAt(d, a), [sx, sy] = this.pageToScreen(c.x, c.top), [, sy2] = this.pageToScreen(c.x, c.bottom), w = this.cw, h = this.ch, m = 24;
    const dx = sx < 0 ? sx - m : sx > w ? sx - (w - m) : 0, dy = sy < 0 ? sy - m : sy2 > h ? sy2 - (h - m) : 0;        // (only when the caret has really left the screen; then it is brought back with a margin)
    if (dx || dy) this.scrollViewBy(dx, dy);
  }
  onRichSel() { if (this.editing && this.editing.rich) { this.rstateKey = ""; this.fmtKey = ""; this.updateFmtUi(); this.caretReset(); this.render(); } }
  onRichKey(e) {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.finishEdit(); return true; }
    return this.richNavigate(e);
  }
  /** Up / Down / Home / End move the caret along the lines the canvas shows (not the invisible copy the browser lays out), keeping the horizontal position. */
  richNavigate(e) {
    const k = e.key;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || (k !== "ArrowUp" && k !== "ArrowDown" && k !== "Home" && k !== "End")) { if (k !== "ArrowUp" && k !== "ArrowDown") this.rt.goalX = null; return false; }
    const d = this.editedItem(), [a, b] = this.rt.getSel(); if (!d || d.t !== "text" || a !== b) return false;
    let to = null;
    if (k === "Home" || k === "End") { const r = R.lineRange(d, a); to = k === "Home" ? r.start : r.end; this.rt.goalX = null; }
    else {
      const x = this.rt.goalX ?? R.caretAt(d, a).x, t = R.offsetVertical(d, a, k === "ArrowUp" ? -1 : 1, x);
      if (t === null) { this.rt.goalX = null; return false; }                                     // first / last line: the browser's own behaviour (jump to the start / end of the text)
      to = t; this.rt.goalX = x;
    }
    e.preventDefault(); this.rt.setSel(to, to); this.onRichSel(); this.revealCaret();
    return true;
  }
  focusEditor() { if (this.editing && this.editing.rich) this.rt.focus(); else this.ta.focus({ preventScroll: true }); }
  /** The format (direction, alignment, snap to lines) of the edited item changed: show it. */
  refreshEditing() {
    if (!this.editing) return;
    if (this.editing.rich) { this.syncLive(); this.positionEditor(); }
    else this.positionEditor();
    this.focusEditor(); this.render();
  }
  // ---- continuing a long text on the next page while typing
  flowEnv() { return { layout: (d) => R.layoutRich(d), geoOf: (pg) => P.geometry(P.paperSpec(pg), M.PAGE_W, M.PAGE_H), newPage: (prev) => ({ ...M.clonePage(prev), items: [], auto: true }), newId: M.newId }; }
  /** The text reached the bottom of the page: the lines that do not fit move to the top of the next page and typing goes on there. */
  liveFlow() {
    const ed = this.editing;
    if (!ed || !ed.rich || this.kind !== "nb") return false;
    const d = this.editedItem(), pi = this.cur, geo = this.pageGeo(pi);
    if (!geo.flow || !F.splitItem(d, (x) => R.layoutRich(x), geo.flow.bottom)) return false;
    if (!ed.base) ed.base = this.snap();                                       // one undo step for the whole edit, also across pages
    const caret = this.rt.getSel()[0], pages = this.pages.slice();
    let hp = pi, hi = ed.idx, off = 0;
    if (ed.idx !== null) {
      const h = F.chainHead(pages, pi, ed.idx); hp = h.pi; hi = h.idx;
      const pcs = F.chainPieces(pages, hp, hi), k = pcs.findIndex((c) => c.pi === pi && c.idx === ed.idx);
      off = F.pieceStarts(pcs.map((c, j) => (j === k ? d : c.item)))[Math.max(0, k)];
    }
    const r = F.reflowChain(pages, hp, hi, this.flowEnv(), { pi, idx: ed.idx, item: d });
    this.pages = r.pages; this.layout();
    const loc = F.locate(r.pieces, off + caret), it = this.pages[loc.piece.pi].items[loc.piece.idx];
    if (loc.piece.pi !== this.cur) { const hadCur = this.cur; this.setCur(loc.piece.pi); this.vp = loc.piece.pi; void hadCur; }
    ed.idx = loc.piece.idx; ed.proto = null; ed.content = RT.contentOf(it);
    this.rt.setContent(ed.content, this.richCfg(this.editedItem()), [loc.local, loc.local]); this.rt.focus(); this.rt.setSel(loc.local, loc.local);
    if (!this.pageVisible(this.cur)) this.scrollToPage(this.cur);
    this.ui();
    return true;
  }
  positionEditor() {
    if (!this.editing) return;
    if (this.editing.rich) { this.positionRich(); return; }
    const d = this.editedItem(), v = this.view, ta = this.ta, s = v.scale;
    if (!d) return;
    const [ox, oy] = this.origin();
    const f = this.editing.fmt || (d.t === "node" ? R.nodeFmt(d) : R.fmtOf(d));    // explicit format, or null = old item (direction auto-detected)
    ta.dir = f ? f.dir : "auto"; ta.style.textAlign = f ? f.align : (d.t === "conn" ? "center" : "start");   // the browser's own bidi / shaping / caret handling
    if (d.t === "node" || d.t === "conn") { this.positionMindEditor(d, f); return; }
    ta.classList.remove("node");
    ta.style.fontSize = d.size * s + "px"; ta.style.lineHeight = "1.25"; ta.style.fontFamily = R.FONT_STACK;
    ta.style.left = v.tx + (ox + d.x + 8) * s + "px"; ta.style.top = v.ty + (oy + d.y + M.NOTE_HEADER + 4) * s + "px";
    ta.style.width = R.noteTextWidth(d) * s + "px"; ta.style.height = Math.max(40, (d.h - M.NOTE_HEADER - 8)) * s + "px";
    ta.style.color = M.noteTextColor({ color: d.color, bright: M.itemBright(d) }); ta.style.background = "transparent"; ta.classList.add("note");
  }
  finishEdit() {
    const ed = this.editing;
    if (!ed) return;
    if (ed.rich) { this.finishRich(ed); return; }
    this.editing = null; this.editingItem = null;
    const text = this.ta.value;
    this.ta.hidden = true; this.ta.classList.remove("node", "conn");
    if (ed.idx !== null) this.live = null;
    if (ed.idx === null) {
      if (text.trim()) {
        const d = { ...ed.proto, text, ...(ed.fmt || {}) };
        if (d.t === "note") d.h = Math.round(Math.max(d.h, R.noteNeededHeight(d, text)) * 100) / 100;
        if (d.t === "node") {                                   // size the new node to its text; it stays selected (Tab / Enter continue the map)
          const fit = R.nodeFit(d, text, ed.domH || 0), w = d.g ? fit.w : Math.max(60, Math.abs(d.x2 - d.x1)), h = d.g ? fit.h : Math.max(Math.abs(d.y2 - d.y1), fit.h);
          d.x2 = Math.round((d.x1 + w) * 100) / 100; d.y2 = Math.round((d.y1 + h) * 100) / 100;
          const at = this.items.length; this.commit([...this.items, d, ...(ed.extra || [])], { select: at });
        } else this.commit([...this.items, d]);
      } else { this.preview = null; this.render(); }
      return;
    }
    const old = this.items[ed.idx];
    if (!old) { this.render(); return; }
    const items = this.items.slice();
    if (old.t === "conn") {                                     // connector label
      const lab = text.trim();
      if (lab !== (old.label || "")) { const n = { ...old }; if (lab) n.label = lab; else delete n.label; items[ed.idx] = n; this.commit(items, { keepSel: true }); } else this.render();
      return;
    }
    if (old.t === "node") {
      const fmtCh = !!ed.fmt && (ed.fmt.dir !== old.dir || ed.fmt.align !== old.align);
      if (text !== old.text || fmtCh) {
        let d = { ...old, text, ...(ed.fmt || {}) };
        if (old.g) d = this.fitNode(d, ed.domH || 0);                                             // auto-sized: exactly as big as the new text
        else {                                                                                     // sized by hand (or an older node): only grows to fit its text
          const fit = R.nodeFit(d, text, ed.domH || 0);
          d.x2 = Math.round((Math.min(d.x1, d.x2) + Math.max(Math.abs(old.x2 - old.x1), fit.w)) * 100) / 100;
          d.y2 = Math.round((Math.min(d.y1, d.y2) + Math.max(Math.abs(old.y2 - old.y1), fit.h)) * 100) / 100;
          d.x1 = Math.min(old.x1, old.x2); d.y1 = Math.min(old.y1, old.y2);
        }
        items[ed.idx] = d; this.commit(items, { keepSel: true });
      } else this.render();
      return;
    }
    const fmtChanged = !!ed.fmt && (ed.fmt.dir !== old.dir || ed.fmt.align !== old.align);
    if (text !== old.text || fmtChanged) {
      const d = { ...old, text, ...(ed.fmt || {}) };
      if (old.t === "note") d.h = Math.round(Math.max(old.h, R.noteNeededHeight(d, text)) * 100) / 100;
      items[ed.idx] = d; this.commit(items, { keepSel: true });
    } else this.render();
  }
  /** Leave the rich text editor: the box is stored (cut into pieces across pages when it is long) as ONE undo step. */
  finishRich(ed) {
    ed.content = this.rt.getContent();
    let d = this.editedItem(); const pi = this.cur, old = ed.idx !== null ? this.items[ed.idx] : null, empty = !ed.content.text.trim();
    if (d && ed.grow) d = R.growBox(d, ed.grow, true);                                        // the box is saved exactly as wide as its text
    this.editing = null; this.editingItem = null; this.rt.hide(); this.caretStop();
    this.live = null; this.preview = null;
    const g = GROUP_OF_TOOL[this.tool]; if (g && this.tool !== "select") this.curStyle = { ...this.groups[g] };      // (the caret's size / colour was only shown, not chosen)
    const sameC = old && JSON.stringify([ed.content.text, ed.content.runs, ed.content.lists]) === JSON.stringify([old.text, old.runs || null, old.lists || null]);
    const fmtSame = !ed.fmt || (ed.fmt.dir === old.dir && ed.fmt.align === old.align);
    if (old && !ed.base && sameC && fmtSame && ed.ruled === undefined && !empty) { this.render(); return; }          // opened and closed without a change: the box is left exactly as it was
    if (this.kind !== "nb" || (empty && !(old && old.fl))) {
      if (empty) { if (old) { const items = this.items.slice(); items.splice(ed.idx, 1); this.commit(items); } else this.render(); return; }
      if (old) { const items = this.items.slice(); items[ed.idx] = d; this.commit(items, { keepSel: true }); } else this.commit([...this.items, d]);
      return;
    }
    const base = ed.base || this.snap(), pages = this.pages.slice();
    const head = old ? F.chainHead(pages, pi, ed.idx) : { pi, idx: null };
    const r = F.reflowChain(pages, head.pi, head.idx, this.flowEnv(), { pi, idx: ed.idx, item: d });
    let out = r.pages;
    const mine = r.pieces.find((p) => p.pi === pi && (ed.idx === null || p.idx === ed.idx)) || r.pieces[0];
    if (empty && r.pieces.length === 1 && !out[mine.pi].items[mine.idx].text.trim()) { out = out.slice(); out[mine.pi] = { ...out[mine.pi], items: out[mine.pi].items.filter((_, i) => i !== mine.idx) }; this.commitPages(out, { base, page: ed.page0 }); return; }
    this.commitPages(out, { base, page: ed.page0, show: mine.pi, select: old ? mine.idx : null });
  }
  /** Replace the page list (several pages may have changed) as one undo step. */
  commitPages(pages, { base = null, page = this.cur, show = this.cur, select = null } = {}) {
    this.history.push(base || this.snap(), page);
    this.pages = this.trimAutoPages(pages);
    this.layout(); this.live = null; this.preview = null;
    if (show !== this.cur) { this.setCur(Math.min(show, this.pages.length - 1)); }
    this.selected = select !== null && this.items[select] ? select : null;
    this.dirty = true; this.app.onChange(this);
    this.clampView(); this.ui(); this.render();
  }
  /** Pages that were added only to hold continued text and are empty again (at the end of the notebook) go away. */
  trimAutoPages(pages) {
    let n = pages.length;
    while (n > 1 && pages[n - 1].auto && !pages[n - 1].items.length) n--;
    return n === pages.length ? pages : pages.slice(0, n);
  }
  /** After a text box was moved, resized or restyled: cut it into pieces (or join it) again, inside the same undo step. */
  reflowAt(pi, idx) {
    if (this.kind !== "nb") return;
    const d = this.pages[pi] && this.pages[pi].items[idx];
    if (!d || d.t !== "text") return;
    const geo = this.pageGeo(pi);
    if (!d.fl && !(geo.flow && F.splitItem(d, (x) => R.layoutRich(x), geo.flow.bottom))) return;
    const h = F.chainHead(this.pages, pi, idx), r = F.reflowChain(this.pages, h.pi, h.idx, this.flowEnv());
    this.pages = this.trimAutoPages(r.pages); this.layout();
  }
  /** Reflow every long text box of these pages (after the paper, spacing or margins changed). */
  reflowPages(indexes) {
    if (this.kind !== "nb") return;
    for (const pi of indexes) {
      for (let k = 0; this.pages[pi] && k < this.pages[pi].items.length; k++) {
        const d = this.pages[pi].items[k];
        if (d.t !== "text") continue;
        if (d.fl && F.chainHead(this.pages, pi, k).pi !== pi) continue;
        this.reflowAt(pi, k);
      }
    }
  }
  onEditorKey(e) {
    const ed = this.editing, d = ed && (ed.idx !== null ? this.items[ed.idx] : ed.proto);
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.finishEdit(); }
    else if (d && (d.t === "node" || d.t === "conn") && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.finishEdit(); }
    else if (d && d.t === "node" && e.key === "Tab" && !e.isComposing) { e.preventDefault(); const id = d.id; this.finishEdit(); this.addChild(id); }   // Tab: finish this node, add a child
    e.stopPropagation();
  }
  /** Text box over a node / connector label while it is being edited (the node grows with its text). */
  positionMindEditor(d, f) {
    const ta = this.ta, v = this.view, s = v.scale, [ox, oy] = this.origin(), ed = this.editing;
    if (d.t === "conn") {
      const g = M.connGeometry(d, this.nodeMapFor(this.drawList) || new Map());
      if (!g) return;
      const w = Math.max(90, 9 * ((ta.value || "").length + 3));
      ta.classList.add("conn"); ta.classList.remove("node");
      ta.style.fontSize = 15 * s + "px"; ta.style.lineHeight = "1.25"; ta.style.fontFamily = R.FONT_STACK;
      ta.style.left = v.tx + (ox + g.mid[0] - w / 2) * s + "px"; ta.style.top = v.ty + (oy + g.mid[1] - 11) * s + "px";
      ta.style.width = w * s + "px"; ta.style.height = 22 * s + "px"; ta.style.color = M.cssColor(d); ta.style.background = this.kind === "board" ? R.BOARD_COLORS[this.pages[0].paper] : "#ffffff";
      return;
    }
    // Width: from the canvas measurement. Height: from what the text box REALLY needs (scrollHeight), because the box and the canvas can wrap a
    // line differently; a fixed height made the box scroll and hide the upper line while typing.
    ta.classList.add("node"); ta.classList.remove("conn");
    ta.style.fontSize = d.size * s + "px"; ta.style.lineHeight = "1.25"; ta.style.fontFamily = R.FONT_STACK;
    const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2), pre = R.nodeFit(d, ta.value), ell = R.nodeEll(d);
    const auto = !!d.g;                                                                      // auto-sized: exactly as big as its text (grows and shrinks); sized by hand: its width, taller if the text needs it
    const w0 = auto ? pre.w : ed.idx === null ? Math.max(60, Math.abs(d.x2 - d.x1)) : Math.max(Math.abs(d.x2 - d.x1), pre.w), mw = Math.max(10, (w0 - 2 * M.NODE_PAD) / ell);
    ta.style.width = mw * s + 1.5 + "px"; ta.style.height = "1px";                          // (1.5 px slack so the box never wraps earlier than the canvas)
    const domH = ta.scrollHeight / s;
    ed.domH = domH;
    const fit = R.nodeFit(d, ta.value, domH), w = w0, h = auto ? fit.h : Math.max(Math.abs(d.y2 - d.y1), fit.h);
    if (ed.idx === null) { d.x2 = x1 + w; d.y2 = y1 + h; }                                    // proto (still a preview): grows with the text
    else if (Math.abs(d.x2 - d.x1) !== w || Math.abs(d.y2 - d.y1) !== h) { this.live = this.items.slice(); this.live[ed.idx] = { ...d, x1, y1, x2: x1 + w, y2: y1 + h }; }
    ta.style.left = v.tx + (ox + x1 + (w - mw) / 2) * s + "px"; ta.style.top = v.ty + (oy + y1 + (h - fit.textH) / 2) * s + "px";
    ta.style.height = fit.textH * s + "px";
    ta.style.color = d.fill ? (M.parseHex(d.fill) && (0.299 * M.parseHex(d.fill)[0] + 0.587 * M.parseHex(d.fill)[1] + 0.114 * M.parseHex(d.fill)[2] > 150) ? "#111" : "#fff") : M.cssColor(d);
    ta.style.background = "transparent";
    this.render();
  }

  // ----------------------------------------------------------- insert content
  async insertImageBlob(blob) {
    if (!this.hasPage) { toast("Open a PDF first."); return false; }
    this.finishEdit();
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { toast("Could not read this image."); return false; }
    const s0 = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s0)); c.height = Math.max(1, Math.round(bmp.height * s0));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(png); });
    this.activateAt(this.ch / 2);
    const [pw, ph] = this.pageDims();
    let w = c.width * 0.75, h = c.height * 0.75;
    const fit = Math.min(1, 0.6 * pw / w, 0.6 * ph / h);
    w *= fit; h *= fit;
    const ctr = this.screenToPage(this.cw / 2, this.ch / 2);
    const x = clamp(ctr.x - w / 2, 0, Math.max(0, pw - w)), y = clamp(ctr.y - h / 2, 0, Math.max(0, ph - h));
    const r2 = (v) => Math.round(v * 100) / 100;
    const item = { t: "image", x1: r2(x), y1: r2(y), x2: r2(x + w), y2: r2(y + h), data };
    await R.getImage(data).promise;
    this.setTool("select");
    this.commit([...this.items, item], { select: this.items.length });
    this.syncStyleToSelection();
    return true;
  }
  insertText(text) {
    if (!this.hasPage || !text || !text.trim()) return false;
    this.finishEdit();
    this.activateAt(this.ch / 2);
    const [pw, ph] = this.pageDims(), ctr = this.screenToPage(this.cw / 2, this.ch / 2), st = this.curStyle;
    const bw = Math.min(M.TEXT_BOX_W, pw - 8), f = this.fmt;
    const item = { t: "text", x: clamp(ctr.x - bw / 2, 4, pw - bw - 4), y: clamp(ctr.y, 0, ph - 30), w: bw, dir: f.dir, align: f.align, text, color: st.color, size: st.size, ...this.styleExtra() };
    this.setTool("select");
    this.commit([...this.items, item], { select: this.items.length, flowIdx: this.items.length });
    return true;
  }
  async onImageFile() {
    const f = this.imgInput.files[0]; this.imgInput.value = "";
    if (f) await this.insertImageBlob(f);
  }

  // ----------------------------------------------------------------- pages
  async goto(n) {
    if (!this.hasPage || !this.offs) return;
    n = clamp(Math.round(n) || 0, 0, this.pages.length - 1);
    this.finishEdit();
    try { await this.loadSizes(n - 5, n + 20); } catch { /* sizes fall back to page 1's size */ }
    if (this.hasPage) this.scrollToPage(n);
  }
  showPage(n) { return this.showDoc(n); }
  /** First display of a document: read the first page sizes (PDF), lay out all pages, show page n at 'fit width'. */
  async showDoc(n) {
    const token = ++this.pageToken, doc = this.pdf && this.pdf.doc;
    this.selected = null; this.live = null; this.preview = null; this.action = null;
    if (this.kind === "pdf") {
      try { await this.loadSizes(n - 5, n + 20); } catch (e) { console.error(e); toast("Could not read this page."); return; }
      if (token !== this.pageToken || !this.pdf || this.pdf.doc !== doc) return;
      if (!this.sizes.some(Boolean)) this.sizes[0] = [595, 842];
    }
    if (this.kind === "board") { this.layout(); this.cur = this.vp = 0; this.view.init = true; this.fitContent(false); this.ui(); return; }
    this.layout();
    this.cur = this.vp = clamp(n, 0, this.pages.length - 1);
    this.view.fit = true; this.fitView(false);
    this.scrollToPage(this.cur);
    this.ui();
  }

  // --------------------------------------------------------------- PDF panel
  async openPdfBytes(bytes, name, { workspace = null } = {}) {
    let loaded;
    try { loaded = await PDF.loadDocument(bytes, { detectEmbedded: !workspace }); } catch (e) { toast(e.message || "Could not open the PDF."); return false; }
    const { doc, source } = loaded;
    let pages = workspace ? workspace.pages : loaded.pages;
    if (workspace && pages.length !== doc.numPages) { await doc.destroy(); toast("The PDF annotations do not match the embedded PDF."); return false; }
    this.finishEdit();
    this.resetDoc();
    if (this.pdf) { try { await this.pdf.doc.destroy(); } catch { /* ignore */ } }
    this.pdf = { doc, source }; this.name = name;
    this.pages = (pages || Array.from({ length: doc.numPages }, () => [])).map((items) => ({ items: items.slice() }));
    this.refitNodes();
    this.history.clear(); this.dirty = false; this.cur = 0;
    await this.showPage(0);
    this.app.onChange(this, { clean: true });
    return true;
  }
  clearPdf() {
    this.finishEdit(); this.resetDoc();
    if (this.pdf) this.pdf.doc.destroy().catch(() => {});
    this.pdf = null; this.name = null; this.pages = []; this.cur = 0;
    this.history.clear(); this.dirty = false; this.selected = null;
    this.ui(); this.render();
  }
  async saveAnnotated() {
    if (!this.pdf) { toast("Open a PDF first."); return false; }
    this.finishEdit();
    const busy = this.app.busy("Saving PDF…");
    try {
      const bytes = await PDF.exportAnnotatedPdf(this.pdf.source, this.pages.map((p) => p.items), (f) => busy.set(f));
      const base = (this.name || "document.pdf").replace(/\.pdf$/i, "");
      await this.app.saveBlob(new Blob([bytes], { type: "application/pdf" }), `${base}_annotated.pdf`);
      this.dirty = false; this.app.onChange(this, { clean: true }); this.ui();
      return true;
    } catch (e) { console.error(e); toast("Could not save the PDF: " + (e.message || e), 5000); return false; }
    finally { busy.done(); }
  }
  workspaceData() {
    if (!this.pdf) return null;
    this.finishEdit();
    return { name: this.name || "document.pdf", source: this.pdf.source, pages: this.pages.map((p) => p.items) };
  }

  // ------------------------------------------------------------ notebook panel
  async newNotebook() {
    if (!(await this.app.confirmReplace(this, "start a new notebook"))) return;
    this.setNotebook([{ paper: "lined", items: [] }], null);
  }
  setNotebook(pages, name) {
    this.finishEdit();
    this.pages = pages.map((p) => M.clonePage(p)); this.layers.clear();
    this.refitNodes();
    this.name = name; this.history.clear(); this.dirty = false; this.cur = 0;
    this.showPage(0);
    this.app.onChange(this, { clean: true });
  }
  /** Page-structure change (add / delete / move / paper). Applies to the page being viewed; the page column is laid out again. */
  structural(mutate, { scroll = true } = {}) {
    this.finishEdit();
    if (this.vp !== this.cur) this.setCur(this.vp);
    this.history.push(this.snap(), this.cur);
    mutate();
    this.selected = null; this.live = null; this.preview = null;
    this.dirty = true; this.app.onChange(this);
    this.layout();
    if (scroll) this.scrollToPage(this.cur); else { this.clampView(); this.ui(); this.render(); }
  }
  addPage() { this.structural(() => { const src = this.pages[this.cur], np = { paper: src.paper, items: [] }; for (const k of P.PAGE_PROPS) if (src[k] !== undefined) np[k] = src[k]; this.pages.splice(this.cur + 1, 0, np); this.cur++; }); }   // new page goes directly below the current one
  async deletePage() {
    if (this.pages.length <= 1) { toast("A notebook needs at least one page."); return; }
    if (this.vp !== this.cur) this.setCur(this.vp);
    if (this.items.length) {
      const ok = await dialog({ title: "Delete page", content: `Delete page ${this.cur + 1} and everything on it? (You can undo this.)`,
        buttons: [{ label: "Cancel", value: false }, { label: "Delete", value: true, primary: true, danger: true }] });
      if (!ok) return;
    }
    this.structural(() => { this.pages.splice(this.cur, 1); this.cur = Math.min(this.cur, this.pages.length - 1); });
  }
  movePage(step) {
    if (this.vp !== this.cur) this.setCur(this.vp);
    const j = this.cur + step;
    if (j < 0 || j >= this.pages.length) return;
    this.structural(() => { [this.pages[this.cur], this.pages[j]] = [this.pages[j], this.pages[this.cur]]; this.cur = j; });
  }
  /** Ruled text of these pages follows their line spacing (and the paper's rules). */
  retunePage(pg) {
    const pitch = P.paperSpec(pg).spacing;
    pg.items = pg.items.map((d) => (d.t === "text" && d.ruled === true ? R.ruledNormalize(this.withPitch(d, pitch)) : d));
  }
  setPaper(kind) {
    if (this.vp !== this.cur) this.setCur(this.vp);
    const pg = this.pages[this.cur];
    if (kind === pg.paper) return;
    this.structural(() => {
      const old = pg.paper; pg.paper = kind;
      if (!P.sameRuledFamily(old, kind)) delete pg.spacing;                    // every paper has its own natural spacing
      delete pg.cue; delete pg.summary;
      this.retunePage(pg); this.reflowPages([this.cur]);
    }, { scroll: false });
  }
  /** Change line spacing, margin, direction ... of this page (or of all pages): one undo step. */
  setPageSettings(patch, all = false) {
    if (this.kind !== "nb") return;
    if (this.vp !== this.cur) this.setCur(this.vp);
    const idxs = all ? this.pages.map((_, i) => i) : [this.cur];
    this.structural(() => {
      for (const i of idxs) {
        const pg = this.pages[i], p = { ...patch };
        if ("dir" in p && !("margin" in p) && P.paperSpec(pg).margin !== "none") p.margin = p.dir === "rtl" ? "right" : "left";       // the margin follows the writing direction
        if ("dir" in p && !("week_start" in p)) delete pg.week_start;
        Object.assign(pg, p);
        if ("spacing" in patch && P.SPACING[pg.paper] && patch.spacing === P.SPACING[pg.paper].def) delete pg.spacing;
        this.retunePage(pg);
      }
      this.reflowPages(idxs);
    }, { scroll: false });
    if (patch.dir) { this.fmt = { dir: patch.dir, align: patch.dir === "rtl" ? "right" : "left" }; this.fmtKey = ""; }   // new text on this page follows the page
  }
  resetPageSettings(all = false) {
    if (this.kind !== "nb") return;
    if (this.vp !== this.cur) this.setCur(this.vp);
    const idxs = all ? this.pages.map((_, i) => i) : [this.cur];
    this.structural(() => { for (const i of idxs) { for (const k of P.PAGE_PROPS) delete this.pages[i][k]; this.retunePage(this.pages[i]); } this.reflowPages(idxs); }, { scroll: false });
  }
  openPaper() {
    this.finishEdit();
    if (this.vp !== this.cur) this.setCur(this.vp);
    popup(this.paperBtn, paperContent({ getSpec: () => this.pageSpec(), names: P.PAPER_NAMES, count: this.pages.length,
      onChange: (patch, all) => this.setPageSettings(patch, all), onReset: (all) => this.resetPageSettings(all) }));
  }
  async saveNotebook() {
    this.finishEdit();
    const base = (this.name || "notebook").replace(/\.dnote$/i, "");
    await this.app.saveBlob(new Blob([M.notebookToJson(this.pages)], { type: "application/json" }), `${base}.dnote`);
    this.dirty = false; this.app.onChange(this, { clean: true }); this.ui();
    return true;
  }
  async exportNotebook() {
    this.finishEdit();
    const busy = this.app.busy("Exporting PDF…");
    try {
      const bytes = await PDF.exportNotebookPdf(this.pages, (f) => busy.set(f));
      await this.app.saveBlob(new Blob([bytes], { type: "application/pdf" }), `${(this.name || "notebook").replace(/\.dnote$/i, "")}.pdf`);
    } catch (e) { console.error(e); toast("Could not export the PDF: " + (e.message || e), 5000); }
    finally { busy.done(); }
  }

  // ----------------------------------------------------------- files / misc
  pickFile(accept) { this.fileInput.accept = accept; this.fileInput.click(); }
  async onFile() {
    const f = this.fileInput.files[0]; this.fileInput.value = "";
    if (!f) return;
    if (!(await this.app.confirmReplace(this, "open another file"))) return;
    if (this.kind === "pdf") await this.openPdfBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    else if (this.kind === "board") { try { this.setBoard(M.parseBoard(await f.text()), f.name); } catch (e) { toast(e.message, 4000); } }
    else {
      try { this.setNotebook(M.parseNotebook(await f.text()), f.name); } catch (e) { toast(e.message, 4000); }
    }
  }
  viewState() { return { zoom: Math.round(this.view.scale * 1e4) / 1e4, auto_fit: this.view.fit, page: this.shown(), bars: this.barsOpen,
    toolbar: { tool: this.tool, ...T.groupsToSaved(this.groups), recent: [...this.recent], text_format: { ...this.fmt }, snap_lines: this.snapLines, shape: this.shapeKind, fill: this.fill.shape, fill_mind: this.fill.mind, text_style: { ...this.textStyle }, conn_style: this.connStyle, conn_arrow: this.connArrow, node_kind: this.nodeKind },
    ...(this.kind === "board" ? { center: [Math.round((this.cw / 2 - this.view.tx) / this.view.scale), Math.round((this.ch / 2 - this.view.ty) / this.view.scale)] } : {}) }; }
  restoreView(st) {
    if (!st || typeof st !== "object") return;
    const tb = st.toolbar;
    if (tb && typeof tb === "object") {
      this.groups = T.groupsFromSaved(tb, this.toolDefaultsNow(), M.sanitizeStyle);
      this.curStyle = { ...(this.groups[GROUP_OF_TOOL[this.tool]] || this.curStyle) };
      if (Array.isArray(tb.recent)) this.recent = tb.recent.map((c) => { const p = typeof c === "string" ? M.parseHex(c) : null; return p ? M.toHex(...p) : null; }).filter(Boolean).slice(0, 10);
      const tf = tb.text_format;
      if (tf && typeof tf === "object") this.fmt = { dir: M.TEXT_DIRS.includes(tf.dir) ? tf.dir : this.fmt.dir, align: M.TEXT_ALIGNS.includes(tf.align) ? tf.align : this.fmt.align };
      if (typeof tb.snap_lines === "boolean") this.snapLines = tb.snap_lines;
      if (typeof tb.shape === "string" && M.SHAPE_KINDS.some((k) => k.id === tb.shape)) this.shapeKind = tb.shape;
      if (typeof tb.fill === "boolean") this.fill.shape = tb.fill;
      if (typeof tb.fill_mind === "boolean") this.fill.mind = tb.fill_mind;
      if (tb.text_style !== undefined) this.textStyle = T.sanitizeTextStyle(tb.text_style);
      if (M.CONN_STYLES.includes(tb.conn_style)) this.connStyle = tb.conn_style;
      if (typeof tb.conn_arrow === "boolean") this.connArrow = tb.conn_arrow;
      if (M.NODE_KINDS.includes(tb.node_kind)) this.nodeKind = tb.node_kind;
      let tool = tb.tool;
      if (OLD_SHAPE_TOOLS.includes(tool)) { this.shapeKind = tool; tool = "shape"; }   // workspaces from before the Shapes tool
      this.updateShapeBtn();
      const allowed = [...(this.kind === "pdf" ? PDF_TOOLS : this.kind === "board" ? BOARD_TOOLS : NB_TOOLS), ...MIND_TOOLS];
      this.setTool(allowed.includes(tool) ? tool : this.tool);
    }
    if (typeof st.bars === "boolean") this.setBars(st.bars);
    if (this.kind === "board") {                                      // a board remembers zoom and the point in the middle of the view
      const z = +st.zoom, c = st.center;
      if (Number.isFinite(z)) this.view.scale = clamp(z, this.minZoom, 6);
      if (Array.isArray(c) && c.length === 2 && c.every((x) => Number.isFinite(+x))) {
        this.view.init = true;
        if (this.root.hidden) this.pendingCenter = [+c[0], +c[1]]; else this.applyCenter([+c[0], +c[1]]);
      }
      this.view.fit = false; this.render(); return;
    }
    if (st.auto_fit === false && Number.isFinite(+st.zoom) && this.hasPage) {
      const [w] = this.pageDims();
      this.view.scale = clamp(+st.zoom, this.minZoom, 6); this.view.fit = false;
      if (this.continuous() && this.offs) { this.view.tx = (this.cw - this.docW * this.view.scale) / 2; this.scrollToPage(this.vp); }
      else { this.view.tx = (this.cw - w * this.view.scale) / 2; this.view.ty = 8; this.clampView(); this.scheduleRaster(); }
    } else if (this.hasPage) this.fitView(false);
    this.render();
  }
  setLabel(label) { this.label = label; this.ui(); }

  ui() {
    const n = this.pages.length, has = this.hasPage;
    const name = this.name || (this.kind === "pdf" ? "no file" : "untitled");
    this.titleEl.replaceChildren(el("b", {}, this.label), " — " + name, this.dirty ? el("span", { class: "dirty" }, " •") : "");
    this.root.classList.toggle("dirty", this.dirty);
    this.msg.replaceChildren();
    if (!has) {
      this.msg.append(el("div", { class: "hint" }, el("p", {}, "Open a PDF to begin"),
        el("button", { class: "btn primary big", type: "button", onclick: () => this.pickFile(".pdf,application/pdf") }, icon("open"), "Open PDF"),
        el("p", { class: "muted" }, "or drop a .pdf file here")));
    }
    this.pageInput.value = has ? this.shown() + 1 : ""; this.pageInput.max = n; this.pageCount.textContent = has ? ` / ${n}` : " / 0";
    const set = (b, on) => { b.disabled = !on; };
    set(this.b.undo, this.history.canUndo()); set(this.b.redo, this.history.canRedo());
    set(this.b.prev, has && this.shown() > 0); set(this.b.next, has && this.shown() < n - 1);
    set(this.b.zin, has); set(this.b.zout, has); set(this.b.fit, has); this.pageInput.disabled = !has;
    set(this.b.image, has);
    if (this.kind === "pdf") set(this.b.save, has);
    else if (this.kind === "nb") {
      set(this.b.del, n > 1); set(this.b.earlier, this.shown() > 0); set(this.b.later, this.shown() < n - 1);
      this.paper.value = this.pages[this.shown()]?.paper || "lined";
    } else this.updateBoardUi();
    if (this.toolBtns.hltext) this.toolBtns.hltext.disabled = !has;
  }
}
