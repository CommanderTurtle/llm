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

for (const relative of [
  "resources/anydoc/anydoc_wasm.js",
  "resources/anydoc/anydoc_wasm_bg.wasm",
  "resources/jszip/jszip.min.js",
  "resources/tesseract/tesseract.min.js",
  "resources/tesseract/worker.min.js",
  "resources/tesseract/core/tesseract-core-lstm.wasm.js",
  "resources/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "resources/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "resources/tesseract/lang/eng.traineddata.gz",
  "resources/markdown/highlight.min.js",
  "resources/markdown/github-dark.min.css",
  "resources/markdown/highlightjs-NOTICE.txt",
  "resources/markdown/mermaid.min.js",
  "resources/markdown/mermaid-NOTICE.txt",
  "resources/markdown/temml.min.mjs",
  "resources/markdown/temml-NOTICE.txt",
  "src/lnkr/p2r3-NOTICE.txt",
  "src/lnkr/resources/pako.esm.min.js",
  "src/lnkr/resources/pako-NOTICE.txt",
]) if (!existsSync(resolve(root, relative))) throw new Error(`missing browser asset: ${relative}`);

const ppocrManifest = await Bun.file(resolve(root, "resources/ppocr/manifest.json")).json();
const ppocrAssets = Object.keys(ppocrManifest.files).filter((name) => /\.(?:js|mjs|wasm|tar|json)$/i.test(name));
for (const relative of ppocrAssets) {
  if (!existsSync(resolve(root, "resources/ppocr", relative))) throw new Error(`missing PPOCR asset: ${relative}`);
}

const anydoc = await import(new URL("../resources/anydoc/anydoc_wasm.js", import.meta.url));
const wasmBytes = await Bun.file(resolve(root, "resources/anydoc/anydoc_wasm_bg.wasm")).arrayBuffer();
await anydoc.default({ module_or_path: wasmBytes });
const rtf = new TextEncoder().encode("{\\rtf1\\ansi AnyDoc browser fixture\\par}");
if (anydoc.formatFromPath("fixture.rtf") !== "rtf") throw new Error("AnyDoc did not detect the RTF fixture.");
if (!/AnyDoc browser fixture/.test(anydoc.toMarkdownBytes(rtf, "rtf"))) throw new Error("AnyDoc did not convert the RTF fixture.");

console.log(`Static module graph: ${result.outputs.length} output${result.outputs.length === 1 ? "" : "s"} verified in memory.`);
console.log("Required local assets: every browser asset and PPOCR manifest entry is present.");
console.log("AnyDoc WASM: initialized and converted an in-memory RTF document.");
