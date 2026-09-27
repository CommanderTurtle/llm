import { test, expect } from "bun:test";
import { Parser, Language } from "../resources/lint/web-tree-sitter.js";
import { PARSER_LANGUAGES, parserLanguage } from "../src/lint-parsers.js";

test("every bundled grammar loads; F# and C++ distinguish valid and broken syntax", async () => {
  await Parser.init({ wasmBinary: await Bun.file(new URL("../resources/lint/web-tree-sitter.wasm", import.meta.url)).arrayBuffer() });
  for (const name of PARSER_LANGUAGES) {
    const language = await Language.load(new Uint8Array(await Bun.file(new URL(`../resources/lint/tree-sitter-${name}.wasm`, import.meta.url)).arrayBuffer())).catch((error) => { throw new Error(`${name}: ${error.message}`); });
    const parser = new Parser();
    parser.setLanguage(language);
    const empty = parser.parse("");
    expect(empty).not.toBeNull();
    empty.delete();
    for (const source of name === "fsharp" ? ["let answer = 42", "let ="] : name === "cpp" ? ["int main() { return 0; }", "int main( { return ;"] : []) {
      const tree = parser.parse(source);
      expect(tree.rootNode.hasError).toBe(source === "let =" || source.includes("main( {"));
      tree.delete();
    }
    parser.delete();
  }
  expect(parserLanguage("fs")).toBe("fsharp");
  expect(parserLanguage("c++")).toBe("cpp");
  expect(parserLanguage("unknown")).toBe(null);
});
