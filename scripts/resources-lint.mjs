import { mkdir, copyFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

// Build-time only: the deployed application loads exclusively same-origin assets.
const root = resolve(import.meta.dir, "..");
const packages = [
  ["web-tree-sitter", "0.25.10", "runtime"],
  ["tree-sitter-wasms", "0.1.13", "grammars"],
  ["tree-sitter-fsharp", "0.3.12", "fsharp"],
  ["@tree-sitter-grammars/tree-sitter-yaml", "0.7.1", "yaml"],
];
const destination = resolve(root, "resources/lint");
await mkdir(destination, { recursive: true });
for (const [name, version, kind] of packages) {
  const directory = resolve(root, ".tmp/lint-resources", `${kind}-${version}`);
  await mkdir(directory, { recursive: true });
  const metadata = await fetch(`https://registry.npmjs.org/${name}/${version}`).then((r) => r.json());
  const bytes = await fetch(metadata.dist.tarball).then((r) => r.arrayBuffer());
  const hash = new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
  if (metadata.dist.integrity !== `sha512-${hash}`) throw new Error(`Integrity mismatch: ${name}`);
  const archive = resolve(directory, "package.tgz");
  await Bun.write(archive, bytes);
  const extraction = Bun.spawnSync(["tar", "-xf", archive, "-C", directory]);
  if (extraction.exitCode) throw new Error(`Cannot extract ${name}`);
  const source = resolve(directory, "package");
  const files = kind === "runtime" ? ["tree-sitter.js", "tree-sitter.wasm"]
    : kind === "fsharp" ? ["tree-sitter-fsharp.wasm", "tree-sitter-fsharp_signature.wasm"]
    : kind === "yaml" ? ["tree-sitter-yaml.wasm"]
    : (await readdir(resolve(source, "out"))).filter((file) => file.endsWith(".wasm") && !["tree-sitter-elm.wasm", "tree-sitter-ql.wasm", "tree-sitter-yaml.wasm"].includes(file)).map((file) => `out/${file}`);
  for (const file of files) await copyFile(resolve(source, file), resolve(destination, kind === "runtime" ? `web-${file}` : file.split("/").at(-1)));
  console.log(`${name}@${version}: ${files.length} browser assets`);
}
