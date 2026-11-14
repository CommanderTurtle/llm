import { mkdir, writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";

const base = "https://github.com/stencil-hq/wasm-grammars/releases/download/v1/";
const additions = new Set("astro clojure cmake dockerfile erlang fortran graphql haskell hcl ini julia just make nix odin powershell protobuf r sql starlark svelte verilog xml".split(" "));
const target = new URL("../resources/lint/", import.meta.url);
async function download(name) {
  const response = await fetch(new URL(name, base));
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const bytes = await download("manifest.json");
const manifest = JSON.parse(bytes);
await mkdir(target, { recursive: true });
for (const grammar of manifest.grammars.filter((entry) => additions.has(entry.language))) {
  const wasm = zstdDecompressSync(await download(`${grammar.file}.zst`));
  await writeFile(new URL(`tree-sitter-${grammar.language}.wasm`, target), wasm);
  console.log(`${grammar.language}: ${wasm.length} bytes`);
}
await writeFile(new URL("stencil-manifest.json", target), bytes);
