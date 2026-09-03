import { formatAttachmentSize, prepareAttachment } from "./attachments.js";
import { testFirecrawl } from "./firecrawl.js";
import {
  endpointResource,
  localNetworkPermissionNameForEndpoint,
  localNetworkPermissionState,
  normalizeLocalEndpoint,
  targetAddressSpaceForEndpoint,
} from "./local-endpoint.js";
import { copyText, renderMarkdown } from "./markdown.js";
import { McpHttpClient } from "./mcp.js";
import { discoverModels, OpenAIEndpointError, streamChatCompletion } from "./openai.js";
import { loadWorkspace, makeDebouncedSaver, saveWorkspace } from "./storage.js";
import {
  apiMessages,
  conversationDocument,
  conversationMarkdown,
  createMessage,
  messageId,
  normalizeParameters,
} from "./transcript.js";
import { executeTool, openAiTools, parseToolArguments } from "./tools.js";
import {
  activeSession,
  createSession,
  createWorkspace,
  parseWorkspaceDocument,
  sessionFromConversation,
  touchSession,
  workspaceDocument,
  WORKSPACE_SCHEMA,
} from "./workspace.js";

const elements = {
  newChat: document.querySelector("#new-chat"),
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
  reasoningEffort: document.querySelector("#reasoning-effort"),
  enableThinking: document.querySelector("#enable-thinking"),
  help: document.querySelector("#connection-help"),
  connectionDetail: document.querySelector("#connection-detail"),
  sessions: document.querySelector("#sessions"),
  sessionCount: document.querySelector("#session-count"),
  renameChat: document.querySelector("#rename-chat"),
  deleteChat: document.querySelector("#delete-chat"),
  storageStatus: document.querySelector("#storage-status"),
  messages: document.querySelector("#messages"),
  empty: document.querySelector("#empty-state"),
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  stop: document.querySelector("#stop"),
  stats: document.querySelector("#conversation-stats"),
  toolCount: document.querySelector("#tool-count"),
  attach: document.querySelector("#attach"),
  attachmentFiles: document.querySelector("#attachment-files"),
  attachmentStatus: document.querySelector("#attachment-status"),
  pendingAttachments: document.querySelector("#pending-attachments"),
  importButton: document.querySelector("#import-state"),
  importFile: document.querySelector("#import-file"),
  exportButton: document.querySelector("#export-state"),
  exportMarkdown: document.querySelector("#export-markdown"),
  printChat: document.querySelector("#print-chat"),
  approval: document.querySelector("#tool-approval"),
  maxToolRounds: document.querySelector("#max-tool-rounds"),
  ocrEnabled: document.querySelector("#ocr-enabled"),
  firecrawlEnabled: document.querySelector("#firecrawl-enabled"),
  firecrawlUrl: document.querySelector("#firecrawl-url"),
  firecrawlLimit: document.querySelector("#firecrawl-limit"),
  testFirecrawl: document.querySelector("#test-firecrawl"),
  firecrawlStatus: document.querySelector("#firecrawl-status"),
  mcpName: document.querySelector("#mcp-name"),
  mcpUrl: document.querySelector("#mcp-url"),
  addMcp: document.querySelector("#add-mcp"),
  mcpList: document.querySelector("#mcp-list"),
  editDialog: document.querySelector("#edit-dialog"),
  editContent: document.querySelector("#edit-content"),
  saveEdit: document.querySelector("#save-edit"),
  toolDialog: document.querySelector("#tool-dialog"),
  toolDialogName: document.querySelector("#tool-dialog-name"),
  toolDialogArguments: document.querySelector("#tool-dialog-arguments"),
  toast: document.querySelector("#toast"),
};

const state = {
  workspace: createWorkspace(),
  models: [],
  request: null,
  connected: false,
  renderFrame: 0,
  toastTimer: 0,
  editMessageId: "",
  mcpConnections: new Map(),
  mcpStatus: new Map(),
  storageReady: false,
};

const persist = makeDebouncedSaver(async (documentValue) => {
  try {
    await saveWorkspace(documentValue);
    elements.storageStatus.textContent = `Saved locally · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    elements.storageStatus.textContent = `Local save failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}, 350);

function session() {
  return activeSession(state.workspace);
}

function queueSave() {
  if (!state.storageReady) return;
  state.workspace.savedAt = new Date().toISOString();
  elements.storageStatus.textContent = "Saving locally…";
  persist(workspaceDocument(state.workspace));
}

function setConnection(stateName, label, detail = "") {
  elements.status.dataset.state = stateName;
  elements.status.textContent = label;
  if (detail) elements.connectionDetail.textContent = detail;
}

function toast(message, duration = 2_400) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.show = "true";
  state.toastTimer = window.setTimeout(() => { elements.toast.dataset.show = "false"; }, duration);
}

