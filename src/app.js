import { normalizeLocalEndpoint } from "./local-endpoint.js";
import { copyText, renderMarkdown } from "./markdown.js";
import { discoverModels, OpenAIEndpointError, streamChatCompletion } from "./openai.js";
import {
  apiMessages,
  conversationDocument,
  createMessage,
  normalizeParameters,
  parseConversationDocument,
} from "./transcript.js";

const elements = {
  connect: document.querySelector("#connect-local"),
  status: document.querySelector("#connection-status"),
  endpoint: document.querySelector("#endpoint"),
  model: document.querySelector("#model"),
  modelOptions: document.querySelector("#model-options"),
  modelCount: document.querySelector("#model-count"),
  systemPrompt: document.querySelector("#system-prompt"),
  temperature: document.querySelector("#temperature"),
  topP: document.querySelector("#top-p"),
  maxTokens: document.querySelector("#max-tokens"),
  seed: document.querySelector("#seed"),
  help: document.querySelector("#connection-help"),
  connectionDetail: document.querySelector("#connection-detail"),
  messages: document.querySelector("#messages"),
  empty: document.querySelector("#empty-state"),
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  stop: document.querySelector("#stop"),
  stats: document.querySelector("#conversation-stats"),
  importButton: document.querySelector("#import-chat"),
  importFile: document.querySelector("#import-file"),
  exportButton: document.querySelector("#export-chat"),
  clearButton: document.querySelector("#clear-chat"),
  toast: document.querySelector("#toast"),
};

const state = {
  endpoint: "http://localhost:8000/v1",
  models: [],
  messages: [],
  request: null,
  connected: false,
  renderFrame: 0,
  toastTimer: 0,
};

function setConnection(stateName, label, detail = "") {
  elements.status.dataset.state = stateName;
  elements.status.textContent = label;
  if (detail) elements.connectionDetail.textContent = detail;
}

function toast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.show = "true";
  state.toastTimer = window.setTimeout(() => {
    elements.toast.dataset.show = "false";
  }, 2_000);
}

function parametersFromForm() {
  return normalizeParameters({
    temperature: elements.temperature.value,
    topP: elements.topP.value,
    maxTokens: elements.maxTokens.value,
    seed: elements.seed.value,
  });
}

function writeParameters(parameters) {
  const value = normalizeParameters(parameters);
  elements.temperature.value = String(value.temperature);
  elements.topP.value = String(value.topP);
  elements.maxTokens.value = String(value.maxTokens);
  elements.seed.value = value.seed == null ? "" : String(value.seed);
}

function populateModels(models) {
  elements.modelOptions.replaceChildren();
  for (const id of models) {
    const option = document.createElement("option");
    option.value = id;
    elements.modelOptions.append(option);
  }
  elements.modelCount.textContent = models.length
    ? `${models.length} model${models.length === 1 ? "" : "s"} discovered.`
    : "No models were advertised; enter a model id manually.";

  if (models.length && !models.includes(elements.model.value.trim())) {
    elements.model.value = models[0];
  }
}

async function connect() {
  if (state.request) return;
  setConnection("connecting", "Requesting local access…", "Contacting the local /v1/models endpoint.");
  elements.connect.disabled = true;

  try {
    const endpoint = normalizeLocalEndpoint(elements.endpoint.value);
    elements.endpoint.value = endpoint;
    state.endpoint = endpoint;
    const models = await discoverModels(endpoint);
    state.models = models;
    state.connected = true;
    populateModels(models);
    setConnection(
      "connected",
      models.length ? `Connected · ${models.length} model${models.length === 1 ? "" : "s"}` : "Connected",
      `Connected to ${endpoint}. No credentials or browser storage are in use.`,
    );
  } catch (error) {
    state.connected = false;
    populateModels([]);
    setConnection("error", "Connection failed", connectionMessage(error));
    elements.help.open = true;
  } finally {
    elements.connect.disabled = false;
  }
}

function connectionMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  let suffix = "";
  try {
    const endpoint = normalizeLocalEndpoint(elements.endpoint.value);
    const parsed = new URL(endpoint);
    if (location.protocol === "https:" && parsed.protocol === "http:" && parsed.hostname !== "localhost") {
      suffix = " This HTTPS page may also require an HTTPS LAN endpoint under your browser's mixed-content policy.";
    }
  } catch {
    // The original validation message is clearer than a secondary parse failure.
  }
  return `${message}${suffix}`;
}

