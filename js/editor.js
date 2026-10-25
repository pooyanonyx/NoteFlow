// The rich text editor of a text box: a contenteditable element over the page whose TEXT IS INVISIBLE. The page canvas draws the text live with the
// very same code that draws it afterwards (render.js), so what you see while typing is exactly what you get after editing, saving and reopening.
// This element only provides what a browser is good at: the caret, selection, keyboard / IME input, clipboard and bidi cursor movement.
// It is built from the content model of richtext.js: one <div class="rp"> per paragraph holding styled <span>s, and it is read back after every input.
import * as RT from "./richtext.js";
import { FONT_STACK, ruledLH } from "./render.js";

const isPara = (n) => n.nodeType === 1 && n.tagName === "DIV";
export class RichEditor {
  constructor(handlers = {}) {
    this.h = handlers; this.cfg = { base: 16, s: 1, ruled: false, pitch: 24, fmt: null, indent: 24 };
    this.pending = null; this.undoStack = []; this.redoStack = []; this.lastPush = 0; this.lastType = ""; this.composing = false;
    this.el = document.createElement("div");
    Object.assign(this.el, { className: "editor rt", hidden: true, contentEditable: "true", spellcheck: false });
    this.el.setAttribute("role", "textbox"); this.el.setAttribute("aria-multiline", "true"); this.el.setAttribute("aria-label", "Text");
    this.el.autocapitalize = "off";
    const on = (t, f) => this.el.addEventListener(t, f);
    on("beforeinput", (e) => this.beforeInput(e)); on("input", (e) => this.afterInput(e)); on("keydown", (e) => this.keyDown(e));
    on("paste", (e) => { e.preventDefault(); this.insert((e.clipboardData && e.clipboardData.getData("text/plain")) || ""); });
    on("drop", (e) => e.preventDefault()); on("dragstart", (e) => e.preventDefault());
    on("compositionstart", () => { this.composing = true; }); on("compositionend", (e) => { this.composing = false; this.afterInput({ inputType: "insertText", data: e.data, isComposing: false }); });
    on("blur", () => this.h.onBlur && this.h.onBlur());
    this.onSel = () => { if (!this.el.hidden && this.inside()) this.h.onSelection && this.h.onSelection(); };
  }
  inside() { const s = document.getSelection(); return !!s && s.rangeCount > 0 && this.el.contains(s.anchorNode); }
  show() { this.el.hidden = false; document.addEventListener("selectionchange", this.onSel); }
  hide() { this.el.hidden = true; document.removeEventListener("selectionchange", this.onSel); this.undoStack = []; this.redoStack = []; this.pending = null; }
  focus() { this.el.focus({ preventScroll: true }); }