function parametersFromForm() {
  return normalizeParameters({
    temperature: elements.temperature.value,
    topP: elements.topP.value,
    maxTokens: elements.maxTokens.value,
    seed: elements.seed.value,
    reasoningEffort: elements.reasoningEffort.value,
    enableThinking: elements.enableThinking.checked,
  });
}

function writeParameters(parameters) {
  const value = normalizeParameters(parameters);
  elements.temperature.value = String(value.temperature);
  elements.topP.value = String(value.topP);
  elements.maxTokens.value = String(value.maxTokens);
  elements.seed.value = value.seed == null ? "" : String(value.seed);
  elements.reasoningEffort.value = value.reasoningEffort;
  elements.enableThinking.checked = value.enableThinking;
}

function syncSessionFromForm() {
  const current = session();
  current.endpoint = elements.endpoint.value.trim();
  current.model = elements.model.value.trim();
  current.systemPrompt = elements.systemPrompt.value;
  current.parameters = parametersFromForm();
  current.draft = elements.prompt.value;
  touchSession(current);
}

function syncIntegrationsFromForm() {
  const integrations = state.workspace.integrations;
  integrations.approval = elements.approval.value === "always" ? "always" : "ask";
  integrations.maxToolRounds = Math.max(1, Math.min(16, Math.trunc(Number(elements.maxToolRounds.value) || 8)));
  integrations.ocr.enabled = elements.ocrEnabled.checked;
  integrations.firecrawl.enabled = elements.firecrawlEnabled.checked;
  integrations.firecrawl.url = elements.firecrawlUrl.value.trim() || "http://localhost:3002";
  integrations.firecrawl.limit = Math.max(1, Math.min(10, Math.trunc(Number(elements.firecrawlLimit.value) || 5)));
}

function writeIntegrations() {
  const integrations = state.workspace.integrations;
  elements.approval.value = integrations.approval;
  elements.maxToolRounds.value = String(integrations.maxToolRounds);
  elements.ocrEnabled.checked = integrations.ocr.enabled;
  elements.firecrawlEnabled.checked = integrations.firecrawl.enabled;
  elements.firecrawlUrl.value = integrations.firecrawl.url;
  elements.firecrawlLimit.value = String(integrations.firecrawl.limit);
  elements.firecrawlStatus.textContent = integrations.firecrawl.enabled ? "Enabled; test when the service is running." : "Disabled.";
}

function loadSessionIntoForm() {
  const current = session();
  elements.endpoint.value = current.endpoint;
  elements.model.value = current.model;
  elements.systemPrompt.value = current.systemPrompt;
  elements.prompt.value = current.draft;
  writeParameters(current.parameters);
  state.models = [];
  state.connected = false;
  populateModels([]);
  setConnection("idle", "Not connected", "Switching or importing a session never makes a network request.");
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
    : "No models discovered yet; enter a model id manually.";
  if (models.length && !models.includes(elements.model.value.trim())) elements.model.value = models[0];
}

async function connectionMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const notes = [];
  try {
    const endpoint = normalizeLocalEndpoint(elements.endpoint.value);
    const parsed = new URL(endpoint);
    const permissionName = localNetworkPermissionNameForEndpoint(endpoint);
    const permission = await localNetworkPermissionState(endpoint);
    if (permission === "denied") {
      notes.push(`The browser reports ${permissionName} is denied for this site; change Local network access to Allow in site permissions, then reload.`);
    } else if (permission === "prompt" && error instanceof OpenAIEndpointError && error.code === "NETWORK_ERROR") {
      notes.push(`The browser still reports ${permissionName} as prompt. Connect already made the permission-triggering fetch; if no prompt appeared, an extension, browser policy, or unreachable endpoint stopped it first.`);
    } else if (error instanceof OpenAIEndpointError && error.code === "NETWORK_ERROR") {
      notes.push("If DevTools reports ERR_BLOCKED_BY_CLIENT, check this site's Local network access permission and any content-blocking extension.");
    }
    if (location.protocol === "https:" && parsed.protocol === "http:" && parsed.hostname !== "localhost") {
      notes.push("This is an HTTPS page calling a plain-HTTP LAN address. Supporting browsers relax mixed-content blocking after local-network permission is granted; otherwise use an HTTPS local endpoint or the locally served page.");
    }
  } catch {
    // Preserve the original validation error.
  }
  return [message, ...notes].join(" ");
}

