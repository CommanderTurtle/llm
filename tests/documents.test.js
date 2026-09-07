import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHashlineEdits,
  createBrowserDocument,
  diffRevision,
  hashlineDocument,
  lineHash,
  lintDocument,
  putBrowserDocument,
} from "../src/documents.js";

test("hashline documents require a current read receipt before editing", () => {
  const documentValue = createBrowserDocument({ name: "notes.md", content: "alpha\nbeta" });
  assert.match(hashlineDocument(documentValue), new RegExp(`1#${lineHash("alpha")}`));
  assert.throws(() => putBrowserDocument(documentValue, { name: "notes.md", content: "changed" }), /Read-before-write failed/);
  const updated = putBrowserDocument(documentValue, {
    name: "notes.md",
    expected_revision: 1,
    edits: [{ line_hash: lineHash("beta"), content: "bravo" }],
  }, { readRevision: 1, actor: "model" });
  assert.equal(updated.content, "alpha\nbravo");
  assert.equal(updated.revision, 2);
  assert.equal(updated.revisions.length, 2);
  assert.throws(() => putBrowserDocument(updated, { name: "notes.md", content: "stale" }, { readRevision: 1 }), /Read-before-write failed/);
});

test("hashline edits reject ambiguous lines and overlapping spans", () => {
  assert.throws(() => applyHashlineEdits("same\nsame", [{ line_hash: lineHash("same"), content: "x" }]), /ambiguous/);
  assert.throws(() => applyHashlineEdits("a\nb\nc", [
    { line_hash: lineHash("a"), end_hash: lineHash("b"), content: "x" },
    { line_hash: lineHash("b"), end_hash: lineHash("c"), content: "y" },
  ]), /overlap/);
});

test("browser lint and revision diff expose syntax errors and red-green rows", () => {
  const diagnostics = lintDocument("```js\nfunction broken( {\n```", "markdown");
  assert.ok(diagnostics.some((item) => /Unclosed/.test(item.message)));
  const diff = diffRevision("one\ntwo", "one\nthree");
  assert.deepEqual(diff.map((line) => line.type), ["context", "remove", "add"]);
});
