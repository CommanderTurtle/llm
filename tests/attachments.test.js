import assert from "node:assert/strict";
import test from "node:test";

import { prepareAttachment } from "../src/attachments.js";

test("images retain their exact bytes as OpenAI-compatible data URLs", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "pixel.png", { type: "image/png" });
  const attachment = await prepareAttachment(file);
  assert.equal(attachment.kind, "image");
  assert.equal(attachment.dataUrl, "data:image/png;base64,AQIDBA==");
  assert.equal(attachment.size, 4);
});

test("text files retain raw bytes and a prompt projection", async () => {
  const file = new File(["# Heading\n\nText"], "README.md", { type: "text/markdown" });
  const attachment = await prepareAttachment(file);
  assert.equal(attachment.kind, "text");
  assert.equal(attachment.text, "# Heading\n\nText");
  assert.match(attachment.dataUrl, /^data:text\/markdown;base64,/);
});

test("AnyDoc-compatible files convert locally through an injected runtime", async () => {
  const file = new File(["%PDF-fixture"], "paper.pdf", { type: "application/pdf" });
  const runtime = {
    formatFromPath: () => "Pdf",
    formatFromBytes: () => undefined,
    toMarkdownBytes: (_bytes, format) => `# Converted ${format}`,
  };
  const attachment = await prepareAttachment(file, { runtime });
  assert.equal(attachment.kind, "document");
  assert.equal(attachment.sourceFormat, "Pdf");
  assert.equal(attachment.text, "# Converted Pdf");
});
