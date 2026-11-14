import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 3) throw Error("Usage: bun scripts/resources-speech.mjs /path/to/speakingwasm/dist");
const source = resolve(process.argv[2]);
const destination = fileURLToPath(new URL("../resources/speech/", import.meta.url));
const manifest = { source: "speakingwasm@1083a10", files: {} };
async function copy(relative, target = relative) {
  const bytes = await readFile(resolve(source, relative));
  await mkdir(dirname(resolve(destination, target)), { recursive: true });
  await cp(resolve(source, relative), resolve(destination, target));
  manifest.files[target] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function walk(directory) {
  for (const entry of await readdir(resolve(source, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.name === "models") continue;
    if (entry.isDirectory()) await walk(relative);
    else if (entry.isFile()) await copy(relative, relative.replace(/^speech\//, ""));
    else throw Error(`Not a regular speech asset: ${relative}`);
  }
}
await walk("speech");
await walk("credits");
await copy("LICENSE");
await writeFile(resolve(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Bundled ${Object.keys(manifest.files).length} speech assets; model weights remain lazy.`);
