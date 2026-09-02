import assert from "node:assert/strict";
import test from "node:test";

import { combineZip, normalizeArchivePath, renderCombinedMarkdown } from "../src/archive.js";

const encoder = new TextEncoder();

function fakeZip(entries) {
  return {
    async loadAsync() {
      return {
        forEach(callback) {
          for (const entry of entries) {
            const bytes = entry.bytes ?? encoder.encode(entry.text ?? "");
            callback(entry.path, {
              dir: false,
              _data: { uncompressedSize: bytes.length },
              async async() { return bytes; },
            });
          }
        },
      };
    },
  };
}

test("archive paths cannot escape the synthetic Markdown tree", () => {
  assert.equal(normalizeArchivePath("../src\\main.ts"), "_parent_/src/main.ts");
  assert.equal(normalizeArchivePath("C:\\project\\README.md"), "project/README.md");
});

test("combined Markdown preserves headers, languages, and fence content", () => {
  const markdown = renderCombinedMarkdown([
    { path: "src/app.js", size: 20, language: "javascript", text: "const ticks = '```';" },
    { path: "asset.png", size: 100, language: "text", omittedReason: "binary file" },
  ]);
  assert.match(markdown, /## File: \.\/src\/app\.js/);
  assert.match(markdown, /````javascript\nconst ticks/);
  assert.match(markdown, /## File: \.\/asset\.png\n\n\(omitted — binary file, 100 B\)/);
});

test("ZIP conversion is deterministic and omits binary payloads", async () => {
  const zip = fakeZip([
    { path: "z-last.txt", text: "last" },
    { path: "image.png", bytes: new Uint8Array([137, 80, 78, 71]) },
    { path: "a-first.ts", text: "export const first = true;" },
  ]);
  const file = { size: 42, async arrayBuffer() { return new ArrayBuffer(0); } };
  const result = await combineZip(file, { JSZip: zip });
  assert.equal(result.included, 2);
  assert.equal(result.omitted, 1);
  assert.ok(result.markdown.indexOf("a-first.ts") < result.markdown.indexOf("z-last.txt"));
  assert.match(result.markdown, /image\.png[\s\S]*omitted — binary file/);
});
