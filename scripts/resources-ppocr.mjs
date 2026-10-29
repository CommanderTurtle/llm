// Explicit maintenance import from a built ppocr-wasm dist; never run by the app.
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 3) throw new Error("Usage: bun scripts/resources-ppocr.mjs /path/to/ppocr-wasm/dist");
const source = resolve(process.argv[2]);
const destination = fileURLToPath(new URL("../resources/ppocr/", import.meta.url));
const build = JSON.parse(await readFile(resolve(source, "build.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const files = ["ppocr.js", "ppocr.d.ts", "build.json", "models.json", "LICENSE", "README.md", "RESEARCH.md"];
async function collect(directory) {
  for (const entry of await readdir(resolve(source, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(relative);
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Not a regular bundled asset: ${relative}`);
  }
}
for (const directory of ["assets", "models", "runtime", "credits"]) await collect(directory);
const manifest = { source: "ppocr-wasm@0.1.0", ...build, files: {} };
for (const relative of files.sort()) {
  const target = resolve(destination, relative);
  if (!target.startsWith(`${resolve(destination)}${sep}`)) throw new Error(`Asset path escaped the target: ${relative}`);
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(resolve(source, relative), target);
  const bytes = await readFile(target);
  manifest.files[relative] = { bytes: bytes.length, sha256: sha256(bytes) };
}
await writeFile(resolve(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Bundled ${files.length} pinned assets (${Object.values(manifest.files).reduce((sum, file) => sum + file.bytes, 0)} bytes).`);
