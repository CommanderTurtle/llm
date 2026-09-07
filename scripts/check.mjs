import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = await Bun.build({
  entrypoints: [resolve(root, "src/app.js")],
  target: "browser",
  write: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("The browser module graph did not build.");
}

const html = await Bun.file(resolve(root, "index.html")).text();
const app = await Bun.file(resolve(root, "src/app.js")).text();
const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(htmlIds).size, htmlIds.length, "index.html contains duplicate ids");
for (const selector of app.matchAll(/querySelector\("#([A-Za-z0-9_-]+)"\)/g)) {
  assert.ok(htmlIds.includes(selector[1]), `src/app.js expects missing #${selector[1]}`);
}

function tagForId(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<[^>]+\\bid="${escaped}"[^>]*>`, "i"))?.[0] ?? "";
}

for (const id of [
  "feature-stream-recovery", "feature-auto-max-tokens", "feature-rich-markdown", "feature-parallel-sessions",
  "feature-markdown-actions", "feature-vision-retry", "feature-stable-scroll", "feature-context-meter",
  "feature-compaction", "read-tools-enabled", "write-tools-enabled", "todo-tools-enabled", "feature-undo-delete",
]) assert.doesNotMatch(tagForId(id), /\bchecked\b/i, `#${id} must default off`);
for (const id of ["copy-markdown", "share-markdown", "undo", "open-workspace", "context-meter", "context-window"]) {
  assert.match(tagForId(id), /\bhidden\b/i, `#${id} must remain hidden in the all-disabled baseline`);
}
assert.match(tagForId("max-tokens"), /\bvalue="8192"/i, "baseline max_tokens must remain 8192");

for (const relative of [
  "vendor/anydoc/anydoc_wasm.js",
  "vendor/anydoc/anydoc_wasm_bg.wasm",
  "vendor/jszip/jszip.min.js",
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js",
  "vendor/tesseract/core/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "vendor/tesseract/lang/eng.traineddata.gz",
  "vendor/markdown/highlight.min.js",
  "vendor/markdown/github-dark.min.css",
  "vendor/markdown/highlightjs-LICENSE",
  "vendor/markdown/mermaid.min.js",
  "vendor/markdown/mermaid-LICENSE",
  "vendor/markdown/temml.min.mjs",
  "vendor/markdown/temml-LICENSE",
  "src/lnkr/LICENSE-ha.nr",
  "src/lnkr/vendor/pako.esm.min.js",
  "src/lnkr/vendor/pako-LICENSE",
]) assert.ok(existsSync(resolve(root, relative)), `missing browser asset: ${relative}`);

const anydoc = await import(new URL("../vendor/anydoc/anydoc_wasm.js", import.meta.url));
const wasmBytes = await Bun.file(resolve(root, "vendor/anydoc/anydoc_wasm_bg.wasm")).arrayBuffer();
await anydoc.default({ module_or_path: wasmBytes });
const rtf = new TextEncoder().encode("{\\rtf1\\ansi AnyDoc browser fixture\\par}");
assert.equal(anydoc.formatFromPath("fixture.rtf"), "rtf");
assert.match(anydoc.toMarkdownBytes(rtf, "rtf"), /AnyDoc browser fixture/);

console.log(`Static module graph: ${result.outputs.length} output${result.outputs.length === 1 ? "" : "s"} verified in memory.`);
console.log(`DOM contract: ${htmlIds.length} unique ids verified.`);
console.log("Feature baseline: all enhancements default off and baseline controls remain intact.");
console.log("Vendored AnyDoc WASM: initialized and converted an in-memory RTF document.");
