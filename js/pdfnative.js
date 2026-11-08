// Annotated PDF export: which of the drawn items can be written as REAL PDF annotations (they stay vector, can be selected, listed and edited in other PDF viewers, and
// keep the file small), and the numbers for them. Everything else (text, shapes, mind maps, images, strokes with pen pressure) stays in the picture laid over the page, so the
// page looks exactly as in NoteFlow. Pure functions: no PDF library here, so they are tested without a browser. The editable NoteFlow data is always embedded in the file too.
import * as M from "./model.js";

const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "")); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0, 0, 0]; };

/** Is this item written as a native annotation? */
export function isNative(d) {
  if (M.itemBright(d) !== 0) return false;                                          // (brightness changes are not expressible)
  if (d.t === "pen" || d.t === "mark") return !M.hasPressure(d) && d.pts.length >= 1 && d.w > 0;
  if (d.t === "hl") return Math.abs(d.x2 - d.x1) > 0.5 && Math.abs(d.y2 - d.y1) > 0.5;
  return false;
}
/** { native, raster } in the original order. rotated: a rotated page keeps everything in the picture (the coordinates would need turning). */
export function splitNative(items, { rotated = false } = {}) {
  if (rotated) return { native: [], raster: items.slice() };
  const native = [], raster = [];
  for (const d of items) (isNative(d) ? native : raster).push(d);
  return { native, raster };
}

/** The numbers of one annotation in PDF user space. box = the page's crop box { x, y, width, height }; item coordinates are from the top left of the page. */
export function annotationSpec(d, box) {
  const X = (x) => box.x + x, Y = (y) => box.y + box.height - y, a = M.itemAlpha(d) / 255, color = hex(d.color);
  if (d.t === "hl") {
    const x0 = Math.min(d.x1, d.x2), x1 = Math.max(d.x1, d.x2), y0 = Math.min(d.y1, d.y2), y1 = Math.max(d.y1, d.y2);
    return { kind: "Highlight", color, alpha: a, rect: [X(x0), Y(y1), X(x1), Y(y0)], quad: [X(x0), Y(y0), X(x1), Y(y0), X(x0), Y(y1), X(x1), Y(y1)] };
  }
  const pts = d.pts.length === 1 ? [d.pts[0], [d.pts[0][0] + 0.01, d.pts[0][1]]] : d.pts;        // (a dot: a stroke of no length)
  const flat = pts.flatMap(([x, y]) => [X(x), Y(y)]), xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1), pad = d.w / 2 + 0.5;
  return { kind: "Ink", color, alpha: a, width: d.w, ink: flat, rect: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad] };
}

/** The appearance stream (page content) for a spec, so every viewer draws it the same way. */
export function appearanceStream(s) {
  const n = (v) => (Math.round(v * 1000) / 1000).toString(), [r, g, b] = s.color.map(n);
  if (s.kind === "Highlight") return `/GS gs ${r} ${g} ${b} rg ${n(s.rect[0])} ${n(s.rect[1])} ${n(s.rect[2] - s.rect[0])} ${n(s.rect[3] - s.rect[1])} re f`;
  let c = `/GS gs ${r} ${g} ${b} RG ${n(s.width)} w 1 J 1 j `;
  for (let i = 0; i < s.ink.length; i += 2) c += `${n(s.ink[i])} ${n(s.ink[i + 1])} ${i === 0 ? "m" : "l"} `;
  return c + "S";
}
