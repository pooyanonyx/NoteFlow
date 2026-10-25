// Deterministic text measuring for tests that run without a browser: every character is half the font size wide (bold: 10 % wider).
import * as R from "../../js/render.js";
const size = (f) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
export function useStubMeasure() {
  R.setMeasureProvider({ width: (f, s) => s.length * size(f) * 0.5 * (f.includes("bold") ? 1.1 : 1), metrics: (f) => ({ asc: size(f) * 0.9, desc: size(f) * 0.3 }) });
  return R;
}
export const text = (o = {}) => ({ t: "text", x: 20, y: 44, w: 200, text: "", color: "#000000", size: 16, ...o });
