// Notebook paper: the kinds of paper, their per-page settings (line spacing, margin, direction ...), their geometry and how they are drawn.
// Pure (no DOM except the canvas context that is passed in), so it is also used by the PDF export and the unit tests.
//
// A notebook page is {paper, items, ...settings}. The settings are all optional; a page without them looks exactly like it always did
// (lined paper: 24 pt rules, red margin 62 pt from the left edge). Only settings the user has changed are stored in the file.
export const FONT_STACK = 'Vazirmatn, "Segoe UI", Roboto, "Noto Sans", "Noto Naskh Arabic", Tahoma, sans-serif';
export const RULE_TOP = 72.0, RULE_PITCH = 24.0, RULE_BOTTOM = 30.0;      // lined paper: rule k is at y = RULE_TOP + k * pitch
export const PAPERS = ["blank", "lined", "grid", "dotted", "weekly", "cornell"];
export const PAPER_NAMES = { blank: "Blank", lined: "Lined", grid: "Grid", dotted: "Dotted", weekly: "Weekly planner", cornell: "Cornell notes" };
export const RULED_PAPERS = ["lined", "cornell"];                         // papers whose printed rules text can snap to
export const SPACING = { lined: { def: 24, min: 16, max: 48 }, cornell: { def: 24, min: 16, max: 48 }, grid: { def: 20, min: 10, max: 40 },
  dotted: { def: 20, min: 10, max: 40 }, weekly: { def: 24, min: 16, max: 40 }, blank: null };
export const MARGIN_X = { def: 62, min: 30, max: 160 }, CUE = { def: 150, min: 80, max: 240 }, SUMMARY = { def: 130, min: 60, max: 260 };
export const MARGINS = ["left", "right", "none"], DIRS = ["ltr", "rtl"], WEEK_STARTS = ["mon", "sun", "sat"];
export const FLOW_TOP_FREE = 40, FLOW_BOTTOM_FREE = 36;                   // text on paper without rules flows within these page margins
export const PAGE_PROPS = ["spacing", "margin", "margin_x", "dir", "cue", "summary", "week_start"];

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
/** Valid optional settings of a page object (others are dropped). */
export function sanitizePaperProps(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  const num = (v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) ? Number(v) : null;
  const sp = num(p.spacing); if (sp !== null) out.spacing = clampInt(sp, 8, 60);
  if (MARGINS.includes(p.margin)) out.margin = p.margin;
  const mx = num(p.margin_x); if (mx !== null) out.margin_x = clampInt(mx, MARGIN_X.min, MARGIN_X.max);
  if (DIRS.includes(p.dir)) out.dir = p.dir;
  const cue = num(p.cue); if (cue !== null) out.cue = clampInt(cue, CUE.min, CUE.max);
  const sm = num(p.summary); if (sm !== null) out.summary = clampInt(sm, SUMMARY.min, SUMMARY.max);
  if (WEEK_STARTS.includes(p.week_start)) out.week_start = p.week_start;
  return out;
}
/** The complete, normalised look of a page (every default filled in). Accepts a page object, a paper name or nothing. */
export function paperSpec(page) {
  const p = typeof page === "string" ? { paper: page } : (page || {});
  const paper = PAPERS.includes(p.paper) ? p.paper : "blank", s = sanitizePaperProps(p), sr = SPACING[paper];
  const dir = s.dir || "ltr";
  return { paper, dir,
    spacing: sr ? clampInt(s.spacing ?? sr.def, sr.min, sr.max) : RULE_PITCH,
    margin: s.margin || (dir === "rtl" ? "right" : "left"),
    margin_x: s.margin_x ?? MARGIN_X.def, cue: s.cue ?? CUE.def, summary: s.summary ?? SUMMARY.def,
    week_start: s.week_start || (dir === "rtl" ? "sat" : "mon") };
}
/** Where things are on a page of size w x h: rules, margin, the area text should stay in, and where text flows on to the next page. */
export function geometry(spec, w = 595, h = 842) {
  spec = typeof spec === "object" && spec.spacing !== undefined && spec.cue !== undefined ? spec : paperSpec(spec);
  const { paper, spacing: pitch, margin_x: mx } = spec, ruled = RULED_PAPERS.includes(paper);
  const side = paper === "cornell" && spec.margin === "none" ? (spec.dir === "rtl" ? "right" : "left") : spec.margin;
  const limit = paper === "cornell" ? h - spec.summary - 6 : h - RULE_BOTTOM;
  const lastRule = ruled ? RULE_TOP + pitch * (Math.ceil((limit - RULE_TOP) / pitch - 1e-9) - 1) : null;
  let x0 = 12, x1 = w - 12;
  if (paper === "lined" && side === "left") x0 = mx + 6;
  else if (paper === "lined" && side === "right") x1 = w - mx - 6;
  else if (paper === "cornell") { if (side === "left") x0 = spec.cue + 8; else x1 = w - spec.cue - 8; }
  const flow = paper === "weekly" ? null : { top: ruled ? RULE_TOP - pitch : FLOW_TOP_FREE, bottom: ruled ? lastRule : h - FLOW_BOTTOM_FREE };
  return { paper, ruled, pitch, top: RULE_TOP, lastRule, limit, side, mx, x0, x1, flow, w, h };
}
/** Same family of rule-based papers: line spacing and ruled text can be kept when switching between them. */
export const sameRuledFamily = (a, b) => RULED_PAPERS.includes(a) && RULED_PAPERS.includes(b);

