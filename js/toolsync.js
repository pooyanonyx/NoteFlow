// "Sync Tools Across Panels" (Settings > Advanced, on by default). While it is on, every panel uses the same active tool and the same settings for every tool: choosing the
// Marker and a thickness of 15 in the PDF panel gives every other panel the Marker with thickness 15.
//
// How: nothing is shared by reference and nothing is read "through" another panel, so a panel always owns a complete, ordinary tool state (and with the setting off it simply goes
// on as before). Whenever a panel's tool state may have changed it calls ToolSync.changed(panel). The sync compares the panel with what it was at the previous call, and copies
// only the parts that really changed (the tool, the settings of the tool group, the text format, the shape, the fill, the connector / node style, the recent colours) to the
// other panels. Because only differences travel, a panel that is merely switched to, or a stale copy, can never overwrite settings: nothing happens unless the user changed something.
// ToolSync.adopt(panel) makes every panel equal to one (when the setting is turned on, and after a workspace is opened).
import * as T from "./tools.js";
import { prefs } from "./prefs.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const SYNC_KEYS = ["tool", "groups", "textStyle", "shapeKind", "fill", "connStyle", "connArrow", "nodeKind", "recent"];

/** The tool state of a panel as plain data. On a blackboard the default ink is drawn white; it is written back as the normal default ink, so the state means the same on every panel. */
export function snapshot(p) {
  const groups = clone(p.groups);
  if (p.kind === "board" && p.boardIsDark && p.boardIsDark()) for (const g of T.LEGACY_DRAW_GROUPS) if (groups[g].color === T.INK_DARK) groups[g].color = T.INK_LIGHT;
  return { tool: p.tempPrev != null ? p.tempPrev : p.tool, groups, textStyle: clone(p.textStyle), shapeKind: p.shapeKind, fill: clone(p.fill), connStyle: p.connStyle, connArrow: p.connArrow, nodeKind: p.nodeKind, recent: [...p.recent] };
}
/** What differs between two snapshots, as a list of [key, group?]. Every group of settings is compared on its own. */
export function diff(a, b) {
  const out = [];
  for (const k of SYNC_KEYS) {
    if (k === "groups") { for (const g of T.GROUPS) if (!same(a.groups[g], b.groups[g])) out.push(["groups", g]); }
    else if (!same(a[k], b[k])) out.push([k]);
  }
  return out;
}
/** Put one part of a snapshot into a panel and bring the panel's toolbar in line. */
function put(p, snap, [key, g]) {
  switch (key) {
    case "tool": if (p.toolBtns[snap.tool] && p.tool !== snap.tool) { p.tempPrev = null; p.setTool(snap.tool); } break;           // (a panel without that tool, e.g. Highlight on a notebook, keeps its own)
    case "groups": {
      p.groups[g] = { ...snap.groups[g] };
      if (p.kind === "board" && p.boardIsDark && p.boardIsDark() && T.LEGACY_DRAW_GROUPS.includes(g) && p.groups[g].color === T.INK_LIGHT) p.groups[g].color = T.INK_DARK;      // (a blackboard draws its default ink white)
      if (p.groupKey() === g) { p.curStyle = { ...p.groups[g] }; p.updateColorDot(); }
      if (p.brushBox) p.brushBox.update(p.brushStyle(), p.tool !== "hltext");
      break;
    }
    case "textStyle": p.textStyle = { ...snap.textStyle }; p.fmtKey = ""; if (p.richEditing()) p.syncTyping(); break;
    case "shapeKind": p.shapeKind = snap.shapeKind; p.updateShapeBtn(); p.fillKey = ""; break;
    case "fill": p.fill = { ...snap.fill }; p.fillKey = ""; break;
    case "connStyle": case "connArrow": case "nodeKind": p[key] = snap[key]; p.mindKey = ""; break;
    case "recent": p.recent = [...snap.recent]; break;
    default: break;
  }
}

export class ToolSync {
  constructor(app) { this.app = app; this.last = new Map(); this.busy = 0; }
  get on() { return prefs.get("syncTools") === true; }
  panels() { return Object.values(this.app.panels || {}); }
  /** Remember how every panel is now (without copying anything). */
  rebase() { for (const p of this.panels()) this.last.set(p.key, snapshot(p)); }
  /** Run fn without any panel announcing changes (opening a workspace restores every panel in turn). */
  quietly(fn) { this.busy++; try { return fn(); } finally { this.busy--; } }
  /** A panel's tool state may have changed: copy what changed to the other panels (when the setting is on). */
  changed(p) {
    if (this.busy) return;
    const cur = snapshot(p), prev = this.last.get(p.key);
    this.last.set(p.key, cur);
    if (!prev || !this.on) return;
    const delta = diff(prev, cur);
    if (!delta.length) return;
    this.busy++;
    try {
      for (const q of this.panels()) {
        if (q === p) continue;
        for (const d of delta) put(q, cur, d);
        q.updateColorDot(); q.render(); this.last.set(q.key, snapshot(q));
      }
    } finally { this.busy--; }
  }
  /** Make every panel use the tool and the settings of panel p. */
  adopt(p) {
    if (!p) return;
    const cur = snapshot(p);
    this.quietly(() => {
      for (const q of this.panels()) {
        if (q === p) continue;
        for (const d of diff(snapshot(q), cur)) put(q, cur, d);
        q.updateColorDot(); q.render();
      }
    });
    this.rebase();
  }
}
