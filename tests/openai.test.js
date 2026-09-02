import assert from "node:assert/strict";
import test from "node:test";

import { discoverModels, SseDataParser, streamChatCompletion } from "../src/openai.js";

test("SSE parser preserves chunk boundaries and multi-line data", () => {
  const parser = new SseDataParser();
  assert.deepEqual(parser.push("event: message\ndata: {\"a\":"), []);
  assert.deepEqual(parser.push("1}\n\ndata: line one\ndata: line two\r\n\r\n"), ["{\"a\":1}", "line one\nline two"]);
  assert.deepEqual(parser.finish(), []);
});

test("model discovery returns stable unique model ids", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: [{ id: "z" }, { id: "a" }, { id: "a" }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  assert.deepEqual(await discoverModels("http://localhost:8000/v1", { fetchImpl }), ["a", "z"]);
});

test("chat completion combines content, reasoning, finish reason, and usage", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"id":"r1","model":"local","choices":[{"delta":{"reasoning_content":"think "}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"id":"r1","model":"local","choices":[{"delta":{"content":"hello"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const deltas = [];
  const fetchImpl = async () => new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const result = await streamChatCompletion(
    "http://localhost:8000/v1",
    { model: "local", messages: [{ role: "user", content: "hi" }] },
    { fetchImpl, onDelta: (delta) => deltas.push(delta) },
  );

  assert.equal(result.content, "hello");
  assert.equal(result.reasoning, "think ");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.usage.total_tokens, 12);
  assert.equal(deltas.length, 2);
});
