import assert from "node:assert/strict";
import test from "node:test";

import {
  apiMessages,
  CONVERSATION_VERSION,
  conversationDocument,
  conversationMarkdown,
  createMessage,
  parseConversationDocument,
} from "../src/transcript.js";

test("exports a versioned conversation with attachments and tool history", () => {
  const user = createMessage("user", "inspect", { attachments: ["image-1"] });
  assert.equal(user.createdAt, user.updatedAt);
  const assistant = createMessage("assistant", "", {
    reasoning: "brief",
    toolCalls: [{ id: "call-1", function: { name: "ocr_attachment", arguments: '{"attachment":"image-1"}' } }],
  });
  const tool = createMessage("tool", "visible text", { toolCallId: "call-1", name: "ocr_attachment" });
  const documentValue = conversationDocument({
    title: "Vision",
    endpoint: "http://localhost:8000/v1",
    model: "local",
    systemPrompt: "Be exact.",
    parameters: { temperature: 0.2, topP: 0.9, maxTokens: 100, seed: 3 },
    attachments: [{
      id: "image-1", name: "sample.png", type: "image/png", size: 4, kind: "image",
      dataUrl: "data:image/png;base64,iVBORw==", text: "", sourceFormat: "png",
    }],
    messages: [user, assistant, tool],
  });
  assert.equal(documentValue.version, CONVERSATION_VERSION);
  assert.equal(documentValue.attachments[0].dataUrl, "data:image/png;base64,iVBORw==");
  assert.equal(documentValue.messages[1].reasoning, "brief");
  assert.equal(documentValue.messages[1].toolCalls[0].id, "call-1");
  assert.equal(documentValue.messages[2].toolCallId, "call-1");
});

test("imports both harness documents and plain OpenAI text-message arrays", () => {
  const plain = parseConversationDocument([
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
  ]);
  assert.deepEqual(plain.messages.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
  ]);

  const full = parseConversationDocument({
    endpoint: "http://localhost:8000/v1",
    model: "model-a",
    systemPrompt: "system",
    parameters: { max_tokens: 321, reasoning_effort: "high", enable_thinking: false },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(full.parameters.maxTokens, 321);
  assert.equal(full.parameters.reasoningEffort, "high");
  assert.equal(full.parameters.enableThinking, false);
  assert.equal(full.model, "model-a");

  const stringBoolean = parseConversationDocument({
    parameters: { enable_thinking: "false" },
    messages: [],
  });
  assert.equal(stringBoolean.parameters.enableThinking, false);
});

test("API projection builds multimodal messages and a valid tool round", () => {
  const attachments = [
    {
      id: "image-1", name: "sample.png", type: "image/png", kind: "image",
      dataUrl: "data:image/png;base64,AAAA", text: "",
    },
    {
      id: "doc-1", name: "notes.md", type: "text/markdown", kind: "document",
      dataUrl: "data:text/markdown;base64,IyBOb3Rlcw==", text: "# Notes\n\nUseful context.",
    },
  ];
  const messages = [
    createMessage("user", "Inspect these.", { attachments: ["image-1", "doc-1"] }),
    createMessage("assistant", "", {
      toolCalls: [{ id: "call-1", function: { name: "ocr_attachment", arguments: '{"attachment":"image-1"}' } }],
    }),
    createMessage("tool", "OCR text", { toolCallId: "call-1", name: "ocr_attachment" }),
    createMessage("assistant", "Done."),
    createMessage("assistant", "", { state: "error", error: "offline" }),
  ];
  const projected = apiMessages(messages, "Be concise.", attachments);
  assert.deepEqual(projected[0], { role: "system", content: "Be concise." });
  assert.equal(projected[1].role, "user");
  assert.equal(projected[1].content[0].type, "text");
  assert.match(projected[1].content[0].text, /<image_attachment id="image-1" name="sample\.png" type="image\/png" \/>/);
  assert.match(projected[1].content[0].text, /<attachment name="notes.md"/);
  assert.deepEqual(projected[1].content[1], { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  assert.equal(projected[2].tool_calls[0].id, "call-1");
  assert.deepEqual(projected[3], { role: "tool", tool_call_id: "call-1", name: "ocr_attachment", content: "OCR text" });
  assert.deepEqual(projected.at(-1), { role: "assistant", content: "Done." });
});

test("conversation Markdown includes reasoning, attachments, and collapsed tool output", () => {
  const markdown = conversationMarkdown({
    title: "Saved chat",
    model: "model-a",
    attachments: [{ id: "a", name: "file.txt" }],
    messages: [
      createMessage("user", "Question", { attachments: ["a"] }),
      createMessage("assistant", "Answer", { reasoning: "Thought" }),
      createMessage("tool", "Result", { toolCallId: "x", name: "lookup" }),
    ],
  });
  assert.match(markdown, /^# Saved chat/m);
  assert.match(markdown, /Attachments: `file\.txt`/);
  assert.match(markdown, /<details><summary>Reasoning<\/summary>/);
  assert.match(markdown, /<details><summary>Tool · lookup<\/summary>/);
});

test("rejects malformed tool messages, multimodal imports, and future versions", () => {
  assert.throws(() => parseConversationDocument({ messages: [{ role: "tool", content: "x" }] }), /tool call id/);
  assert.throws(() => parseConversationDocument({ messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }), /string content/);
  assert.throws(
    () => parseConversationDocument({
      schema: "https://llm.shel.sh/schemas/conversation-v2.json",
      version: CONVERSATION_VERSION + 1,
      messages: [],
    }),
    /newer than this page supports/,
  );
});
