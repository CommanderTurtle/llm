import assert from "node:assert/strict";
import test from "node:test";

import { isImageSizeError, nextImageDimensions } from "../src/image-retry.js";
import { executeTool, openAiTools } from "../src/tools.js";
import { createWorkspace } from "../src/workspace.js";

test("baseline tool list is unchanged while feature tools are disabled", () => {
  const integrations = createWorkspace().integrations;
  assert.deepEqual(openAiTools(integrations).map((tool) => tool.function.name), ["ocr_attachment"]);
});

test("the complete local feature tool set is explicit", () => {
  const integrations = createWorkspace({
    integrations: { features: { readTools: true, writeTools: true, todoTool: true, compaction: true } },
  }).integrations;
  assert.deepEqual(openAiTools(integrations).map((tool) => tool.function.name), [
    "ocr_attachment",
    "context_read",
    "read_document",
    "instructions_read",
    "put_document",
    "instructions_put",
    "todo_update",
  ]);
});

test("vision retry only recognizes image-dimension ValueErrors", () => {
  assert.equal(isImageSizeError(new Error("ValueError: image resolution exceeds maximum dimensions")), true);
  assert.equal(isImageSizeError(new Error("ValueError: invalid role")), false);
  assert.equal(isImageSizeError(new Error("HTTP 500")), false);
});

test("vision retries reduce exactly 128 pixels on the longest side", () => {
  assert.deepEqual(nextImageDimensions(4096, 2048), { width: 3968, height: 1984 });
  assert.deepEqual(nextImageDimensions(2048, 4096), { width: 1984, height: 3968 });
  assert.throws(() => nextImageDimensions(128, 64), /cannot be reduced/);
});

test("a forged call cannot execute an opt-in browser tool while it is disabled", async () => {
  const integrations = createWorkspace().integrations;
  await assert.rejects(() => executeTool({
    function: { name: "put_document", arguments: JSON.stringify({ name: "blocked.md", content: "blocked" }) },
  }, {
    attachments: [], integrations, mcpConnections: new Map(),
    executeLocalTool: () => "should not run",
  }), /put_document tool is disabled/);
});