// ------------------------------------------------------------------- drawing
const DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_FA = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"];
export function weekDays(spec) {
  const names = spec.dir === "rtl" ? DAYS_FA : DAYS_EN, first = { mon: 0, sun: 6, sat: 5 }[spec.week_start] ?? 0;
  return Array.from({ length: 7 }, (_, i) => names[(first + i) % 7]);
}
export function drawPaper(ctx, w, h, kind) {
  const spec = paperSpec(kind), g = geometry(spec, w, h), rtl = spec.dir === "rtl";
  ctx.save();
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const hline = (y, x0, x1) => { ctx.moveTo(x0, y); ctx.lineTo(x1, y); };
  if (spec.paper === "lined") {
    ctx.strokeStyle = "#b9d3ee"; ctx.lineWidth = 0.6; ctx.beginPath();
    for (let y = RULE_TOP; y < g.limit; y += g.pitch) hline(y, 0, w);
    ctx.stroke();
    if (g.side !== "none") { const x = g.side === "right" ? w - g.mx : g.mx; ctx.strokeStyle = "#eba3a3"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  } else if (spec.paper === "grid") {
    const s = spec.spacing;
    ctx.strokeStyle = "#cdd6e2"; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let x = s; x < w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = s; y < h; y += s) hline(y, 0, w);
    ctx.stroke();
  } else if (spec.paper === "dotted") {
    const s = spec.spacing;
    ctx.fillStyle = "#98a4b6"; ctx.beginPath();
    for (let y = s; y < h; y += s) for (let x = s; x < w; x += s) { ctx.moveTo(x + 1.05, y); ctx.arc(x, y, 1.05, 0, Math.PI * 2); }
    ctx.fill();
  } else if (spec.paper === "cornell") {
    const cx = g.side === "right" ? w - spec.cue : spec.cue, sy = h - spec.summary;
    ctx.strokeStyle = "#b9d3ee"; ctx.lineWidth = 0.6; ctx.beginPath();
    for (let y = RULE_TOP; y < g.limit; y += g.pitch) hline(y, g.side === "right" ? 0 : cx, g.side === "right" ? cx : w);
    ctx.stroke();
    ctx.strokeStyle = "#b4bcc8"; ctx.lineWidth = 0.8; ctx.beginPath(); hline(56, 0, w); hline(sy, 0, w); ctx.stroke();
    ctx.strokeStyle = "#eba3a3"; ctx.beginPath(); ctx.moveTo(cx, 56); ctx.lineTo(cx, sy); ctx.stroke();
  } else if (spec.paper === "weekly") {
    const X0 = 28, X1 = w - 28, top = 78, bottom = h - 32, cw = (X1 - X0) / 2, ch = (bottom - top) / 4, days = weekDays(spec);
    ctx.font = `600 11px ${FONT_STACK}`; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#6b7280"; ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left"; ctx.fillText(rtl ? "هفته" : "Week of", rtl ? X1 : X0, 56);
    ctx.strokeStyle = "#b4bcc8"; ctx.lineWidth = 0.8; ctx.beginPath(); hline(60, rtl ? X0 : X0 + 52, rtl ? X1 - 40 : X1); ctx.stroke();
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 8; k++) {
      const row = k >> 1, col = rtl ? 1 - (k & 1) : k & 1, x = X0 + col * cw, y = top + row * ch;
      ctx.strokeStyle = "#b4bcc8"; ctx.strokeRect(x, y, cw, ch);
      ctx.fillStyle = k < 7 ? "#4b5563" : "#6b7280"; ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(k < 7 ? days[k] : (rtl ? "یادداشت" : "Notes"), rtl ? x + cw - 8 : x + 8, y + 15);
      ctx.strokeStyle = "#d3e0ee"; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let yy = y + 24 + spec.spacing - 8; yy < y + ch - 4; yy += spec.spacing) hline(yy, x + 6, x + cw - 6);
      ctx.stroke(); ctx.lineWidth = 0.8;
    }
    ctx.direction = "ltr"; ctx.textAlign = "left";
  }
  ctx.strokeStyle = "#8a8f98"; ctx.lineWidth = 0.8;
  ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}
