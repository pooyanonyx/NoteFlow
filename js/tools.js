// Tool settings: ONE place that says which settings every tool starts with. The toolbar uses it when a panel is created and the
// "Reset to default" buttons use the very same table, so a reset can never drift away from the real defaults.
//
// Every tool that creates something has its OWN settings (colour, thickness, opacity, brightness, text size). Older versions shared one
// "draw" set between Pen, Text, Shapes and the mind-map tools; such workspaces are read by copying that set to each of those tools.
export const TOOL_GROUP = { pen: "pen", mark: "mark", hltext: "hltext", eraser: "eraser", text: "text", note: "note", shape: "shape", node: "mind", link: "mind" };
export const GROUPS = ["pen", "mark", "hltext", "eraser", "text", "note", "shape", "mind"];
export const GROUP_LABEL = { pen: "Pen", mark: "Marker", hltext: "Highlight", eraser: "Eraser", text: "Text", note: "Note", shape: "Shapes", mind: "Mind map" };
export const LEGACY_DRAW_GROUPS = ["pen", "text", "shape", "mind"];               // these shared the old "draw" set
export const STYLE_KEYS = ["color", "width", "size", "alpha", "bright"];
export const PDF_INK = "#d32f2f", INK_LIGHT = "#1a1a1a", INK_DARK = "#f2f2f2";

/** Default ink: red on a PDF, near-black on notebooks and whiteboards, near-white on a blackboard. */
export const inkDefault = (kind, dark = false) => (kind === "pdf" ? PDF_INK : dark ? INK_DARK : INK_LIGHT);
/** The starting settings of every tool group for a panel of this kind (pdf | nb | board). */
export function toolDefaults(kind, dark = false) {
  const ink = { color: inkDefault(kind, dark), width: 2, size: 18, alpha: 255, bright: 0 };
  return {
    pen: { ...ink }, text: { ...ink }, shape: { ...ink }, mind: { ...ink },
    mark: { color: "#fdd835", width: 14, size: 18, alpha: 110, bright: 0 },
    hltext: { color: "#fdd835", width: 14, size: 18, alpha: 100, bright: 0 },
    note: { color: "#fff59d", width: 2, size: 16, alpha: 255, bright: 0 },
    eraser: { color: "#808080", width: 20, size: 18, alpha: 255, bright: 0 },       // eraser: width = its diameter (page units)
  };
}
/** Settings of a tool that are not colour / thickness / ... : text formatting, which shape, connector style, fill on or off. */
export const EXTRAS_DEFAULT = {
  text: { b: false, i: false, u: false, list: "" },            // formatting a NEW text box starts with (bold, italic, underline, list type "" | "b" | "n")
  shape: { shapeKind: "rect", fill: false },
  mind: { connStyle: "curve", connArrow: true, nodeKind: "round", fill: false },
};
export const sameStyle = (a, b) => STYLE_KEYS.every((k) => a[k] === b[k]);
/** Tool settings from a saved workspace: the new per-tool sets, else the old shared "draw" set copied to each tool that used it. */
export function groupsFromSaved(tb, defaults, sanitize) {
  const out = {};
  for (const g of GROUPS) out[g] = { ...defaults[g] };
  if (!tb || typeof tb !== "object") return out;
  const legacy = tb.groups && typeof tb.groups === "object" ? tb.groups : {};
  const saved = tb.tools && typeof tb.tools === "object" ? tb.tools : {};
  for (const g of GROUPS) {
    const lg = LEGACY_DRAW_GROUPS.includes(g) ? legacy.draw : g === "eraser" ? legacy.erase : legacy[g];
    out[g] = sanitize(saved[g] !== undefined ? saved[g] : lg, defaults[g]);
  }
  return out;
}
/** What is written to a workspace: the per-tool sets, plus the old group names so older versions of the app still find their colours. */
export function groupsToSaved(groups) {
  return { tools: JSON.parse(JSON.stringify(groups)),
    groups: { draw: { ...groups.pen }, mark: { ...groups.mark }, hltext: { ...groups.hltext }, note: { ...groups.note }, erase: { ...groups.eraser } } };
}
/** A saved text-formatting default, cleaned up (anything unknown falls back to the default). */
export function sanitizeTextStyle(v) {
  const d = EXTRAS_DEFAULT.text, o = v && typeof v === "object" ? v : {};
  return { b: o.b === true, i: o.i === true, u: o.u === true, list: o.list === "b" || o.list === "n" ? o.list : d.list };
}
