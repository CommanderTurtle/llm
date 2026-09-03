import { endpointResource, localFetchOptions, normalizeLocalEndpoint } from "./local-endpoint.js";

export class OpenAIEndpointError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "OpenAIEndpointError";
    this.code = options.code ?? "OPENAI_ENDPOINT_ERROR";
    this.status = options.status ?? null;
    this.detail = options.detail ?? "";
  }
}

export class SseDataParser {
  #buffer = "";

  push(chunk) {
    this.#buffer += chunk;
    const values = [];

    while (true) {
      const boundary = this.#buffer.match(/\r?\n\r?\n/);
      if (!boundary || boundary.index === undefined) break;

      const block = this.#buffer.slice(0, boundary.index);
      this.#buffer = this.#buffer.slice(boundary.index + boundary[0].length);
      const value = this.#readBlock(block);
      if (value !== null) values.push(value);
    }

    return values;
  }

  finish() {
    if (this.#buffer.trim() === "") {
      this.#buffer = "";
      return [];
    }

    const value = this.#readBlock(this.#buffer);
    this.#buffer = "";
    return value === null ? [] : [value];
  }

  #readBlock(block) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line === "data" || line.startsWith("data:"))
      .map((line) => (line === "data" ? "" : line.slice(5).replace(/^ /, "")));
    return data.length ? data.join("\n") : null;
  }
}

function textFromContent(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      return typeof part.text === "string" ? part.text : typeof part.content === "string" ? part.content : "";
    })
    .join("");
}

async function responseError(response) {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 8_192);
  } catch {
    // The status and URL remain useful when a body cannot be read.
  }

  let message = `Local model endpoint returned HTTP ${response.status}.`;
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      const remote = parsed?.error?.message ?? parsed?.message ?? parsed?.detail;
      if (typeof remote === "string" && remote.trim()) message = remote.trim();
    } catch {
      message = `${message} ${detail.slice(0, 300)}`;
    }
  }

  return new OpenAIEndpointError(message, {
    code: "HTTP_ERROR",
    status: response.status,
    detail,
  });
}

function networkError(error, action, url) {
  if (error?.name === "AbortError") return error;
  if (error?.name === "TimeoutError") {
    return new OpenAIEndpointError(`Timed out while contacting ${url}. Confirm the address and that the model server is listening.`, {
      code: "TIMEOUT",
      cause: error,
    });
  }
  return new OpenAIEndpointError(
    `The browser could not ${action} ${url}. Approve local-network access if prompted and confirm the model server is running and permits this page's Origin.`,
    { code: "NETWORK_ERROR", cause: error },
  );
}

function boundedSignal(source, timeoutMs) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12_000;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(source.reason);
  if (source?.aborted) forwardAbort();
  else source?.addEventListener("abort", forwardAbort, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`Request exceeded ${duration} ms.`, "TimeoutError"));
  }, duration);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
      source?.removeEventListener("abort", forwardAbort);
    },
  };
}

export async function discoverModels(endpoint, options = {}) {
  const base = normalizeLocalEndpoint(endpoint);
  const url = endpointResource(base, "models");
  const bounded = boundedSignal(options.signal, options.timeoutMs);
  let response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, localFetchOptions(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: bounded.signal,
    }));
  } catch (error) {
    throw networkError(error, "reach", url);
  } finally {
    bounded.clear();
  }

  if (!response.ok) throw await responseError(response);

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new OpenAIEndpointError("The /v1/models response was not valid JSON.", {
      code: "INVALID_MODELS_RESPONSE",
      cause: error,
    });
  }

  const data = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(data)) {
    throw new OpenAIEndpointError("The /v1/models response did not contain a model list.", {
      code: "INVALID_MODELS_RESPONSE",
    });
  }

  const models = data
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim());

  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

