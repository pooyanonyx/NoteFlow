// Rebuilds precache.json (the list of files the service worker stores for offline use) from the files on disk.
// `node tools/gen-precache.mjs` writes it; `--check` only verifies it (used by the tests and CI).
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(fileURLToPath(import.meta.url), "..", "..");
const SKIP = new Set(["node_modules", ".git", "tests", "tools", ".github", "__pycache__"]);
const ROOT_FILES = new Set(["index.html", "manifest.webmanifest"]);
function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}
const files = walk(root).filter((f) => f.includes("/") || ROOT_FILES.has(f));
const list = ["./", ...files.filter((f) => f !== "index.html" || true)].filter((f, i, a) => a.indexOf(f) === i);
const text = "[\n" + list.map((f) => JSON.stringify(f)).join(",\n") + "\n]\n";
if (process.argv.includes("--check")) {
  const cur = JSON.parse(readFileSync(join(root, "precache.json"), "utf8"));
  const missing = list.filter((f) => !cur.includes(f)), stale = cur.filter((f) => !list.includes(f));
  if (missing.length || stale.length) { console.error("precache.json is out of date.\n missing: " + missing.join(", ") + "\n stale: " + stale.join(", ") + "\nRun: node tools/gen-precache.mjs"); process.exit(1); }
  console.log("precache.json is up to date (" + cur.length + " entries)");
} else { writeFileSync(join(root, "precache.json"), text); console.log("wrote precache.json (" + list.length + " entries)"); }
