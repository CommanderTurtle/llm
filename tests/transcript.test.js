import assert from "node:assert/strict";
import test from "node:test";

import {
  apiMessages,
  conversationDocument,
  createMessage,
  parseConversationDocument,
} from "../src/transcript.js";

test("exports a versioned conversation without transient errors", () => {
  const documentValue = conversationDocument({
    endpoint: "http://localhost:8000/v1",
    model: "local",
    systemPrompt: "Be exact.",
    parameters: { temperature: 0.2, topP: 0.9, maxTokens: 100, seed: 3 },
    messages: [createMessage("user", "hello"), createMessage("assistant", "world", { reasoning: "brief" })],
  });
  assert.equal(documentValue.version, 1);
  assert.equal(documentValue.messages.length, 2);
  assert.equal(documentValue.messages[1].reasoning, "brief");
  assert.equal("error" in documentValue.messages[1], false);
});

test("imports both harness documents and plain OpenAI message arrays", () => {
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
    parameters: { max_tokens: 321 },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(full.parameters.maxTokens, 321);
  assert.equal(full.model, "model-a");
});

test("API projection prepends the live system prompt and skips empty failures", () => {
  const messages = [
    createMessage("user", "hello"),
    createMessage("assistant", "", { state: "error", error: "offline" }),
    createMessage("assistant", "partial", { state: "stopped" }),
  ];
  assert.deepEqual(apiMessages(messages, "Be concise."), [
    { role: "system", content: "Be concise." },
    { role: "user", content: "hello" },
    { role: "assistant", content: "partial" },
  ]);
});

test("rejects non-text and unsupported imported messages", () => {
  assert.throws(() => parseConversationDocument({ messages: [{ role: "tool", content: "x" }] }), /unsupported role/);
  assert.throws(() => parseConversationDocument({ messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }), /string content/);
  assert.throws(
    () => parseConversationDocument({
      schema: "https://llm.shel.sh/schemas/conversation-v1.json",
      version: 2,
      messages: [],
    }),
    /newer than this page supports/,
  );
});
