// EXPORT of a workspace as a file (File System Access API: Chromium browsers ask where to put it; everywhere else the caller downloads it). Saving and backing up the work
// does NOT go through here: that is the internal backup (app.js). The API is read from `window` at call time, so tests can put a stand-in there.

export const WORKSPACE_TYPES = [{ description: "NoteFlow workspace", accept: { "application/zip": [".nfws"] } }];

/** Can this browser ask where to put a file? (needs a secure context: https or localhost) */
export const canSaveInPlace = () => typeof window !== "undefined" && window.isSecureContext !== false && typeof window.showSaveFilePicker === "function";
const isAbort = (e) => !!e && (e.name === "AbortError" || e.code === 20);

/** Ask where to save. Returns a file handle, or null when the user cancelled. */
export async function pickSaveHandle(suggestedName) {
  try { return await window.showSaveFilePicker({ suggestedName, types: WORKSPACE_TYPES, excludeAcceptAllOption: false }); }
  catch (e) { if (isAbort(e)) return null; throw e; }
}

/** Write the blob into the file. The browser writes to a temporary copy and replaces the file when closed, so a failure half way leaves the old file intact. */
export async function writeToHandle(handle, blob) {
  const w = await handle.createWritable();
  try { await w.write(blob); } catch (e) { try { await w.abort(); } catch { /* already closed */ } throw e; }
  await w.close();
}

/** A friendly file name for an exported workspace (always the current extension). */
export const suggestName = (name) => String(name || "workspace").replace(/\.(dnws|nfws)$/i, "") + ".nfws";
