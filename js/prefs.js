// Application preferences (how NoteFlow looks and behaves on THIS device). They are not part of a workspace file: a workspace is shared between people and devices,
// a preference such as the colour theme belongs to the person using the app. Stored in localStorage; every read is validated, so a damaged value falls back to the default.

const KEY = "noteflow.prefs.v1";

export const DEFAULTS = Object.freeze({
  theme: "system",          // "system" | "light" | "dark": the colours of the application (paper keeps its own colour)
  motion: "system",         // "system" | "reduce": animations of the interface
  pressure: true,           // pen pressure changes the width of a stroke (when the stylus reports it)
  autoSave: true,           // back up every change on this device automatically (Ctrl+S always backs up right away, with or without this)
  memorySaver: false,       // smaller page cache and lower rendering resolution: for modest hardware
});

const CHECK = {
  theme: (v) => ["system", "light", "dark"].includes(v),
  motion: (v) => ["system", "reduce"].includes(v),
  pressure: (v) => typeof v === "boolean",
  autoSave: (v) => typeof v === "boolean",
  memorySaver: (v) => typeof v === "boolean",
};

let cache = null; const listeners = new Set();
const read = () => {
  const out = { ...DEFAULTS };
  try {
    const raw = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(KEY) || "{}") : {};
    if (raw && typeof raw === "object") for (const k of Object.keys(DEFAULTS)) if (k in raw && CHECK[k](raw[k])) out[k] = raw[k];
  } catch { /* unreadable: defaults */ }
  return out;
};

export const prefs = {
  all() { return (cache = cache || read()); },
  get(k) { return this.all()[k]; },
  set(k, v) {
    if (!(k in DEFAULTS) || !CHECK[k](v)) return false;
    const was = this.all()[k]; if (was === v) return true;
    cache = { ...this.all(), [k]: v };
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage full or blocked: the choice still applies in this session */ }
    for (const fn of [...listeners]) { try { fn(k, v, was); } catch (e) { console.warn("preference listener failed", e); } }
    return true;
  },
  reset() { for (const k of Object.keys(DEFAULTS)) this.set(k, DEFAULTS[k]); },
  /** fn(key, value, previous) after every change. Returns the function that removes the listener. */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  isDefault() { const a = this.all(); return Object.keys(DEFAULTS).every((k) => a[k] === DEFAULTS[k]); },
  _reload() { cache = null; },
};
