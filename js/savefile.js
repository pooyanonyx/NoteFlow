// Saving a workspace into a file the user chose (File System Access API: Chromium browsers), so "Save" overwrites that file instead of downloading
// a new copy every time. Everywhere else (Firefox, Safari, the Android app) the callers fall back to a download. The API is read from `window` at call time,
// so tests can put a stand-in there.

export const WORKSPACE_TYPES = [{ description: "NoteFlow workspace", accept: { "application/zip": [".nfws"] } }];

/** Can this browser save into a chosen file? (needs a secure context: https or localhost) */
export const canSaveInPlace = () => typeof window !== "undefined" && window.isSecureContext !== false && typeof window.showSaveFilePicker === "function";
export const canPickToOpen = () => typeof window !== "undefined" && window.isSecureContext !== false && typeof window.showOpenFilePicker === "function";

const isAbort = (e) => !!e && (e.name === "AbortError" || e.code === 20);
export { isAbort };

/** Ask where to save. Returns a file handle, or null when the user cancelled. */
export async function pickSaveHandle(suggestedName) {
  try { return await window.showSaveFilePicker({ suggestedName, types: WORKSPACE_TYPES, excludeAcceptAllOption: false }); }
  catch (e) { if (isAbort(e)) return null; throw e; }
}

/** Ask which workspace file to open. Returns { handle, file } or null when cancelled. */
export async function pickOpenHandle() {
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: "NoteFlow workspace", accept: { "application/zip": [".nfws", ".dnws"] } }], multiple: false });
    return { handle, file: await handle.getFile() };
  } catch (e) { if (isAbort(e)) return null; throw e; }
}

/** May we write to this handle without asking? ("granted" survives while the tab lives; after a reload the browser asks again, which needs a click.) */
export async function hasWritePermission(handle, { ask = false } = {}) {
  if (!handle || !handle.queryPermission) return true;                     // (a handle without permission methods is writable)
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return ask && handle.requestPermission ? (await handle.requestPermission(opts)) === "granted" : false;
}

/** Write the blob into the file. The browser writes to a temporary copy and replaces the file when closed, so a failure half way leaves the old file intact. */
export async function writeToHandle(handle, blob) {
  const w = await handle.createWritable();
  try { await w.write(blob); } catch (e) { try { await w.abort(); } catch { /* already closed */ } throw e; }
  await w.close();
}

/** Only a file with the current extension is overwritten in place: a workspace saved by an older version (.dnws) is never replaced by a file in the new format;
 *  saving it asks for a new name instead, and the original stays untouched. */
export const isCurrentWorkspaceName = (name) => /\.nfws$/i.test(String(name || ""));

/** A friendly file name for a new workspace. */
export const suggestName = (name) => (name && isCurrentWorkspaceName(name) ? name : String(name || "workspace").replace(/\.(dnws|nfws)$/i, "") + ".nfws");