function messageMeta(message) {
  const parts = [];
  if (message.state === "streaming") parts.push("streaming");
  if (message.state === "stopped") parts.push("stopped");
  if (message.meta?.durationMs != null) parts.push(`${(message.meta.durationMs / 1_000).toFixed(1)}s`);
  const usage = message.meta?.usage;
  if (usage?.total_tokens != null) parts.push(`${usage.total_tokens} tokens`);
  if (message.meta?.finishReason) parts.push(String(message.meta.finishReason));
  return parts.join(" · ");
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.role = message.role;
  article.dataset.state = message.state;

  const header = document.createElement("header");
  header.className = "message-header";
  const role = document.createElement("span");
  role.className = "message-role";
  role.textContent = message.role;
  const metadata = document.createElement("span");
  metadata.textContent = messageMeta(message);
  const actions = document.createElement("span");
  actions.className = "message-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  copy.disabled = !message.content;
  copy.addEventListener("click", async () => {
    try {
      await copyText(message.content);
      toast("Message copied");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Copy failed");
    }
  });
  actions.append(copy);
  header.append(role, metadata, actions);
  article.append(header);

  if (message.reasoning) {
    const details = document.createElement("details");
    details.className = "reasoning";
    details.open = message.state === "streaming" && !message.content;
    const summary = document.createElement("summary");
    summary.textContent = `Reasoning · ${message.reasoning.length.toLocaleString()} characters`;
    const pre = document.createElement("pre");
    pre.textContent = message.reasoning;
    details.append(summary, pre);
    article.append(details);
  }

  const body = document.createElement("div");
  body.className = "message-body";
  if (message.content) {
    if (message.role === "assistant") {
      body.append(renderMarkdown(message.content, {
        onCopy: (ok, error) => toast(ok ? "Code copied" : error?.message ?? "Copy failed"),
      }));
    } else {
      const paragraph = document.createElement("p");
      paragraph.style.whiteSpace = "pre-wrap";
      paragraph.textContent = message.content;
      body.append(paragraph);
    }
  } else if (message.state === "streaming") {
    const waiting = document.createElement("p");
    waiting.className = "hint";
    waiting.textContent = message.reasoning ? "Waiting for final answer…" : "Waiting for model…";
    body.append(waiting);
  }
  article.append(body);

  if (message.error) {
    const error = document.createElement("p");
    error.className = "message-error";
    error.textContent = message.error;
    article.append(error);
  }
  return article;
}

function renderNow() {
  state.renderFrame = 0;
  const distanceFromBottom = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight;
  const follow = distanceFromBottom < 140 || state.messages.some((message) => message.state === "streaming");

  const fragment = document.createDocumentFragment();
  if (!state.messages.length) {
    elements.empty.hidden = false;
    fragment.append(elements.empty);
  } else {
    elements.empty.hidden = true;
    for (const message of state.messages) fragment.append(renderMessage(message));
  }
  elements.messages.replaceChildren(fragment);
  elements.stats.textContent = `${state.messages.length} message${state.messages.length === 1 ? "" : "s"}`;
  if (follow) elements.messages.scrollTop = elements.messages.scrollHeight;
}

function scheduleRender() {
  if (!state.renderFrame) state.renderFrame = window.requestAnimationFrame(renderNow);
}

function requestBody(model, messages, parameters) {
  const body = {
    model,
    messages,
    temperature: parameters.temperature,
    top_p: parameters.topP,
    max_tokens: parameters.maxTokens,
  };
  if (parameters.seed != null) body.seed = parameters.seed;
  return body;
}