  // ------------------------------------------------------------ content <-> DOM
  /** Replace what is shown by `content`. cfg: {base, s, ruled, pitch, fmt, indent}. sel = [a, b] puts the caret there. */
  setContent(content, cfg = null, sel = null) {
    if (cfg) this.cfg = { ...this.cfg, ...cfg };
    const frag = document.createDocumentFragment(), paras = RT.paragraphRanges(content.text), sp = RT.spans(content);
    paras.forEach((p, i) => {
      const div = document.createElement("div"); div.className = "rp";
      const list = RT.listAt(content, i); if (list) div.dataset.l = list;
      let any = false;
      for (const r of sp) {
        if (r.end <= p.start || r.start >= p.end) continue;
        const t = content.text.slice(Math.max(r.start, p.start), Math.min(r.end, p.end));
        if (t) { div.append(this.spanEl(t, r)); any = true; }
      }
      if (!any) { const s = this.spanEl("", p.start > 0 ? RT.styleOfChar(content, p.start - 1) : {}); s.append(document.createElement("br")); div.append(s); }     // (an empty line keeps the style of the line before it: typing goes on in it)
      frag.append(div);
    });
    this.el.replaceChildren(frag);
    this.restyle();
    if (sel) this.setSel(sel[0], sel[1]);
  }
  spanEl(text, st) {
    const s = document.createElement("span");
    if (st.b) s.dataset.b = "1"; if (st.i) s.dataset.i = "1"; if (st.u) s.dataset.u = "1"; if (st.z !== undefined && st.z !== null) s.dataset.z = String(st.z);
    if (text) s.textContent = text;
    return s;
  }
  /** Sizes, line heights and direction from the current zoom / box settings (cheap: no rebuild). */
  restyle(cfg = null) {
    if (cfg) this.cfg = { ...this.cfg, ...cfg };
    const { base, s, ruled, pitch, fmt, indent } = this.cfg, root = this.el;
    root.style.fontFamily = FONT_STACK; root.style.fontSize = base * s + "px"; root.style.lineHeight = "0";      // (the line boxes come from the spans, never from the box itself)
    root.style.textAlign = fmt ? fmt.align : "start";
    for (const p of root.children) {
      p.dir = fmt ? fmt.dir : "auto";
      p.style.paddingInlineStart = p.dataset.l ? indent * s + "px" : "";
      for (const sp of p.querySelectorAll("span")) {
        const z = sp.dataset.z ? +sp.dataset.z : base;
        sp.style.fontSize = z * s + "px"; sp.style.lineHeight = (ruled ? ruledLH(z, pitch) : z * 1.25) * s + "px";
      }
    }
  }
  /** The content shown: text + runs + lists, read from the DOM whatever structure the browser made of it. */
  getContent() {
    const root = this.el, paras = []; let cur = null;
    const styleOf = (node) => {
      const st = {};
      for (let e = node.parentElement; e && e !== root; e = e.parentElement) {
        const d = e.dataset || {};
        if (d.b === "1" || e.tagName === "B" || e.tagName === "STRONG") st.b = 1;
        if (d.i === "1" || e.tagName === "I" || e.tagName === "EM") st.i = 1;
        if (d.u === "1" || e.tagName === "U") st.u = 1;
        if (d.z && st.z === undefined) st.z = +d.z;
      }
      return st;
    };
    const start = (list = "") => { cur = { pieces: [], list }; paras.push(cur); };
    const add = (data, node) => {
      const st = styleOf(node), parts = data.replace(/[\u200b\u00a0]/g, (c) => (c === "\u00a0" ? " " : "")).split("\n");
      parts.forEach((t, i) => { if (i) start(cur ? cur.list : ""); if (!cur) start(""); if (t) cur.pieces.push({ s: t, st }); });
    };
    const walk = (node) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) add(ch.data, ch);
        else if (ch.nodeType === 1 && ch.tagName !== "BR") {
          if (isPara(ch) || ch.tagName === "P" || ch.tagName === "LI") { start(ch.dataset.l || ""); walk(ch); cur = null; } else walk(ch);
        }
      }
    };
    walk(root);
    if (!paras.length) start("");
    let text = "", runs = [], lists = [];
    paras.forEach((p, i) => {
      if (i) { text += "\n"; const last = runs[runs.length - 1]; runs.push({ s: "\n", ...(last ? this.stOf(last) : {}) }); }
      for (const pc of p.pieces) { text += pc.s; runs.push({ s: pc.s, ...pc.st }); }
      lists.push(p.list === "b" || p.list === "n" ? p.list : "");
    });
    return RT.makeContent(text, runs, lists);
  }
  stOf(r) { const o = {}; for (const k of ["b", "i", "u", "z"]) if (r[k] !== undefined) o[k] = r[k]; return o; }
  /** Is the DOM in the shape this editor builds (paragraph divs directly in the root)? */
  canonical() { return [...this.el.childNodes].every((n) => isPara(n)) && this.el.childNodes.length > 0; }

  // -------------------------------------------------------------- selection
  paras() { return [...this.el.children].filter(isPara); }
  offsetOf(node, off) {
    const blocks = this.paras(); let pos = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (node === this.el) { if (off <= i) return pos; }
      else if (b === node || b.contains(node)) { const r = document.createRange(); r.selectNodeContents(b); try { r.setEnd(node, off); } catch { /* ignore */ } return pos + r.toString().replace(/[\u200b]/g, "").length; }
      pos += b.textContent.length + 1;
    }
    return Math.max(0, pos - 1);
  }
  pointAt(off) {
    const blocks = this.paras(); let pos = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], len = b.textContent.length;
      if (off <= pos + len || i === blocks.length - 1) {
        let local = Math.max(0, Math.min(len, off - pos)), acc = 0;
        const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (local <= acc + n.length) return [n, local - acc]; acc += n.length; }
        return [b.querySelector("span") || b, 0];
      }
      pos += len + 1;
    }
    return [this.el, 0];
  }
  getSel() {
    const s = document.getSelection();
    if (!s || !s.rangeCount || !this.el.contains(s.anchorNode)) return this.lastSel || [0, 0];
    const a = this.offsetOf(s.anchorNode, s.anchorOffset), b = this.offsetOf(s.focusNode, s.focusOffset);
    this.lastSel = [Math.min(a, b), Math.max(a, b)];
    return this.lastSel;
  }
  setSel(a, b = a) {
    const s = document.getSelection(), r = document.createRange(), p = this.pointAt(a), q = a === b ? p : this.pointAt(b);
    try { r.setStart(p[0], p[1]); r.setEnd(q[0], q[1]); s.removeAllRanges(); s.addRange(r); } catch { /* ignore */ }
    this.lastSel = [a, b];
  }

  // ------------------------------------------------------------------ edits
  snapshot() { return { content: this.getContent(), sel: this.getSel() }; }
  pushUndo(force = false, type = "") {
    const now = performance.now();
    if (!force && type === this.lastType && now - this.lastPush < 700) return;
    this.undoStack.push(this.snapshot()); if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0; this.lastPush = now; this.lastType = type;
  }
  /** Apply a function content -> content (formatting, Enter, paste ...) as one undo step and show the result. */
  edit(fn, selFn = null) {
    this.pushUndo(true, "op");
    const c = this.getContent(), [a, b] = this.getSel(), r = fn(c, a, b);
    if (!r) return;
    const content = r.content || r, sel = r.sel || (selFn ? selFn(a, b) : [a, b]);
    this.setContent(content, null, sel); this.pending = null; this.focus(); this.setSel(sel[0], sel[1]);
    this.h.onInput && this.h.onInput();
  }
  insert(str) {
    str = String(str).replace(/\r\n?/g, "\n"); if (!str) return;
    this.edit((c, a, b) => ({ content: RT.replaceRange(c, a, b, str, this.pendingStyle(c, a)), sel: [a + str.length, a + str.length] }));
  }
  pendingStyle(c, a) {
    const st = a > 0 ? RT.styleOfChar(c, a - 1) : {}, p = this.pending;
    if (!p) return st;
    const o = { ...st };
    for (const k of ["b", "i", "u"]) if (k in p) { if (p[k]) o[k] = 1; else delete o[k]; }
    if ("z" in p) { if (p.z === null) delete o.z; else o.z = p.z; }
    return o;
  }
  /** Bold / italic / underline: on the selection, or for the text typed next when nothing is selected. */
  toggle(key) {
    const c = this.getContent(), [a, b] = this.getSel();
    if (a === b) { const cur = this.styleNow(c, a, b)[key] === true; this.pending = { ...(this.pending || {}), [key]: !cur }; this.h.onSelection && this.h.onSelection(); return; }
    const all = RT.styleOfRange(c, a, b, this.cfg.base)[key] === true;
    this.edit((cc) => RT.applyStyle(cc, a, b, { [key]: !all }));
  }
  setSize(z) {
    const [a, b] = this.getSel();
    if (a === b) { this.pending = { ...(this.pending || {}), z }; this.h.onSelection && this.h.onSelection(); return; }
    this.edit((c) => RT.applyStyle(c, a, b, { z }));
  }
  setList(type) { this.edit((c, a, b) => RT.toggleList(c, a, b, type)); }
  /** Style at the caret / of the selection, including what is waiting to be typed. */
  styleNow(c = this.getContent(), a, b) {
    if (a === undefined) [a, b] = this.getSel();
    const st = RT.styleOfRange(c, a, b, this.cfg.base);
    if (a === b && this.pending) for (const k of ["b", "i", "u"]) if (k in this.pending) st[k] = this.pending[k];
    if (a === b && this.pending && "z" in this.pending) st.z = this.pending.z ?? this.cfg.base;
    const p = RT.paragraphIndexAt(c.text, a); st.list = RT.listAt(c, p);
    return st;
  }
  undo() { this.step(this.undoStack, this.redoStack); }
  redo() { this.step(this.redoStack, this.undoStack); }
  step(from, to) {
    if (!from.length) return;
    to.push(this.snapshot()); const s = from.pop();
    this.setContent(s.content, null, s.sel); this.pending = null; this.lastType = "";
    this.h.onInput && this.h.onInput();
  }

  // ----------------------------------------------------------------- events
  beforeInput(e) {
    if (e.inputType === "historyUndo") { e.preventDefault(); this.undo(); return; }
    if (e.inputType === "historyRedo") { e.preventDefault(); this.redo(); return; }
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") { e.preventDefault(); this.enter(); return; }
    if (!this.composing) { const t = e.inputType.startsWith("delete") ? "del" : e.inputType; this.pushUndo(false, t); }
  }
  afterInput(e) {
    if (this.composing && e.isComposing !== false) { this.h.onInput && this.h.onInput(); return; }
    let sel = null;
    const typed = e && e.inputType === "insertText" && this.pending && e.data;
    if (typed || !this.canonical()) {
      let c = this.getContent(); sel = this.getSel();
      if (typed) { const n = e.data.length, a = Math.max(0, sel[0] - n); c = RT.applyStyle(c, a, sel[0], this.stPatch(c, a)); this.pending = null; }
      this.setContent(c, null, sel); this.focus(); this.setSel(sel[0], sel[1]);
    } else this.restyleNew();
    this.h.onInput && this.h.onInput();
  }
  restyleNew() {                                      // text typed into an unstyled place gets sizes too (new spans / paragraphs the browser made)
    const { base, s, ruled, pitch, fmt, indent } = this.cfg;
    for (const p of this.el.children) {
      if (fmt ? p.dir !== fmt.dir : p.dir !== "auto") p.dir = fmt ? fmt.dir : "auto";
      const pad = p.dataset.l ? indent * s + "px" : ""; if (p.style.paddingInlineStart !== pad) p.style.paddingInlineStart = pad;
      for (const sp of p.querySelectorAll("span")) if (!sp.style.fontSize) { const z = sp.dataset.z ? +sp.dataset.z : base; sp.style.fontSize = z * s + "px"; sp.style.lineHeight = (ruled ? ruledLH(z, pitch) : z * 1.25) * s + "px"; }
    }
  }
  stPatch(c, a) {                                      // style to give to the text just typed at [a, ...)
    const p = this.pending, patch = {};
    for (const k of ["b", "i", "u"]) if (k in p) patch[k] = !!p[k]; else patch[k] = !!(RT.styleOfChar(c, Math.max(0, a - 1))[k]);
    if ("z" in p) patch.z = p.z;
    return patch;
  }
  enter() {
    const c = this.getContent(), [a, b] = this.getSel(), pi = RT.paragraphIndexAt(c.text, a), pr = RT.paragraphRanges(c.text)[pi];
    if (a === b && RT.listAt(c, pi) && pr.start === pr.end) { this.edit((cc) => { const l = (cc.lists || []).slice(); l[pi] = ""; return RT.makeContent(cc.text, cc.runs, l); }); return; }   // Enter on an empty list item ends the list
    this.insert("\n");
  }
  keyDown(e) {
    if (this.h.onKey && this.h.onKey(e)) return;
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase(), code = e.code || "";
    if (mod && !e.altKey) {
      if (!e.shiftKey && (k === "b" || code === "KeyB")) { e.preventDefault(); this.toggle("b"); return; }
      if (!e.shiftKey && (k === "i" || code === "KeyI")) { e.preventDefault(); this.toggle("i"); return; }
      if (!e.shiftKey && (k === "u" || code === "KeyU")) { e.preventDefault(); this.toggle("u"); return; }
      if (code === "KeyZ") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (code === "KeyY") { e.preventDefault(); this.redo(); return; }
      if (e.shiftKey && (code === "Digit7" || code === "Numpad7")) { e.preventDefault(); this.setList("n"); return; }
      if (e.shiftKey && (code === "Digit8" || code === "Numpad8")) { e.preventDefault(); this.setList("b"); return; }
    }
    if (e.key === "Backspace" && !mod) {                // Backspace at the start of a list item removes the list first (like a word processor)
      const c = this.getContent(), [a, b] = this.getSel(), pi = RT.paragraphIndexAt(c.text, a);
      if (a === b && RT.listAt(c, pi) && RT.paragraphRanges(c.text)[pi].start === a) { e.preventDefault(); this.edit((cc) => { const l = (cc.lists || []).slice(); l[pi] = ""; return RT.makeContent(cc.text, cc.runs, l); }); }
    }
  }
}