async function connect() {
  if (state.request) return;
  elements.connect.disabled = true;
  try {
    const endpoint = normalizeLocalEndpoint(elements.endpoint.value);
    const modelsUrl = endpointResource(endpoint, "models");
    const addressSpace = targetAddressSpaceForEndpoint(endpoint);
    const permissionName = localNetworkPermissionNameForEndpoint(endpoint);
    elements.endpoint.value = endpoint;
    session().endpoint = endpoint;
    const promptNote = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]"
      ? " A loopback-hosted dev page normally does not need to show a local-network permission prompt."
      : ` This click directly starts the browser's ${permissionName} request; approve it if prompted.`;
    setConnection("connecting", "Requesting local access…", `GET ${modelsUrl} with targetAddressSpace=${addressSpace}.${promptNote}`);
    const models = await discoverModels(endpoint);
    state.models = models;
    state.connected = true;
    populateModels(models);
    session().model = elements.model.value.trim();
    touchSession(session());
    queueSave();
    const permission = await localNetworkPermissionState(endpoint);
    const permissionDetail = permission === "unsupported" ? "" : ` Browser permission: ${permissionName}=${permission}.`;
    setConnection("connected", models.length ? `Connected · ${models.length} models` : "Connected", `Connected to ${endpoint}.${permissionDetail}`);
  } catch (error) {
    state.connected = false;
    populateModels([]);
    setConnection("error", "Connection failed", await connectionMessage(error));
    elements.help.open = true;
  } finally {
    elements.connect.disabled = false;
  }
}

