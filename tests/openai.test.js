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
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ data: [{ id: "z" }, { id: "a" }, { id: "a" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  assert.deepEqual(await discoverModels("http://localhost:8000/v1", { fetchImpl }), ["a", "z"]);
  assert.equal(request.url, "http://localhost:8000/v1/models");
  assert.equal(request.init.targetAddressSpace, "loopback");
  assert.equal(request.init.mode, "cors");
  assert.equal(request.init.credentials, "omit");
});

test("model discovery fails clearly instead of hanging on an unreachable endpoint", async () => {
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  await assert.rejects(
    discoverModels("http://127.0.0.1:65530/v1", { fetchImpl, timeoutMs: 5 }),
    (error) => error?.code === "TIMEOUT" && /127\.0\.0\.1:65530\/v1\/models/.test(error.message),
  );
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
  let requestInit;
  const fetchImpl = async (_url, init) => {
    requestInit = init;
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
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
  assert.equal(requestInit.targetAddressSpace, "loopback");
});

test("streamed tool-call fragments become one OpenAI tool call", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const payload of [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-7", type: "function", function: { name: "web_", arguments: '{"query":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: '"local models"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const result = await streamChatCompletion("http://localhost:8000/v1", {
    model: "local", messages: [{ role: "user", content: "search" }],
  }, {
    fetchImpl: async () => new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
  });
  assert.deepEqual(result.toolCalls, [{
    id: "call-7",
    type: "function",
    function: { name: "web_search", arguments: '{"query":"local models"}' },
  }]);
  assert.equal(result.finishReason, "tool_calls");
});

test("non-streamed JSON completions preserve tool calls", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    id: "response-1",
    model: "local",
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "ocr_attachment", arguments: { attachment: "photo.png" } } }],
      },
      finish_reason: "tool_calls",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const result = await streamChatCompletion("http://localhost:8000/v1", { model: "local", messages: [] }, { fetchImpl });
  assert.equal(result.toolCalls[0].function.arguments, '{"attachment":"photo.png"}');
});
