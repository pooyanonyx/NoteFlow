import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs"; import { join, dirname, resolve } from "node:path"; import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, "../..");
const jsFiles = readdirSync(join(root, "js")).filter((f) => f.endsWith(".js"));

test("the offline file list (precache.json) matches the files on disk", () => {
  execFileSync(process.execPath, [join(root, "tools/gen-precache.mjs"), "--check"], { stdio: "pipe" });
});
test("every relative import of every module resolves to a file", () => {
  for (const f of jsFiles) {
    const src = readFileSync(join(root, "js", f), "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.\/[^"']+)["']/g)) assert.ok(existsSync(join(root, "js", m[1])), `${f} imports missing ${m[1]}`);
  }
});
test("every module is syntactically valid", () => {
  for (const f of jsFiles) execFileSync(process.execPath, ["--check", join(root, "js", f)], { stdio: "pipe" });
});
test("the service worker has a cache version and the page loads the app module", () => {
  assert.match(readFileSync(join(root, "sw.js"), "utf8"), /const CACHE = "noteflow-v\d+"/);
  assert.match(readFileSync(join(root, "index.html"), "utf8"), /js\/app\.js/);
});
test("pure modules do not need a browser (they load under Node)", async () => {
  for (const f of ["paper", "richtext", "bidi", "flow", "tools", "model", "render"]) await import(join(root, "js", f + ".js"));
});
