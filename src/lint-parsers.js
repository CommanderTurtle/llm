export const LANGUAGE_ALIASES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", py: "python", rs: "rust", rb: "ruby", sh: "bash", shell: "bash",
  "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", h: "c",
  cs: "c_sharp", csharp: "c_sharp", "c#": "c_sharp",
  fs: "fsharp", fsx: "fsharp", "f#": "fsharp", fsi: "fsharp_signature",
  yml: "yaml", kt: "kotlin", ex: "elixir", exs: "elixir", golang: "go",
  objectivec: "objc", "objective-c": "objc", ml: "ocaml", el: "elisp", sol: "solidity",
  ps1: "powershell", pwsh: "powershell", clj: "clojure", cljs: "clojure", edn: "clojure",
  erl: "erlang", hrl: "erlang", f90: "fortran", f95: "fortran", gql: "graphql", hs: "haskell",
  tf: "hcl", terraform: "hcl", jl: "julia", makefile: "make", justfile: "just",
  proto: "protobuf", rscript: "r", bzl: "starlark", sv: "verilog", systemverilog: "verilog",
};
export const PARSER_LANGUAGES = new Set([
  "bash", "c_sharp", "c", "cpp", "css", "dart", "elisp", "elixir", "embedded_template",
  "go", "html", "java", "javascript", "json", "kotlin", "lua", "objc", "ocaml", "php",
  "python", "rescript", "ruby", "rust", "scala", "solidity", "swift", "systemrdl",
  "tlaplus", "toml", "tsx", "typescript", "vue", "yaml", "zig", "fsharp", "fsharp_signature",
  "astro", "clojure", "cmake", "dockerfile", "erlang", "fortran", "graphql", "haskell", "hcl",
  "ini", "julia", "just", "make", "nix", "odin", "powershell", "protobuf", "r", "sql",
  "starlark", "svelte", "verilog", "xml",
]);
export function parserLanguage(language) {
  const key = String(language).toLowerCase();
  const name = LANGUAGE_ALIASES[key] || key;
  return PARSER_LANGUAGES.has(name) ? name : null;
}

let runtime;
const languages = new Map();
export async function parseDiagnostics(source, language) {
  const name = parserLanguage(language);
  if (!name) return { supported: false, diagnostics: [] };
  const runtimeUrl = new URL("../resources/lint/web-tree-sitter.js", import.meta.url).href;
  const { Parser, Language } = await import(runtimeUrl);
  runtime ??= Parser.init({ locateFile: () => new URL("../resources/lint/web-tree-sitter.wasm", import.meta.url).href }).catch((error) => { runtime = null; throw error; });
  await runtime;
  if (!languages.has(name)) languages.set(name, Language.load(new URL(`../resources/lint/tree-sitter-${name}.wasm`, import.meta.url).href).catch((error) => { languages.delete(name); throw error; }));
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(await languages.get(name));
    tree = parser.parse(source);
    if (!tree) throw new Error("Parser did not produce a syntax tree.");
    const diagnostics = [];
    const pending = [tree.rootNode];
    while (pending.length && diagnostics.length < 40) {
      const node = pending.pop();
      const children = node.children.filter((child) => child.hasError || child.isMissing || child.isError);
      // Prefer the smallest erroneous span; a whole-file ERROR is rarely actionable.
      if (children.length) { pending.push(...children.reverse()); continue; }
      if (node.isError || node.isMissing) {
        diagnostics.push({
          line: node.startPosition.row + 1, column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
          severity: "error", source: `Tree-sitter ${name}`,
          message: node.isMissing ? `Expected ${node.type}.` : `Unrecognized syntax near ${JSON.stringify(node.text.slice(0, 80))}. This snippet may need surrounding context.`,
        });
      }
    }
    return { supported: true, diagnostics };
  } finally { tree?.delete(); parser.delete(); }
}