async function send(event) {
  event.preventDefault();
  if (state.request) return;

  const prompt = elements.prompt.value.trim();
  if (!prompt) return;

  let endpoint;
  try {
    endpoint = normalizeLocalEndpoint(elements.endpoint.value);
  } catch (error) {
    setConnection("error", "Invalid endpoint", connectionMessage(error));
    elements.help.open = true;
    return;
  }

  const model = elements.model.value.trim();
  if (!model) {
    toast("Connect to discover a model, or enter its id manually.");
    elements.model.focus();
    return;
  }

  const user = createMessage("user", prompt);
  state.messages.push(user);
  const outbound = apiMessages(state.messages, elements.systemPrompt.value);
  const assistant = createMessage("assistant", "", { state: "streaming", meta: { model } });
  state.messages.push(assistant);
  elements.prompt.value = "";
  const controller = new AbortController();
  const startedAt = performance.now();
  state.request = { controller, assistantId: assistant.id };
  elements.send.disabled = true;
  elements.stop.disabled = false;
  setConnection("connecting", state.connected ? "Generating…" : "Contacting local model…");
  renderNow();

  try {
    const result = await streamChatCompletion(
      endpoint,
      requestBody(model, outbound, parametersFromForm()),
      {
        signal: controller.signal,
        onDelta(delta) {
          assistant.content += delta.content;
          assistant.reasoning += delta.reasoning;
          scheduleRender();
        },
      },
    );
    assistant.state = "complete";
    assistant.meta = {
      ...assistant.meta,
      model: result.model || model,
      finishReason: result.finishReason,
      usage: result.usage,
      responseId: result.id,
      durationMs: performance.now() - startedAt,
    };
    state.connected = true;
    setConnection("connected", "Connected", `Last request completed through ${endpoint}.`);
  } catch (error) {
    assistant.meta.durationMs = performance.now() - startedAt;
    if (error?.name === "AbortError") {
      assistant.state = "stopped";
      assistant.meta.finishReason = "stopped";
      setConnection(state.connected ? "connected" : "idle", state.connected ? "Connected" : "Not connected");
    } else {
      assistant.state = "error";
      assistant.error = connectionMessage(error);
      state.connected = false;
      setConnection("error", "Request failed", assistant.error);
      if (error instanceof OpenAIEndpointError && error.code === "NETWORK_ERROR") elements.help.open = true;
    }
  } finally {
    state.request = null;
    elements.send.disabled = false;
    elements.stop.disabled = true;
    renderNow();
    elements.prompt.focus();
  }
}

function stop() {
  state.request?.controller.abort();
}

function exportConversation() {
  const endpoint = (() => {
    try {
      return normalizeLocalEndpoint(elements.endpoint.value);
    } catch {
      return state.endpoint;
    }
  })();
  const documentValue = conversationDocument({
    endpoint,
    model: elements.model.value.trim(),
    systemPrompt: elements.systemPrompt.value,
    parameters: parametersFromForm(),
    messages: state.messages,
  });
  const blob = new Blob([`${JSON.stringify(documentValue, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `llm-chat-${stamp}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  toast("Conversation exported");
}

async function importConversation(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast("Conversation JSON must be 10 MB or smaller.");
    return;
  }

  try {
    const parsed = parseConversationDocument(JSON.parse(await file.text()));
    if (parsed.endpoint) {
      const endpoint = normalizeLocalEndpoint(parsed.endpoint);
      state.endpoint = endpoint;
      elements.endpoint.value = endpoint;
    }
    state.models = [];
    state.connected = false;
    populateModels([]);
    elements.model.value = parsed.model;
    elements.systemPrompt.value = parsed.systemPrompt;
    writeParameters(parsed.parameters);
    state.messages = parsed.messages;
    setConnection("idle", "Imported · not connected", "Importing never makes a network request. Connect when ready.");
    renderNow();
    toast(`Imported ${parsed.messages.length} message${parsed.messages.length === 1 ? "" : "s"}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not import conversation JSON.");
  } finally {
    elements.importFile.value = "";
  }
}

function clearConversation() {
  if (state.messages.length && !window.confirm("Clear this in-memory conversation?")) return;
  state.request?.controller.abort();
  state.messages = [];
  renderNow();
  elements.prompt.focus();
}

elements.connect.addEventListener("click", connect);
elements.composer.addEventListener("submit", send);
elements.stop.addEventListener("click", stop);
elements.exportButton.addEventListener("click", exportConversation);
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", () => importConversation(elements.importFile.files?.[0]));
elements.clearButton.addEventListener("click", clearConversation);
elements.prompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

renderNow();
