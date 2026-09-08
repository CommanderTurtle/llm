import assert from "node:assert/strict";
import test from "node:test";

import {
  apiMessages,
  CONVERSATION_VERSION,
  conversationDocument,
  conversationMarkdown,
  createMessage,
  normalizeParameters,
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

test("max tokens retain the 8192 baseline unless Auto is explicit", () => {
  assert.equal(normalizeParameters({}).maxTokens, 8192);
  assert.equal(normalizeParameters({ maxTokens: null }).maxTokens, null);
  assert.equal(normalizeParameters({ max_tokens: "" }).maxTokens, null);
  assert.equal(normalizeParameters({ maxTokens: 4096 }).maxTokens, 4096);
});

test("reasoning is replayed only for opted-in tool-call continuity", () => {
  const assistant = createMessage("assistant", null, {
    reasoning: "private continuity",
    toolCalls: [{ id: "call-1", function: { name: "lookup", arguments: "{}" } }],
  });
  assert.equal(apiMessages([assistant])[0].reasoning_content, undefined);
  assert.equal(apiMessages([assistant], "", [], { preserveToolReasoning: true })[0].reasoning_content, "private continuity");
});

test("reasoning is replayed for one explicit interrupted-turn recovery only", () => {
  const assistant = createMessage("assistant", "partial", { id: "recover", reasoning: "private recovery state" });
  assert.equal(apiMessages([assistant])[0].reasoning_content, undefined);
  assert.equal(apiMessages([assistant], "", [], { reasoningMessageIds: new Set([assistant.id]) })[0].reasoning_content, "private recovery state");
});

test("projection can substitute image retries and losslessly collapse selected ids", () => {
  const user = createMessage("user", "inspect", { id: "selected", attachments: ["image"] });
  const keep = createMessage("assistant", "keep", { id: "keep" });
  const attachments = [{ id: "image", name: "x.png", type: "image/png", kind: "image", dataUrl: "data:image/png;base64,OLD" }];
  const projected = apiMessages([user, keep], "", attachments, {
    compactedMessageIds: ["selected"],
    compactionEnvelope: "summary plus exact ids",
    imageOverrides: new Map([["image", { dataUrl: "data:image/png;base64,NEW" }]]),
  });
  assert.deepEqual(projected, [
    { role: "system", content: "summary plus exact ids" },
    { role: "assistant", content: "keep" },
  ]);
  const image = apiMessages([user], "", attachments, { imageOverrides: new Map([["image", { dataUrl: "data:image/png;base64,NEW" }]]) });
  assert.equal(image[0].content[1].image_url.url, "data:image/png;base64,NEW");
  assert.equal(attachments[0].dataUrl, "data:image/png;base64,OLD");
});

test("resource indexes alter only projection while exact tool output remains stored", () => {
  const tool = createMessage("tool", "exact Firecrawl output\n\n", {
    id: "tool-message", toolCallId: "call-1", name: "web_scrape", meta: { resourceId: "resource-1" },
  });
  const projected = apiMessages([tool], "", [], { resourceIndexes: new Map([["resource-1", "compact resource index"]]) });
  assert.equal(projected[0].content, "compact resource index");
  assert.equal(tool.content, "exact Firecrawl output\n\n");
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
    attachments: [{ id: "a", name: "file.txt", type: "text/plain", size: 4, kind: "text", text: "body", dataUrl: "data:text/plain;base64,Ym9keQ==" }],
    messages: [
      createMessage("user", "Question", { id: "u", attachments: ["a"] }),
      createMessage("assistant", "Answer", { id: "a", reasoning: "Thought", toolCalls: [{ id: "x", function: { name: "lookup", arguments: '{"query":"value"}' } }] }),
      createMessage("tool", "Result", { toolCallId: "x", name: "lookup" }),
    ],
    compactions: [{ id: "compact-1", mode: "normal", messageIds: ["u", "a"], summary: "Short projection", searchTerms: ["question", "answer"], active: true }],
  });
  assert.match(markdown, /^# Saved chat/m);
  assert.match(markdown, /Attachments · exact chat references/);
  assert.match(markdown, /Download exact attachment bytes/);
  assert.match(markdown, /<details><summary>Reasoning · 7 characters<\/summary>/);
  assert.match(markdown, /<details><summary>Tool request · lookup · x<\/summary>/);
  assert.match(markdown, /<details><summary>Tool result · lookup · x<\/summary>/);
  assert.match(markdown, /Active Normal summary · 2 originals · compact-1/);
  assert.match(markdown, /Searchable values: `question`, `answer`/);
  assert.match(markdown, /Question/);
  assert.match(markdown, /Answer/);

  const baseline = conversationMarkdown({
    title: "Saved chat",
    model: "model-a",
    attachments: [{ id: "a", name: "file.txt", type: "text/plain", size: 4, kind: "text", text: "body", dataUrl: "data:text/plain;base64,Ym9keQ==" }],
    messages: [
      createMessage("user", "Question", { id: "u", attachments: ["a"] }),
      createMessage("assistant", "Answer", { id: "a", reasoning: "Thought", toolCalls: [{ id: "x", function: { name: "lookup", arguments: '{"query":"value"}' } }] }),
      createMessage("tool", "Result", { toolCallId: "x", name: "lookup" }),
    ],
    compactions: [{ id: "compact-1", mode: "normal", messageIds: ["u", "a"], summary: "Short projection", active: true }],
  }, { complete: false });
  assert.doesNotMatch(baseline, /Context records|Short projection|Tool request/);
  assert.match(baseline, /Attachments: `file\.txt`/);
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
