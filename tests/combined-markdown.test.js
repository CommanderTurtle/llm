import { expect, test } from "bun:test";
import { combinedFileSection, combinedZipBytes, markdownFence, parseCombinedMarkdown } from "../src/combined-markdown.js";

test("longer outer fences preserve nested Markdown and apparent file headers", () => {
  const text = "# Notes\n\n````md\n```js\nx()\n```\n````\n\n## File: ./not-a-file.txt\n\n***\n";
  const source = combinedFileSection("docs/readme.md", text, "markdown");
  expect(source).toContain("`````markdown\n");
  const result = parseCombinedMarkdown(source);
  expect(result.entries).toEqual([{ path: "docs/readme.md", text, language: "markdown" }]);
  expect(markdownFence("~~~\n`````\n", "text")).toStartWith("``````text\n");
});

test("new text archives preserve final newlines, CRLF, empty files, and blank runs", () => {
  const texts = ["", "no final newline", "line\n", "line\n\n\n\n\n", "a\r\nb\r\n", "a\r\nb", "unicode 世界 👩🏽‍💻"];
  const source = texts.map((text, index) => combinedFileSection(`${index}.txt`, text)).join("\n\n");
  expect(parseCombinedMarkdown(source).entries.map(entry => entry.text)).toEqual(texts);
});

test("legacy bundles and omitted entries remain readable", () => {
  const source = "## File: ./old.md\n\n````markdown\n```js\na()\n```\n````\n\n***\n\n## File: ./image.png\n\n(omitted — binary file, 100 B)\n\n***\n";
  expect(parseCombinedMarkdown(source)).toMatchObject({ included: 1, omitted: 1, legacyNewlines: true });
  expect(parseCombinedMarkdown(source).entries[0].text).toBe("```js\na()\n```\n");
});

test("malformed, duplicate and unsafe bundles are not partially reconstructed", () => {
  const good = combinedFileSection("a.txt", "first");
  for (const bad of ["../escape", "/absolute", "C:/drive", "a/../escape", "a\\..\\escape", "a//b", "a/./b", "NUL.txt", "a. "]) {
    expect(parseCombinedMarkdown(combinedFileSection(bad, "x"))).toBeNull();
    expect(() => combinedZipBytes([{ path: bad, text: "x" }])).toThrow();
  }
  expect(parseCombinedMarkdown(good + "\n\n" + combinedFileSection("A.txt", "duplicate"))).toBeNull();
  expect(parseCombinedMarkdown(good + "\nUnknown content")).toBeNull();
  expect(parseCombinedMarkdown(good + "\n\n" + combinedFileSection("a.txt/child", "x"))).toBeNull();
  expect(() => combinedZipBytes([{ path: "a", text: "x" }, { path: "a/b", text: "y" }])).toThrow();
  expect(parseCombinedMarkdown("## File: ./a\n\n````text\nx\n```\n\n***")).toBeNull();
  expect(parseCombinedMarkdown("ordinary markdown")).toBeNull();
});

test("ZIPs reopen with valid CRCs and exact UTF-8 file contents", async () => {
  const jszip = { exports: {} };
  new Function("exports", "module", await Bun.file(new URL("../resources/jszip/jszip.min.js", import.meta.url)).text())(jszip.exports, jszip);
  const texts = ["", "no newline", "CRLF\r\n", "line\n\n\n\n", "世界", "```md\n```js\nx()\n```\n```"];
  const source = texts.map((text, index) => combinedFileSection(`src/${index}-世界.txt`, text)).join("\n\n") + "\n\n## File: ./missing.bin\n\n(omitted — binary file, 20 B)\n\n***";
  const parsed = parseCombinedMarkdown(source);
  const bytes = combinedZipBytes(parsed.entries);
  const archive = await jszip.exports.loadAsync(bytes, { checkCRC32: true });
  expect(Object.keys(archive.files)).toHaveLength(texts.length);
  for (const [index, text] of texts.entries()) expect(await archive.file(`src/${index}-世界.txt`).async("string")).toBe(text);
  expect(archive.file("missing.bin")).toBeNull();
  expect(combinedZipBytes(parsed.entries)).toEqual(bytes);
});