function sessionMeta(value) {
  const count = value.messages.filter((message) => message.role !== "tool").length;
  const stamp = new Date(value.updatedAt);
  const time = Number.isNaN(stamp.valueOf()) ? "" : stamp.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${count} message${count === 1 ? "" : "s"}${time ? ` · ${time}` : ""}`;
}

function renderSessions() {
  const fragment = document.createDocumentFragment();
  const sorted = [...state.workspace.sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const item of sorted) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-item";
    button.dataset.sessionId = item.id;
    button.setAttribute("aria-current", String(item.id === state.workspace.activeSessionId));
    const wrapper = document.createElement("span");
    wrapper.className = "session-item-text";
    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "session-meta";
    meta.textContent = sessionMeta(item);
    wrapper.append(title, meta);
    button.append(wrapper);
    fragment.append(button);
  }
  elements.sessions.replaceChildren(fragment);
  elements.sessionCount.textContent = String(state.workspace.sessions.length);
}

function switchSession(id) {
  if (state.request) { toast("Stop the current generation before switching chats."); return; }
  if (id === state.workspace.activeSessionId) return;
  syncSessionFromForm();
  state.workspace.activeSessionId = id;
  loadSessionIntoForm();
  renderAll();
  queueSave();
}

function newSession() {
  if (state.request) { toast("Stop the current generation before starting another chat."); return; }
  syncSessionFromForm();
  const created = createSession();
  state.workspace.sessions.push(created);
  state.workspace.activeSessionId = created.id;
  loadSessionIntoForm();
  renderAll();
  queueSave();
  elements.prompt.focus();
}

function renameSession() {
  const current = session();
  const value = window.prompt("Session name", current.title);
  if (value == null || !value.trim()) return;
  current.title = value.trim().slice(0, 120);
  current.titleLocked = true;
  touchSession(current);
  renderSessions();
  queueSave();
}

function deleteSession() {
  if (state.request) { toast("Stop the current generation before deleting this chat."); return; }
  const current = session();
  if (!window.confirm(`Delete “${current.title}” and its locally stored attachments?`)) return;
  const index = state.workspace.sessions.findIndex((item) => item.id === current.id);
  state.workspace.sessions.splice(index, 1);
  if (!state.workspace.sessions.length) state.workspace.sessions.push(createSession());
  state.workspace.activeSessionId = state.workspace.sessions[Math.max(0, index - 1)]?.id ?? state.workspace.sessions[0].id;
  loadSessionIntoForm();
  renderAll();
  queueSave();
}

function messageMeta(message) {
  const parts = [];
  if (message.state === "streaming") parts.push("streaming");
  if (message.state === "stopped") parts.push("stopped");
  if (message.meta?.durationMs != null) parts.push(`${(message.meta.durationMs / 1_000).toFixed(1)}s`);
  if (message.meta?.usage?.total_tokens != null) parts.push(`${message.meta.usage.total_tokens} tokens`);
  if (message.meta?.finishReason) parts.push(String(message.meta.finishReason));
  if (message.meta?.edited) parts.push("edited");
  return parts.join(" · ");
}

function attachmentCard(attachment) {
  const card = document.createElement("div");
  card.className = "attachment-card";
  if (attachment.kind === "image" && attachment.dataUrl) {
    const image = document.createElement("img");
    image.src = attachment.dataUrl;
    image.alt = "";
    card.append(image);
  }
  const text = document.createElement("span");
  const name = document.createElement("span");
  name.className = "attachment-name";
  name.textContent = attachment.name;
  const meta = document.createElement("span");
  meta.className = "attachment-meta";
  meta.textContent = `${attachment.kind} · ${formatAttachmentSize(attachment.size)}`;
  text.append(name, meta);
  card.append(text);
  return card;
}

function renderMessage(message) {
  const current = session();
  const attachmentMap = new Map(current.attachments.map((item) => [item.id, item]));
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.role = message.role;
  article.dataset.state = message.state;

  const header = document.createElement("header");
  header.className = "message-header";
  const role = document.createElement("span");
  role.className = "message-role";
  role.textContent = message.role === "tool" ? `tool${message.name ? ` · ${message.name}` : ""}` : message.role;
  const metadata = document.createElement("span");
  metadata.textContent = messageMeta(message);
  const actions = document.createElement("span");
  actions.className = "message-actions";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  copy.disabled = !message.content;
  copy.addEventListener("click", async () => {
    try { await copyText(message.content); toast("Message copied"); }
    catch (error) { toast(error instanceof Error ? error.message : "Copy failed"); }
  });
  actions.append(copy);

  if ((message.role === "user" || message.role === "assistant") && message.state !== "streaming") {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEdit(message.id));
    actions.append(edit);
  }
  if (message.state !== "streaming") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.className = "danger";
    remove.addEventListener("click", () => deleteMessage(message.id));
    actions.append(remove);
  }
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

  for (const call of message.toolCalls ?? []) {
    const details = document.createElement("details");
    details.className = "tool-call";
    const summary = document.createElement("summary");
    summary.textContent = `Tool request · ${call.function.name || "pending"}`;
    const pre = document.createElement("pre");
    try { pre.textContent = JSON.stringify(parseToolArguments(call.function.arguments), null, 2); }
    catch { pre.textContent = call.function.arguments; }
    details.append(summary, pre);
    article.append(details);
  }

  const body = document.createElement("div");
  body.className = "message-body";
  if (message.content) {
    if (message.role === "assistant" || message.role === "tool") {
      body.append(renderMarkdown(message.content, { onCopy: (ok, error) => toast(ok ? "Code copied" : error?.message ?? "Copy failed") }));
    } else {
      const paragraph = document.createElement("p");
      paragraph.style.whiteSpace = "pre-wrap";
      paragraph.textContent = message.content;
      body.append(paragraph);
    }
  } else if (message.state === "streaming") {
    const waiting = document.createElement("p");
    waiting.className = "hint";
    waiting.textContent = message.reasoning ? "Waiting for final answer…" : message.toolCalls?.length ? "Preparing tool call…" : "Waiting for model…";
    body.append(waiting);
  }
  article.append(body);

  const attachments = (message.attachments ?? []).map((id) => attachmentMap.get(id)).filter(Boolean);
  if (attachments.length) {
    const list = document.createElement("div");
    list.className = "message-attachments";
    for (const attachment of attachments) list.append(attachmentCard(attachment));
    article.append(list);
  }

  if (message.error) {
    const error = document.createElement("p");
    error.className = "message-error";
    error.textContent = message.error;
    article.append(error);
  }
  return article;
}

function renderMessages() {
  state.renderFrame = 0;
  const current = session();
  const distance = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight;
  const follow = distance < 140 || current.messages.some((message) => message.state === "streaming");
  const fragment = document.createDocumentFragment();
  if (!current.messages.length) {
    elements.empty.hidden = false;
    fragment.append(elements.empty);
  } else {
    elements.empty.hidden = true;
    for (const message of current.messages) fragment.append(renderMessage(message));
  }
  elements.messages.replaceChildren(fragment);
  const visible = current.messages.filter((message) => message.role !== "tool").length;
  elements.stats.textContent = `${visible} message${visible === 1 ? "" : "s"}`;
  if (follow) elements.messages.scrollTop = elements.messages.scrollHeight;
}

function scheduleRender() {
  if (!state.renderFrame) state.renderFrame = window.requestAnimationFrame(renderMessages);
}

function renderPendingAttachments() {
  const current = session();
  const map = new Map(current.attachments.map((item) => [item.id, item]));
  const fragment = document.createDocumentFragment();
  for (const id of current.pendingAttachmentIds) {
    const attachment = map.get(id);
    if (!attachment) continue;
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = attachment.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.addEventListener("click", () => removePendingAttachment(id));
    chip.append(label, remove);
    fragment.append(chip);
  }
  elements.pendingAttachments.replaceChildren(fragment);
}

function renderMcpList() {
  const fragment = document.createDocumentFragment();
  for (const server of state.workspace.integrations.mcpServers) {
    const card = document.createElement("div");
    card.className = "mcp-card";
    const head = document.createElement("div");
    head.className = "mcp-card-head";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = server.enabled;
    enabled.dataset.action = "toggle";
    enabled.dataset.serverId = server.id;
    enabled.setAttribute("aria-label", `Enable ${server.name}`);
    const name = document.createElement("strong");
    name.textContent = server.name;
    head.append(enabled, name);
    const detail = document.createElement("p");
    detail.className = "hint";
    const runtime = state.mcpStatus.get(server.id);
    detail.textContent = runtime?.message || `${server.tools.length} cached tool${server.tools.length === 1 ? "" : "s"} · not connected`;
    const url = document.createElement("p");
    url.className = "hint";
    url.textContent = server.url;
    const actions = document.createElement("div");
    actions.className = "mcp-card-actions";
    const connectButton = document.createElement("button");
    connectButton.type = "button";
    connectButton.dataset.action = "connect";
    connectButton.dataset.serverId = server.id;
    connectButton.textContent = state.mcpConnections.has(server.id) ? "Reconnect" : "Connect";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.dataset.action = "remove";
    remove.dataset.serverId = server.id;
    remove.textContent = "Remove";
    actions.append(connectButton, remove);
    card.append(head, detail, url, actions);
    fragment.append(card);
  }
  if (!state.workspace.integrations.mcpServers.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No MCP endpoints configured.";
    fragment.append(empty);
  }
  elements.mcpList.replaceChildren(fragment);
}

function updateToolCount() {
  const count = openAiTools(state.workspace.integrations, state.mcpConnections).length;
  elements.toolCount.textContent = `${count} browser tool${count === 1 ? "" : "s"}`;
}

function renderAll() {
  renderSessions();
  renderPendingAttachments();
  renderMcpList();
  updateToolCount();
  renderMessages();
}

function pruneAttachments(current) {
  const used = new Set(current.pendingAttachmentIds);
  for (const message of current.messages) for (const id of message.attachments ?? []) used.add(id);
  current.attachments = current.attachments.filter((attachment) => used.has(attachment.id));
}

function removePendingAttachment(id) {
  const current = session();
  current.pendingAttachmentIds = current.pendingAttachmentIds.filter((value) => value !== id);
  pruneAttachments(current);
  touchSession(current);
  renderPendingAttachments();
  queueSave();
}

async function addAttachments(files) {
  const target = session();
  if (!files.length) return;
  elements.attach.disabled = true;
  elements.attachmentStatus.hidden = false;
  try {
    for (const file of files) {
      elements.attachmentStatus.textContent = `Preparing ${file.name}…`;
      const attachment = await prepareAttachment(file, {
        onProgress: (message) => { elements.attachmentStatus.textContent = message; },
      });
      target.attachments.push(attachment);
      target.pendingAttachmentIds.push(attachment.id);
      touchSession(target);
      if (target.id === session().id) renderPendingAttachments();
      queueSave();
    }
    toast(`${files.length} file${files.length === 1 ? "" : "s"} attached`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not prepare attachment.", 5_000);
  } finally {
    elements.attachmentStatus.hidden = true;
    elements.attachmentStatus.textContent = "";
    elements.attach.disabled = false;
    elements.attachmentFiles.value = "";
  }
}

function requestBody(model, messages, parameters, tools) {
  const body = {
    model,
    messages,
    temperature: parameters.temperature,
    top_p: parameters.topP,
    max_tokens: parameters.maxTokens,
    chat_template_kwargs: { enable_thinking: parameters.enableThinking },
  };
  if (parameters.seed != null) body.seed = parameters.seed;
  if (parameters.reasoningEffort) body.reasoning_effort = parameters.reasoningEffort;
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return body;
}

function approveToolCall(call, signal) {
  if (state.workspace.integrations.approval === "always") return Promise.resolve(true);
  elements.toolDialogName.textContent = call.function.name;
  try { elements.toolDialogArguments.textContent = JSON.stringify(parseToolArguments(call.function.arguments), null, 2); }
  catch { elements.toolDialogArguments.textContent = call.function.arguments; }
  return new Promise((resolve) => {
    const close = () => {
      signal?.removeEventListener("abort", abort);
      resolve(elements.toolDialog.returnValue === "allow");
    };
    const abort = () => {
      if (elements.toolDialog.open) elements.toolDialog.close("deny");
    };
    elements.toolDialog.addEventListener("close", close, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    elements.toolDialog.showModal();
  });
}

async function runAssistantLoop(current, endpoint, model, controller) {
  let rounds = 0;
  let currentAssistant = null;
  let lastSaveAt = performance.now();
  while (!controller.signal.aborted) {
    const tools = openAiTools(state.workspace.integrations, state.mcpConnections);
    const outbound = apiMessages(current.messages, current.systemPrompt, current.attachments);
    currentAssistant = createMessage("assistant", "", { state: "streaming", meta: { model } });
    current.messages.push(currentAssistant);
    touchSession(current);
    if (current.id === session().id) renderMessages();

    const startedAt = performance.now();
    try {
      const result = await streamChatCompletion(
        endpoint,
        requestBody(model, outbound, current.parameters, tools),
        {
          signal: controller.signal,
          onDelta(delta) {
            currentAssistant.content += delta.content;
            currentAssistant.reasoning += delta.reasoning;
            if (delta.toolCalls) currentAssistant.toolCalls = structuredClone(delta.toolCalls);
            if (current.id === session().id) scheduleRender();
            if (performance.now() - lastSaveAt > 2_000) {
              lastSaveAt = performance.now();
              queueSave();
            }
          },
        },
      );
      currentAssistant.state = "complete";
      currentAssistant.toolCalls = structuredClone(result.toolCalls ?? []);
      currentAssistant.meta = {
        ...currentAssistant.meta,
        model: result.model || model,
        finishReason: result.finishReason,
        usage: result.usage,
        responseId: result.id,
        durationMs: performance.now() - startedAt,
      };
      currentAssistant.updatedAt = new Date().toISOString();
      state.connected = true;
      setConnection("connected", "Connected", `Last request completed through ${endpoint}.`);
    } catch (error) {
      currentAssistant.meta.durationMs = currentAssistant.meta.durationMs ?? performance.now() - startedAt;
      if (error?.name === "AbortError") {
        currentAssistant.state = "stopped";
        currentAssistant.meta.finishReason = "stopped";
        setConnection(state.connected ? "connected" : "idle", state.connected ? "Connected" : "Not connected");
      } else {
        currentAssistant.state = "error";
        currentAssistant.error = await connectionMessage(error);
        state.connected = false;
        setConnection("error", "Request failed", currentAssistant.error);
        if (error instanceof OpenAIEndpointError && error.code === "NETWORK_ERROR") elements.help.open = true;
      }
      break;
    }

    if (!currentAssistant.toolCalls.length) break;
    if (rounds >= state.workspace.integrations.maxToolRounds) {
      for (const call of currentAssistant.toolCalls) {
        current.messages.push(createMessage("tool", "Tool error: the configured tool-round limit was reached; this call was not executed.", {
          state: "error",
          toolCallId: call.id,
          name: call.function.name,
        }));
      }
      current.messages.push(createMessage("assistant", "", {
        state: "error",
        error: `Stopped after ${rounds} tool rounds. Raise the limit in Browser tools if this was intentional.`,
      }));
      break;
    }
    rounds += 1;
    for (const call of currentAssistant.toolCalls) {
      let content;
      let resultState = "complete";
      try {
        const allowed = await approveToolCall(call, controller.signal);
        if (!allowed) throw new Error("The user denied this tool call.");
        elements.attachmentStatus.hidden = false;
        elements.attachmentStatus.textContent = `Running ${call.function.name}…`;
        content = await executeTool(call, {
          attachments: current.attachments,
          integrations: state.workspace.integrations,
          mcpConnections: state.mcpConnections,
          signal: controller.signal,
          onProgress(status, progress) {
            const suffix = progress ? ` · ${Math.round(progress * 100)}%` : "";
            elements.attachmentStatus.textContent = `${call.function.name}: ${status}${suffix}`;
          },
        });
      } catch (error) {
        resultState = "error";
        content = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        elements.attachmentStatus.hidden = true;
      }
      current.messages.push(createMessage("tool", content, {
        state: resultState,
        toolCallId: call.id,
        name: call.function.name,
      }));
      touchSession(current);
      queueSave();
      if (current.id === session().id) renderMessages();
    }
  }
}

async function send(event) {
  event.preventDefault();
  if (state.request) return;
  syncSessionFromForm();
  syncIntegrationsFromForm();
  const current = session();
  const prompt = current.draft.trim();
  if (!prompt && !current.pendingAttachmentIds.length) return;
  let endpoint;
  try { endpoint = normalizeLocalEndpoint(current.endpoint); }
  catch (error) {
    setConnection("error", "Invalid endpoint", await connectionMessage(error));
    elements.help.open = true;
    return;
  }
  const model = current.model.trim();
  if (!model) {
    toast("Connect to discover a model, or enter its id manually.");
    elements.model.focus();
    return;
  }

  const user = createMessage("user", prompt, { attachments: [...current.pendingAttachmentIds] });
  current.messages.push(user);
  current.pendingAttachmentIds = [];
  current.draft = "";
  elements.prompt.value = "";
  touchSession(current);
  renderAll();
  queueSave();

  const controller = new AbortController();
  state.request = { controller, sessionId: current.id };
  elements.send.disabled = true;
  elements.stop.disabled = false;
  setConnection("connecting", state.connected ? "Generating…" : "Contacting local model…");
  try {
    await runAssistantLoop(current, endpoint, model, controller);
  } finally {
    state.request = null;
    elements.send.disabled = false;
    elements.stop.disabled = true;
    touchSession(current);
    renderAll();
    queueSave();
    elements.prompt.focus();
  }
}

function stop() {
  state.request?.controller.abort();
}

function openEdit(messageIdValue) {
  const message = session().messages.find((item) => item.id === messageIdValue);
  if (!message) return;
  state.editMessageId = messageIdValue;
  elements.editContent.value = message.content;
  elements.editDialog.showModal();
  elements.editContent.focus();
}

function saveEdit() {
  const message = session().messages.find((item) => item.id === state.editMessageId);
  if (!message) return;
  message.content = elements.editContent.value;
  message.updatedAt = new Date().toISOString();
  message.meta = { ...message.meta, edited: true };
  message.error = "";
  if (message.state === "error") message.state = "complete";
  touchSession(session());
  elements.editDialog.close("save");
  renderAll();
  queueSave();
}

function repairToolHistory(current) {
  const callIds = new Set();
  for (const message of current.messages) for (const call of message.toolCalls ?? []) callIds.add(call.id);
  current.messages = current.messages.filter((message) => message.role !== "tool" || callIds.has(message.toolCallId));
  const resultIds = new Set(current.messages.filter((message) => message.role === "tool").map((message) => message.toolCallId));
  for (const message of current.messages) {
    if (message.role === "assistant" && message.toolCalls?.length) message.toolCalls = message.toolCalls.filter((call) => resultIds.has(call.id));
  }
}

function deleteMessage(id) {
  const current = session();
  const message = current.messages.find((item) => item.id === id);
  if (!message || !window.confirm(`Delete this ${message.role} turn from future model context?`)) return;
  const removedCalls = new Set(message.toolCalls?.map((call) => call.id) ?? []);
  current.messages = current.messages.filter((item) => item.id !== id && !removedCalls.has(item.toolCallId));
  repairToolHistory(current);
  pruneAttachments(current);
  touchSession(current);
  renderAll();
  queueSave();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportState() {
  syncSessionFromForm();
  syncIntegrationsFromForm();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  download(`llm-state-${stamp}.json`, `${JSON.stringify(workspaceDocument(state.workspace), null, 2)}\n`, "application/json");
  toast("Complete workspace state exported");
}

function exportActiveMarkdown() {
  syncSessionFromForm();
  const title = session().title.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "chat";
  download(`${title}.md`, conversationMarkdown(session()), "text/markdown;charset=utf-8");
  toast("Conversation Markdown exported");
}

async function importState(file) {
  if (!file) return;
  if (state.request) { toast("Stop the current generation before importing state."); return; }
  try {
    const source = JSON.parse(await file.text());
    for (const connection of state.mcpConnections.values()) await connection.client.close();
    state.mcpConnections.clear();
    state.mcpStatus.clear();
    if (source?.schema === WORKSPACE_SCHEMA) {
      state.workspace = parseWorkspaceDocument(source);
      toast(`Restored ${state.workspace.sessions.length} session${state.workspace.sessions.length === 1 ? "" : "s"}`);
    } else {
      const imported = sessionFromConversation(source);
      state.workspace.sessions.push(imported);
      state.workspace.activeSessionId = imported.id;
      toast(`Imported ${imported.messages.length} messages as a new session`);
    }
    writeIntegrations();
    loadSessionIntoForm();
    renderAll();
    await persist.flush();
    queueSave();
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not import state JSON.", 5_000);
  } finally {
    elements.importFile.value = "";
  }
}

async function connectMcp(server) {
  state.mcpStatus.set(server.id, { state: "connecting", message: "Discovering tools…" });
  renderMcpList();
  try {
    const previous = state.mcpConnections.get(server.id);
    await previous?.client.close();
    const client = new McpHttpClient(server.url);
    const tools = await client.connect();
    server.url = client.url;
    server.protocolVersion = client.protocolVersion;
    server.serverInfo = client.serverInfo;
    server.tools = tools.map((tool) => ({
      name: tool.name,
      title: tool.title || "",
      description: tool.description || "",
      inputSchema: tool.inputSchema || { type: "object", properties: {} },
      annotations: tool.annotations || {},
    }));
    state.mcpConnections.set(server.id, { server, client, tools: server.tools });
    state.mcpStatus.set(server.id, { state: "connected", message: `${tools.length} tool${tools.length === 1 ? "" : "s"} · MCP ${client.protocolVersion}` });
    queueSave();
    toast(`${server.name}: ${tools.length} tool${tools.length === 1 ? "" : "s"} discovered`);
  } catch (error) {
    state.mcpConnections.delete(server.id);
    state.mcpStatus.set(server.id, { state: "error", message: error instanceof Error ? error.message : "MCP connection failed" });
    toast(`${server.name}: ${error instanceof Error ? error.message : "MCP connection failed"}`, 5_000);
  } finally {
    renderMcpList();
    updateToolCount();
  }
}

async function addMcp() {
  const url = elements.mcpUrl.value.trim();
  if (!url) { elements.mcpUrl.focus(); return; }
  const server = {
    id: messageId("mcp"),
    name: elements.mcpName.value.trim() || `MCP ${state.workspace.integrations.mcpServers.length + 1}`,
    url,
    enabled: true,
    protocolVersion: "",
    serverInfo: null,
    tools: [],
  };
  try {
    server.url = new McpHttpClient(server.url).url;
  } catch (error) {
    toast(error instanceof Error ? error.message : "Invalid local MCP URL", 5_000);
    return;
  }
  state.workspace.integrations.mcpServers.push(server);
  elements.mcpName.value = "";
  elements.mcpUrl.value = "";
  queueSave();
  renderMcpList();
  await connectMcp(server);
}

async function mcpAction(target) {
  const id = target.dataset.serverId;
  const server = state.workspace.integrations.mcpServers.find((item) => item.id === id);
  if (!server) return;
  if (target.dataset.action === "connect") await connectMcp(server);
  if (target.dataset.action === "toggle") {
    server.enabled = target.checked;
    queueSave();
    updateToolCount();
  }
  if (target.dataset.action === "remove") {
    if (!window.confirm(`Remove MCP endpoint “${server.name}”?`)) return;
    await state.mcpConnections.get(id)?.client.close();
    state.mcpConnections.delete(id);
    state.mcpStatus.delete(id);
    state.workspace.integrations.mcpServers = state.workspace.integrations.mcpServers.filter((item) => item.id !== id);
    renderMcpList();
    updateToolCount();
    queueSave();
  }
}

async function verifyFirecrawl() {
  syncIntegrationsFromForm();
  elements.testFirecrawl.disabled = true;
  elements.firecrawlStatus.textContent = "Testing local /v2/search…";
  try {
    await testFirecrawl(state.workspace.integrations.firecrawl.url);
    elements.firecrawlStatus.textContent = "Reachable; search returned a valid response.";
    toast("Firecrawl is reachable");
  } catch (error) {
    elements.firecrawlStatus.textContent = error instanceof Error ? error.message : "Firecrawl test failed.";
    toast(elements.firecrawlStatus.textContent, 5_000);
  } finally {
    elements.testFirecrawl.disabled = false;
    queueSave();
  }
}

function handleSessionFormInput() {
  syncSessionFromForm();
  renderSessions();
  queueSave();
}

function handleIntegrationInput() {
  syncIntegrationsFromForm();
  updateToolCount();
  queueSave();
}

elements.connect.addEventListener("click", connect);
elements.newChat.addEventListener("click", newSession);
elements.renameChat.addEventListener("click", renameSession);
elements.deleteChat.addEventListener("click", deleteSession);
elements.sessions.addEventListener("click", (event) => {
  const target = event.target.closest("[data-session-id]");
  if (target) switchSession(target.dataset.sessionId);
});
elements.composer.addEventListener("submit", send);
elements.stop.addEventListener("click", stop);
elements.attach.addEventListener("click", () => elements.attachmentFiles.click());
elements.attachmentFiles.addEventListener("change", () => addAttachments([...elements.attachmentFiles.files]));
elements.exportButton.addEventListener("click", exportState);
elements.exportMarkdown.addEventListener("click", exportActiveMarkdown);
elements.printChat.addEventListener("click", () => window.print());
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", () => importState(elements.importFile.files?.[0]));
elements.saveEdit.addEventListener("click", (event) => { event.preventDefault(); saveEdit(); });
elements.addMcp.addEventListener("click", addMcp);
elements.mcpList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (target && target.type !== "checkbox") mcpAction(target);
});
elements.mcpList.addEventListener("change", (event) => {
  const target = event.target.closest("[data-action='toggle']");
  if (target) mcpAction(target);
});
elements.testFirecrawl.addEventListener("click", verifyFirecrawl);
elements.prompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

for (const input of [
  elements.endpoint, elements.model, elements.systemPrompt, elements.temperature, elements.topP,
  elements.maxTokens, elements.seed, elements.reasoningEffort, elements.enableThinking, elements.prompt,
]) input.addEventListener("input", handleSessionFormInput);
for (const input of [
  elements.approval, elements.maxToolRounds, elements.ocrEnabled, elements.firecrawlEnabled,
  elements.firecrawlUrl, elements.firecrawlLimit,
]) input.addEventListener("input", handleIntegrationInput);

window.addEventListener("pagehide", () => persist.flush());

async function bootstrap() {
  try {
    const stored = await loadWorkspace();
    if (stored) state.workspace = parseWorkspaceDocument(stored);
    state.storageReady = true;
    elements.storageStatus.textContent = stored ? "Restored from this browser." : "Saved automatically in this browser.";
  } catch (error) {
    state.workspace = createWorkspace();
    elements.storageStatus.textContent = `Browser persistence unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  writeIntegrations();
  loadSessionIntoForm();
  renderAll();
  if (state.storageReady) queueSave();
}

bootstrap();

export { conversationDocument };