function applyChunk(chunk, aggregate, onDelta) {
  if (chunk?.error) {
    const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
    throw new OpenAIEndpointError(message || "The local model returned a stream error.", {
      code: "STREAM_ERROR",
      detail: JSON.stringify(chunk.error),
    });
  }

  if (chunk?.usage && typeof chunk.usage === "object") aggregate.usage = chunk.usage;
  if (typeof chunk?.id === "string") aggregate.id = chunk.id;
  if (typeof chunk?.model === "string") aggregate.model = chunk.model;

  const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
  if (!choice) return;

  const delta = choice.delta ?? choice.message ?? {};
  const content = textFromContent(delta.content);
  const reasoning = textFromContent(
    delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? delta.reasoningContent,
  );

  if (content) aggregate.content += content;
  if (reasoning) aggregate.reasoning += reasoning;
  let toolChanged = false;
  const completeToolCalls = Array.isArray(choice.message?.tool_calls) ? choice.message.tool_calls : null;
  if (completeToolCalls) {
    aggregate.toolCalls = completeToolCalls.map((call, index) => ({
      id: call?.id || `call_${index}`,
      type: "function",
      function: {
        name: call?.function?.name || "",
        arguments: typeof call?.function?.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call?.function?.arguments ?? {}),
      },
    }));
    toolChanged = aggregate.toolCalls.length > 0;
  } else if (Array.isArray(delta.tool_calls)) {
    for (const [fallbackIndex, part] of delta.tool_calls.entries()) {
      const index = Number.isInteger(part?.index) ? part.index : fallbackIndex;
      aggregate.toolCalls[index] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
      const target = aggregate.toolCalls[index];
      if (part?.id) target.id = part.id;
      if (part?.type) target.type = part.type;
      if (part?.function?.name) target.function.name += part.function.name;
      if (part?.function?.arguments) target.function.arguments += part.function.arguments;
      toolChanged = true;
    }
  } else if (delta.function_call) {
    aggregate.toolCalls[0] ??= { id: "call_legacy", type: "function", function: { name: "", arguments: "" } };
    if (delta.function_call.name) aggregate.toolCalls[0].function.name += delta.function_call.name;
    if (delta.function_call.arguments) aggregate.toolCalls[0].function.arguments += delta.function_call.arguments;
    toolChanged = true;
  }
  if (choice.finish_reason != null) aggregate.finishReason = choice.finish_reason;

  if (content || reasoning || toolChanged) onDelta?.({ content, reasoning, toolCalls: aggregate.toolCalls, aggregate: { ...aggregate } });
}

function parsePayload(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new OpenAIEndpointError("The local model emitted malformed streaming JSON.", {
      code: "INVALID_STREAM_JSON",
      detail: value.slice(0, 1_000),
      cause: error,
    });
  }
}

export async function streamChatCompletion(endpoint, request, options = {}) {
  const base = normalizeLocalEndpoint(endpoint);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = endpointResource(base, "chat/completions");
  let response;

  try {
    response = await fetchImpl(url, localFetchOptions(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...request, stream: true }),
      cache: "no-store",
      signal: options.signal,
    }));
  } catch (error) {
    throw networkError(error, "send a request to", url);
  }

  if (!response.ok) throw await responseError(response);

  const aggregate = {
    id: "",
    model: request.model,
    content: "",
    reasoning: "",
    finishReason: null,
    usage: null,
    toolCalls: [],
  };

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || !response.body) {
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new OpenAIEndpointError("The chat completion response was not valid JSON.", {
        code: "INVALID_COMPLETION_RESPONSE",
        cause: error,
      });
    }
    applyChunk(payload, aggregate, options.onDelta);
    return aggregate;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseDataParser();
  let done = false;

  const consume = (values) => {
    for (const value of values) {
      if (value.trim() === "[DONE]") {
        done = true;
        continue;
      }
      if (!value.trim()) continue;
      applyChunk(parsePayload(value), aggregate, options.onDelta);
    }
  };

  try {
    while (!done) {
      const next = await reader.read();
      if (next.done) break;
      consume(parser.push(decoder.decode(next.value, { stream: true })));
    }
    consume(parser.push(decoder.decode()));
    consume(parser.finish());
  } finally {
    if (done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  return aggregate;
}
