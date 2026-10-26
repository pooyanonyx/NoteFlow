// Deterministic text measuring for tests that run without a browser: every character is half the font size wide (bold: 10 % wider).
import * as R from "../../js/render.js";
const size = (f) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
export function useStubMeasure() {
  R.setMeasureProvider({ width: (f, s) => s.length * size(f) * 0.5 * (f.includes("bold") ? 1.1 : 1), metrics: (f) => ({ asc: size(f) * 0.9, desc: size(f) * 0.3 }) });
  return R;
}
export const text = (o = {}) => ({ t: "text", x: 20, y: 44, w: 200, text: "", color: "#000000", size: 16, ...o });
/** Like useStubMeasure, but "AV" / "VA" pairs are kerned 4 px closer (as real fonts do), so the width of a string is not the sum of its letters. */
export function useKernedMeasure() {
  R.setMeasureProvider({ width: (f, s) => { const z = size(f); let w = s.length * z * 0.5; for (let i = 0; i + 1 < s.length; i++) if ((s[i] + s[i + 1] === "AV") || (s[i] + s[i + 1] === "VA")) w -= z * 0.2; return w; }, metrics: (f) => ({ asc: size(f) * 0.9, desc: size(f) * 0.3 }) });
  return R;
}
