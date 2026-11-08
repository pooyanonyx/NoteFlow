// Smart linking's text matching, in a Web Worker when the browser has one (and on the main thread otherwise, so it always works).
// The worker is created on the first scan and ended after a quiet spell, so it costs nothing while Smart linking is not in use.
import { passagesOf, findMatches } from "./similar.js";

const IDLE_MS = 20000, TIMEOUT_MS = 10000;
let worker = null, idleTimer = 0, seq = 0, broken = false;
const pending = new Map();

function stop() { clearTimeout(idleTimer); idleTimer = 0; if (worker) { worker.terminate(); worker = null; } for (const [, p] of pending) p.reject(new Error("worker stopped")); pending.clear(); }
function start() {
  if (worker) return worker;
  if (broken || typeof Worker !== "function") return null;
  try {
    worker = new Worker(new URL("./similar.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); clearTimeout(p.timer); e.data.ok ? p.resolve(e.data.res) : p.reject(new Error(e.data.error)); };
    worker.onerror = () => { broken = true; stop(); };                               // (a browser that cannot run it: this and later scans use the main thread)
  } catch { broken = true; worker = null; }
  return worker;
}
const plain = (u, i) => ({ _i: i, s: u.s, e: u.e, toks: u.toks, nums: u.nums, parts: u.parts });          // (only what the matching needs: items and panels cannot be cloned)

/** Match the units of notes (A) against a PDF page's text ({ text }) or against other units ({ units }). Results refer to the objects passed in. */
export async function matchTexts(A, target, floor) {
  const bUnits = target.units || null;
  const msg = { A: A.map(plain), B: bUnits ? bUnits.map(plain) : null, text: target.text, floor };
  const w = start();
  if (w) {
    try {
      const res = await new Promise((resolve, reject) => {
        const id = ++seq, timer = setTimeout(() => { pending.delete(id); broken = true; stop(); reject(new Error("worker timed out")); }, TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer }); w.postMessage({ ...msg, id });
      });
      clearTimeout(idleTimer); idleTimer = setTimeout(stop, IDLE_MS);
      return res.map((r) => ({ ...r, note: A[r.note._i], passage: bUnits ? { ...bUnits[r.passage._i], ...r.passage } : r.passage }));
    } catch (e) { if (!/stopped/.test(String(e.message))) console.warn("Smart linking worker failed, using the main thread:", e.message); }
  }
  const units = bUnits || passagesOf(target.text);
  return findMatches(A, units, { floor });
}
export const workerActive = () => !!worker;
export const stopMatcher = stop;
