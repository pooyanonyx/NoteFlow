// Errors that nobody caught, kept in a small log in memory (never sent anywhere: NoteFlow makes no network requests of its own) so a user can copy it into a bug report.
// The app shows ONE short notice per burst of errors, saying whether the work is safe, instead of failing silently.

const MAX = 60, log = [];
let sink = null, lastNotice = 0;

// browser noise that is not a fault of the app and that a user cannot act on
const IGNORED = [/ResizeObserver loop/i, /Script error\.?$/i, /^Non-Error promise rejection/i, /extension:\/\//i];

export function record(kind, err, extra) {
  const msg = String((err && (err.stack || err.message)) || err || "unknown error").slice(0, 1200);
  if (IGNORED.some((r) => r.test(msg))) return null;
  const entry = { t: new Date().toISOString(), kind, msg, ...(extra || {}) };
  log.push(entry); if (log.length > MAX) log.shift();
  return entry;
}

export const entries = () => log.slice();
export const clear = () => { log.length = 0; };

/** Install the global hooks. onNotice(entry) is called at most once per `quietMs` (a failing render loop must not bury the screen in notices). */
export function install(onNotice, { quietMs = 20000, target = window } = {}) {
  sink = onNotice;
  const note = (e) => { if (!e) return; const now = Date.now(); if (sink && now - lastNotice > quietMs) { lastNotice = now; try { sink(e); } catch { /* a failing notice must not raise another one */ } } };
  target.addEventListener("error", (ev) => note(record("error", ev.error || ev.message, { src: ev.filename ? String(ev.filename).split("/").pop() + ":" + ev.lineno : undefined })));
  target.addEventListener("unhandledrejection", (ev) => note(record("promise", ev.reason)));
  return () => { sink = null; };
}
export const resetNoticeClock = () => { lastNotice = 0; };

/** The text a user can paste into a bug report. */
export function report(extra = {}) {
  const head = [`NoteFlow diagnostics ${new Date().toISOString()}`, typeof navigator !== "undefined" ? navigator.userAgent : "", ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`)];
  return head.join("\n") + "\n\n" + (log.length ? log.map((e) => `[${e.t}] ${e.kind}${e.src ? " " + e.src : ""}\n${e.msg}`).join("\n\n") : "No errors recorded in this session.");
}
