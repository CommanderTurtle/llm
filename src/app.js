import { formatAttachmentSize, prepareAttachment } from "./attachments.js";
import {
  compactionEnvelope,
  createContextResource,
  resourceIndex,
  sessionContextStats,
  timelineMarkdown,
} from "./context.js";
import {
  createBrowserDocument,
  diffRevision,
  hashlineDocument,
  languageFromName,
  lintDocument,
  putBrowserDocument,
} from "./documents.js";
import { testFirecrawl } from "./firecrawl.js";
import { downscaleImageOverrides, isImageSizeError } from "./image-retry.js";
import {
  endpointResource,
  localNetworkPermissionNameForEndpoint,
  localNetworkPermissionState,
  normalizeLocalEndpoint,
  targetAddressSpaceForEndpoint,
} from "./local-endpoint.js";
import { copyText, renderMarkdown } from "./markdown.js";
import { McpHttpClient } from "./mcp.js";
import { discoverModelCatalog, OpenAIEndpointError, streamChatCompletion } from "./openai.js";
import { markdownShareUrl } from "./share.js";
import { loadWorkspace, makeDebouncedSaver, saveWorkspace } from "./storage.js";
import {
  apiMessages,
  conversationDocument,
  conversationMarkdown,
  createMessage,
  messageId,
  normalizeParameters,
} from "./transcript.js";
import {
  CONTEXT_TOOL_NAME,
  executeTool,
  openAiTools,
  parseToolArguments,
  PUT_DOCUMENT_TOOL_NAME,
  PUT_INSTRUCTIONS_TOOL_NAME,
  READ_DOCUMENT_TOOL_NAME,
  READ_INSTRUCTIONS_TOOL_NAME,
  TODO_TOOL_NAME,
} from "./tools.js";
import {
  activeSession,
  createSession,
  createWorkspace,
  FEATURE_KEYS,
  LEGACY_WORKSPACE_SCHEMA,
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
  contextWindowLabel: document.querySelector("#context-window-label"),
  contextWindow: document.querySelector("#context-window"),
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
  copyMarkdown: document.querySelector("#copy-markdown"),
  shareMarkdown: document.querySelector("#share-markdown"),
  undo: document.querySelector("#undo"),
  openWorkspace: document.querySelector("#open-workspace"),
  contextMeter: document.querySelector("#context-meter"),
  contextRing: document.querySelector("#context-ring"),
  contextPercent: document.querySelector("#context-percent"),
  printChat: document.querySelector("#print-chat"),
  approval: document.querySelector("#tool-approval"),
  maxToolRounds: document.querySelector("#max-tool-rounds"),
  ocrEnabled: document.querySelector("#ocr-enabled"),
  readToolsEnabled: document.querySelector("#read-tools-enabled"),
  writeToolsEnabled: document.querySelector("#write-tools-enabled"),
  todoToolsEnabled: document.querySelector("#todo-tools-enabled"),
  featureStreamRecovery: document.querySelector("#feature-stream-recovery"),
  featureAutoMaxTokens: document.querySelector("#feature-auto-max-tokens"),
  featureRichMarkdown: document.querySelector("#feature-rich-markdown"),
  featureParallelSessions: document.querySelector("#feature-parallel-sessions"),
  featureMarkdownActions: document.querySelector("#feature-markdown-actions"),
  featureVisionRetry: document.querySelector("#feature-vision-retry"),
  featureStableScroll: document.querySelector("#feature-stable-scroll"),
  featureContextMeter: document.querySelector("#feature-context-meter"),
  featureCompaction: document.querySelector("#feature-compaction"),
  featureUndoDelete: document.querySelector("#feature-undo-delete"),
  featureEnableAll: document.querySelector("#feature-enable-all"),
  featureDisableAll: document.querySelector("#feature-disable-all"),
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
  contextDialog: document.querySelector("#context-dialog"),
  contextDetail: document.querySelector("#context-detail"),
  contextTimeline: document.querySelector("#context-timeline"),
  compactionControls: document.querySelector("#compaction-controls"),
  compactSoft: document.querySelector("#compact-soft"),
  compactNormal: document.querySelector("#compact-normal"),
  restoreContext: document.querySelector("#restore-context"),
  compactionPrompt: document.querySelector("#compaction-prompt"),
  compactionMessages: document.querySelector("#compaction-messages"),
  activeCompaction: document.querySelector("#active-compaction"),
  selectOlderContext: document.querySelector("#select-older-context"),
  closeContext: document.querySelector("#close-context"),
  workspaceDialog: document.querySelector("#workspace-dialog"),
  closeWorkspace: document.querySelector("#close-workspace"),
  todoList: document.querySelector("#todo-list"),
  todoWorkspaceSection: document.querySelector("#todo-workspace-section"),
  todoInput: document.querySelector("#todo-input"),
  addTodo: document.querySelector("#add-todo"),
  documentSelect: document.querySelector("#document-select"),
  newDocument: document.querySelector("#new-document"),
  openInstructions: document.querySelector("#open-instructions"),
  documentRevision: document.querySelector("#document-revision"),
  documentName: document.querySelector("#document-name"),
  documentLanguage: document.querySelector("#document-language"),
  documentContent: document.querySelector("#document-content"),
  documentDiagnostics: document.querySelector("#document-diagnostics"),
  saveDocument: document.querySelector("#save-document"),
  documentDiff: document.querySelector("#document-diff"),
  documentPreview: document.querySelector("#document-preview"),
  documentWorkspaceSection: document.querySelector("#document-workspace-section"),
  toast: document.querySelector("#toast"),
};

const state = {
  workspace: createWorkspace(),
  models: [],
  modelCatalog: [],
  requests: new Map(),
  readReceipts: new Map(),
  connected: false,
  renderFrame: 0,
  toastTimer: 0,
  editMessageId: "",
  mcpConnections: new Map(),
  mcpStatus: new Map(),
  storageReady: false,
  selectedDocumentId: "",
  approvalTail: Promise.resolve(),
};

const featureControls = {
  streamRecovery: elements.featureStreamRecovery,
  autoMaxTokens: elements.featureAutoMaxTokens,
  richMarkdown: elements.featureRichMarkdown,
  parallelSessions: elements.featureParallelSessions,
  markdownActions: elements.featureMarkdownActions,
  visionRetry: elements.featureVisionRetry,
  stableScroll: elements.featureStableScroll,
  contextMeter: elements.featureContextMeter,
  compaction: elements.featureCompaction,
  readTools: elements.readToolsEnabled,
  writeTools: elements.writeToolsEnabled,
  todoTool: elements.todoToolsEnabled,
  undoDelete: elements.featureUndoDelete,
};

function featureEnabled(name) {
  return state.workspace.integrations.features?.[name] === true;
}

function deriveLocalTools() {
  const features = state.workspace.integrations.features;
  state.workspace.integrations.localTools = {
    context: features.readTools || features.compaction,
    read: features.readTools,
    write: features.readTools && features.writeTools,
    todos: features.todoTool,
  };
}

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

function requestFor(sessionId = session().id) {
  return state.requests.get(sessionId) ?? null;
}

function updateGenerationControls() {
  const active = featureEnabled("parallelSessions") ? requestFor() : state.requests.values().next().value ?? null;
  elements.send.disabled = Boolean(active);
  elements.stop.disabled = !active;
  elements.prompt.disabled = Boolean(active);
  elements.stop.title = active ? "Stop this chat's generation" : "This chat is idle";
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
    maxTokens: featureEnabled("autoMaxTokens") ? null : (elements.maxTokens.value || 8192),
    contextWindow: elements.contextWindow.value,
    seed: elements.seed.value,
    reasoningEffort: elements.reasoningEffort.value,
    enableThinking: elements.enableThinking.checked,
  });
}

function writeParameters(parameters) {
  const value = normalizeParameters(parameters);
  elements.temperature.value = String(value.temperature);
  elements.topP.value = String(value.topP);
  elements.maxTokens.value = featureEnabled("autoMaxTokens") ? "" : String(value.maxTokens ?? 8192);
  elements.contextWindow.value = String(value.contextWindow);
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
  integrations.features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, featureControls[key].checked]));
  if (integrations.features.writeTools && !integrations.features.readTools) {
    integrations.features.readTools = true;
    elements.readToolsEnabled.checked = true;
  }
  deriveLocalTools();
  integrations.firecrawl.enabled = elements.firecrawlEnabled.checked;
  integrations.firecrawl.url = elements.firecrawlUrl.value.trim() || "http://localhost:3002";
  integrations.firecrawl.limit = Math.max(1, Math.min(10, Math.trunc(Number(elements.firecrawlLimit.value) || 5)));
}

function writeIntegrations() {
  const integrations = state.workspace.integrations;
  elements.approval.value = integrations.approval;
  elements.maxToolRounds.value = String(integrations.maxToolRounds);
  elements.ocrEnabled.checked = integrations.ocr.enabled;
  for (const key of FEATURE_KEYS) featureControls[key].checked = integrations.features[key];
  deriveLocalTools();
  elements.firecrawlEnabled.checked = integrations.firecrawl.enabled;
  elements.firecrawlUrl.value = integrations.firecrawl.url;
  elements.firecrawlLimit.value = String(integrations.firecrawl.limit);
  elements.firecrawlStatus.textContent = integrations.firecrawl.enabled ? "Enabled; test when the service is running." : "Disabled.";
  applyFeatureVisibility();
}

function applyFeatureVisibility() {
  const hasWorkspace = featureEnabled("todoTool") || featureEnabled("readTools") || featureEnabled("writeTools");
  const hasContext = featureEnabled("contextMeter") || featureEnabled("compaction");
  elements.copyMarkdown.hidden = !featureEnabled("markdownActions");
  elements.shareMarkdown.hidden = !featureEnabled("markdownActions");
  elements.undo.hidden = !featureEnabled("undoDelete");
  elements.openWorkspace.hidden = !hasWorkspace;
  elements.contextMeter.hidden = !hasContext;
  elements.contextWindowLabel.hidden = !hasContext;
  elements.contextWindow.hidden = !hasContext;
  elements.compactionControls.hidden = !featureEnabled("compaction");
  elements.todoWorkspaceSection.hidden = !featureEnabled("todoTool");
  elements.documentWorkspaceSection.hidden = !(featureEnabled("readTools") || featureEnabled("writeTools"));
  elements.maxTokens.disabled = featureEnabled("autoMaxTokens");
  elements.maxTokens.placeholder = featureEnabled("autoMaxTokens") ? "Auto" : "";
  elements.undo.disabled = !featureEnabled("undoDelete") || !(session().undo?.length);
}

function loadSessionIntoForm() {
  const current = session();
  elements.endpoint.value = current.endpoint;
  elements.model.value = current.model;
  elements.systemPrompt.value = current.systemPrompt;
  elements.prompt.value = current.draft;
  writeParameters(current.parameters);
  state.models = [];
  state.modelCatalog = [];
  state.connected = false;
  state.selectedDocumentId = current.documents[0]?.id ?? "";
  applyFeatureVisibility();
  populateModels([]);
  if (requestFor(current.id)) setConnection("connecting", "Generating…", "This chat continues generating independently in the browser.");
  else setConnection("idle", "Not connected", "Switching or importing a session never makes a network request.");
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

async function connectionMessage(error, endpointValue = elements.endpoint.value) {
  const message = error instanceof Error ? error.message : String(error);
  const notes = [];
  try {
    const endpoint = normalizeLocalEndpoint(endpointValue);
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
    const catalog = await discoverModelCatalog(endpoint);
    const models = catalog.map((item) => item.id);
    state.models = models;
    state.modelCatalog = catalog;
    state.connected = true;
    populateModels(models);
    session().model = elements.model.value.trim();
    const discoveredWindow = catalog.find((item) => item.id === session().model)?.contextWindow;
    if (discoveredWindow && (featureEnabled("contextMeter") || featureEnabled("compaction"))) {
      session().parameters.contextWindow = discoveredWindow;
      elements.contextWindow.value = String(discoveredWindow);
    }
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
  const context = featureEnabled("contextMeter") ? ` · ~${sessionContextStats(value, projectedMessages(value)).tokens.toLocaleString()} tokens` : "";
  return `${count} message${count === 1 ? "" : "s"}${context}${time ? ` · ${time}` : ""}`;
}

function renderSessions() {
  const fragment = document.createDocumentFragment();
  const sorted = [...state.workspace.sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const item of sorted) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-item";
    button.dataset.sessionId = item.id;
    if (featureEnabled("parallelSessions")) button.dataset.generating = String(state.requests.has(item.id));
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
  if (!featureEnabled("parallelSessions") && state.requests.size) { toast("Stop the current generation before switching chats."); return; }
  if (id === state.workspace.activeSessionId) return;
  syncSessionFromForm();
  state.workspace.activeSessionId = id;
  loadSessionIntoForm();
  renderAll();
  updateGenerationControls();
  queueSave();
}

function newSession() {
  if (!featureEnabled("parallelSessions") && state.requests.size) { toast("Stop the current generation before starting another chat."); return; }
  syncSessionFromForm();
  const created = createSession();
  if (featureEnabled("autoMaxTokens")) created.parameters.maxTokens = null;
  state.workspace.sessions.push(created);
  state.workspace.activeSessionId = created.id;
  loadSessionIntoForm();
  renderAll();
  updateGenerationControls();
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
  if (!featureEnabled("parallelSessions") && state.requests.size) { toast("Stop the current generation before deleting this chat."); return; }
  const current = session();
  if (state.requests.has(current.id)) { toast("Stop this chat's generation before deleting it."); return; }
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
  if (message.state === "interrupted") parts.push("interrupted");
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
  const resource = featureEnabled("compaction") && message.meta?.resourceId
    ? current.resources.find((item) => item.id === message.meta.resourceId)
    : null;
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.messageId = message.id;
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

  if (featureEnabled("streamRecovery")
      && message.role === "assistant"
      && message.state === "interrupted"
      && current.messages.at(-1)?.id === message.id) {
    const resume = document.createElement("button");
    resume.type = "button";
    resume.textContent = "Continue";
    resume.addEventListener("click", () => continueMessage(message.id));
    actions.append(resume);
  }

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
    details.dataset.viewKey = "reasoning";
    details.open = message.state === "streaming" && !message.content;
    const summary = document.createElement("summary");
    summary.textContent = `Reasoning · ${message.reasoning.length.toLocaleString()} characters`;
    const pre = document.createElement("pre");
    pre.textContent = message.reasoning;
    details.append(summary, pre);
    article.append(details);
  }

  for (const [callIndex, call] of (message.toolCalls ?? []).entries()) {
    const details = document.createElement("details");
    details.className = "tool-call";
    details.dataset.viewKey = `tool-${callIndex}`;
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
  const displayedContent = resource ? resourceIndex(resource) : message.content;
  if (displayedContent) {
    if (message.role === "assistant" || message.role === "tool") {
      body.append(renderMarkdown(displayedContent, {
        rich: featureEnabled("richMarkdown"),
        diagrams: message.state !== "streaming",
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
    waiting.textContent = message.reasoning ? "Waiting for final answer…" : message.toolCalls?.length ? "Preparing tool call…" : "Waiting for model…";
    body.append(waiting);
  }
  article.append(body);

  if (resource && resource.sections.length > 1) {
    const list = document.createElement("div");
    list.className = "resource-sections";
    resource.sections.forEach((section, index) => {
      const details = document.createElement("details");
      details.dataset.viewKey = `resource-${resource.id}-${index}`;
      const summary = document.createElement("summary");
      summary.textContent = `Section ${index + 1} · ${section.length.toLocaleString()} characters`;
      const content = document.createElement("div");
      content.className = "message-body";
      content.append(renderMarkdown(section, { rich: featureEnabled("richMarkdown"), diagrams: false, onCopy: (ok) => ok && toast("Code copied") }));
      details.append(summary, content);
      list.append(details);
    });
    article.append(list);
  }

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
  const preserveScroll = featureEnabled("stableScroll");
  const follow = preserveScroll
    ? distance < 140
    : distance < 140 || current.messages.some((message) => message.state === "streaming");
  const previousScrollTop = elements.messages.scrollTop;
  const disclosureState = new Map();
  if (preserveScroll) {
    for (const article of elements.messages.querySelectorAll("article[data-message-id]")) {
      for (const details of article.querySelectorAll("details[data-view-key]")) {
        const pre = details.querySelector("pre");
        disclosureState.set(`${article.dataset.messageId}:${details.dataset.viewKey}`, {
          open: details.open,
          scrollTop: pre?.scrollTop ?? 0,
          scrollLeft: pre?.scrollLeft ?? 0,
        });
      }
    }
  }
  const fragment = document.createDocumentFragment();
  if (!current.messages.length) {
    elements.empty.hidden = false;
    fragment.append(elements.empty);
  } else {
    elements.empty.hidden = true;
    for (const message of current.messages) fragment.append(renderMessage(message));
  }
  elements.messages.replaceChildren(fragment);
  if (preserveScroll) {
    for (const article of elements.messages.querySelectorAll("article[data-message-id]")) {
      for (const details of article.querySelectorAll("details[data-view-key]")) {
        const saved = disclosureState.get(`${article.dataset.messageId}:${details.dataset.viewKey}`);
        if (!saved) continue;
        details.open = saved.open;
        const pre = details.querySelector("pre");
        if (pre) { pre.scrollTop = saved.scrollTop; pre.scrollLeft = saved.scrollLeft; }
      }
    }
  }
  const visible = current.messages.filter((message) => message.role !== "tool").length;
  elements.stats.textContent = `${visible} message${visible === 1 ? "" : "s"}`;
  if (follow) elements.messages.scrollTop = elements.messages.scrollHeight;
  else if (preserveScroll) elements.messages.scrollTop = previousScrollTop;
  if (featureEnabled("contextMeter") || featureEnabled("compaction")) renderContextMeter();
}

function activeCompactionFor(current) {
  if (!featureEnabled("compaction")) return null;
  return (current.compactions ?? []).find((item) => item.id === current.activeCompactionId && item.active) ?? null;
}

function projectionOptions(current, imageOverrides = new Map(), reasoningMessageIds = new Set()) {
  const compaction = activeCompactionFor(current);
  const resourceIndexes = featureEnabled("compaction")
    ? new Map((current.resources ?? []).map((resource) => [resource.id, resourceIndex(resource)]))
    : new Map();
  return {
    imageOverrides,
    resourceIndexes,
    reasoningMessageIds,
    compactedMessageIds: compaction?.messageIds ?? [],
    compactionEnvelope: compactionEnvelope(compaction, current.messages),
    preserveToolReasoning: featureEnabled("streamRecovery"),
  };
}

function projectedMessages(current, imageOverrides = new Map(), reasoningMessageIds = new Set()) {
  return apiMessages(current.messages, current.systemPrompt, current.attachments, projectionOptions(current, imageOverrides, reasoningMessageIds));
}

function renderContextMeter() {
  if (!featureEnabled("contextMeter") && !featureEnabled("compaction")) return;
  const current = session();
  const stats = sessionContextStats(current, projectedMessages(current));
  const shown = Math.min(100, Math.round(stats.percent));
  elements.contextRing.style.setProperty("--context", `${shown}%`);
  elements.contextPercent.textContent = `${shown}%`;
  elements.contextMeter.title = `${stats.tokens.toLocaleString()} estimated tokens of ${stats.contextWindow.toLocaleString()} · open context controls`;
}

function maybeOfferCompaction(current) {
  if (!featureEnabled("compaction")) return;
  if (activeCompactionFor(current)) return;
  const stats = sessionContextStats(current, projectedMessages(current));
  if (stats.percent < 80 || current.contextOfferAt === current.messages.length) return;
  current.contextOfferAt = current.messages.length;
  if (current.id === session().id) toast(`Context is about ${Math.round(stats.percent)}% full. Open the context ring to choose Soft or Normal compaction.`, 7_000);
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
  applyFeatureVisibility();
  renderSessions();
  renderPendingAttachments();
  renderMcpList();
  updateToolCount();
  renderMessages();
  elements.undo.disabled = !featureEnabled("undoDelete") || !(session().undo?.length);
  updateGenerationControls();
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
    chat_template_kwargs: { enable_thinking: parameters.enableThinking },
  };
  if (parameters.maxTokens != null) body.max_tokens = parameters.maxTokens;
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
  const show = () => new Promise((resolve) => {
    if (signal?.aborted) { resolve(false); return; }
    elements.toolDialogName.textContent = call.function.name;
    try { elements.toolDialogArguments.textContent = JSON.stringify(parseToolArguments(call.function.arguments), null, 2); }
    catch { elements.toolDialogArguments.textContent = call.function.arguments; }
    elements.toolDialog.returnValue = "";
    const close = () => {
      signal?.removeEventListener("abort", abort);
      resolve(elements.toolDialog.returnValue === "allow");
    };
    const abort = () => {
      if (elements.toolDialog.open) elements.toolDialog.close("deny");
      else resolve(false);
    };
    elements.toolDialog.addEventListener("close", close, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    elements.toolDialog.showModal();
  });
  const queued = state.approvalTail.then(show, show);
  state.approvalTail = queued.catch(() => false);
  return queued;
}

function todoMarkdown(current) {
  if (!current.todos.length) return "The TODO checklist is empty.";
  return current.todos.map((item) => `- [${item.done ? "x" : " "}] ${item.text} <!-- ${item.id} -->`).join("\n");
}

function receiptKey(current, documentValue) {
  return `${current.id}:${documentValue.id}`;
}

function findDocument(current, name) {
  const normalized = String(name || "").trim().toLowerCase();
  return current.documents.find((item) => item.name.toLowerCase() === normalized) ?? null;
}

function executeBrowserTool(current, name, args) {
  if (name === TODO_TOOL_NAME) {
    const action = args.action || "list";
    if (action === "list") return todoMarkdown(current);
    if (action === "add") {
      if (!String(args.text || "").trim()) throw new Error("todo_update add requires text.");
      current.todos.push({ id: messageId("todo"), text: String(args.text).trim(), done: args.done === true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    } else {
      const item = current.todos.find((candidate) => candidate.id === args.id);
      if (!item) throw new Error(`TODO ${args.id || "(missing id)"} was not found.`);
      if (action === "remove") current.todos = current.todos.filter((candidate) => candidate.id !== item.id);
      else if (action === "set") {
        if (typeof args.text === "string" && args.text.trim()) item.text = args.text.trim();
        if (typeof args.done === "boolean") item.done = args.done;
        item.updatedAt = new Date().toISOString();
      } else throw new Error(`Unknown TODO action ${action}.`);
    }
    touchSession(current);
    queueSave();
    if (current.id === session().id) renderWorkspaceDialog();
    return todoMarkdown(current);
  }

  if (name === CONTEXT_TOOL_NAME) {
    if (args.kind === "timeline") return timelineMarkdown(current);
    if (args.kind === "message" || args.kind === "reasoning") {
      const message = current.messages.find((item) => item.id === args.id);
      if (!message) throw new Error(`Message ${args.id || "(missing id)"} was not found.`);
      if (args.kind === "reasoning") return message.reasoning || "This message has no stored reasoning.";
      const resource = message.meta?.resourceId ? current.resources.find((item) => item.id === message.meta.resourceId) : null;
      if (resource) return resourceIndex(resource);
      return JSON.stringify({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.reasoning ? { reasoningAvailable: true } : {}),
        ...(message.name ? { tool: message.name } : {}),
        state: message.state,
      }, null, 2);
    }
    if (args.kind === "compaction") {
      const compaction = current.compactions.find((item) => item.id === args.id) ?? activeCompactionFor(current);
      if (!compaction) throw new Error("No matching compaction exists.");
      return `${compactionEnvelope(compaction, current.messages)}\n\nExact entries are available individually with context_read kind=message.`;
    }
    if (args.kind === "resource") {
      const resource = current.resources.find((item) => item.id === args.id);
      if (!resource) throw new Error(`Resource ${args.id || "(missing id)"} was not found.`);
      const section = Math.trunc(Number(args.section) || 1);
      if (section < 1 || section > resource.sections.length) throw new Error(`Resource ${resource.id} has sections 1-${resource.sections.length}.`);
      return `# ${resource.name} · section ${section}/${resource.sections.length}\n\n${resource.sections[section - 1]}`;
    }
    throw new Error(`Unsupported context kind ${args.kind}.`);
  }

  const instructions = name === READ_INSTRUCTIONS_TOOL_NAME || name === PUT_INSTRUCTIONS_TOOL_NAME;
  if (name === READ_DOCUMENT_TOOL_NAME || name === READ_INSTRUCTIONS_TOOL_NAME) {
    const documentValue = findDocument(current, instructions ? "instructions.md" : args.name);
    if (!documentValue) return `${instructions ? "instructions.md" : args.name} does not exist yet.`;
    state.readReceipts.set(receiptKey(current, documentValue), documentValue.revision);
    return hashlineDocument(documentValue);
  }
  if (name === PUT_DOCUMENT_TOOL_NAME || name === PUT_INSTRUCTIONS_TOOL_NAME) {
    const documentName = instructions ? "instructions.md" : args.name;
    if (!String(documentName || "").trim()) throw new Error("put_document requires a document name.");
    const existing = findDocument(current, documentName);
    const next = putBrowserDocument(existing, { ...args, name: documentName }, {
      readRevision: existing ? state.readReceipts.get(receiptKey(current, existing)) : null,
      actor: "model",
    });
    if (existing) current.documents.splice(current.documents.indexOf(existing), 1, next);
    else current.documents.push(next);
    state.readReceipts.delete(receiptKey(current, next));
    touchSession(current);
    queueSave();
    if (current.id === session().id) {
      state.selectedDocumentId = next.id;
      renderWorkspaceDialog();
    }
    const diagnostics = lintDocument(next.content, next.language);
    return `PUT ${next.name} revision ${next.revision} (${next.content.length} characters). ${diagnostics.length ? `${diagnostics.length} lint diagnostic(s); read the new revision for exact locations.` : "No lint diagnostics."}`;
  }
  throw new Error(`No browser-local handler exists for ${name}.`);
}

async function runAssistantLoop(current, endpoint, model, controller, options = {}) {
  let rounds = 0;
  let currentAssistant = null;
  let lastSaveAt = performance.now();
  let imageOverrides = new Map();
  let continuationTarget = options.continuationTarget ?? null;
  while (!controller.signal.aborted) {
    const tools = openAiTools(state.workspace.integrations, state.mcpConnections);
    const continuing = continuationTarget;
    const continuationReasoningIds = continuing?.reasoning ? new Set([continuing.id]) : new Set();
    const outbound = projectedMessages(current, imageOverrides, continuationReasoningIds);
    if (continuationTarget) {
      outbound.push({
        role: "user",
        content: "Continue exactly where the interrupted response ended. Do not repeat completed text. Finish the answer or intended tool action.",
      });
      currentAssistant = continuationTarget;
      currentAssistant.state = "streaming";
      currentAssistant.error = "";
      currentAssistant.meta = { ...currentAssistant.meta, resumed: (currentAssistant.meta?.resumed ?? 0) + 1 };
      continuationTarget = null;
    } else {
      currentAssistant = createMessage("assistant", "", { state: "streaming", meta: { model } });
      current.messages.push(currentAssistant);
    }
    touchSession(current);
    if (current.id === session().id) renderMessages();

    const startedAt = performance.now();
    try {
      let result;
      while (true) {
        try {
          const retryOutbound = projectedMessages(current, imageOverrides, continuationReasoningIds);
          if (outbound.at(-1)?.role === "user" && outbound.at(-1)?.content?.startsWith("Continue exactly")) retryOutbound.push(outbound.at(-1));
          result = await streamChatCompletion(
            endpoint,
            requestBody(model, retryOutbound, current.parameters, tools),
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
          break;
        } catch (error) {
          const hasPartial = Boolean(currentAssistant.content || currentAssistant.reasoning || currentAssistant.toolCalls.length);
          if (featureEnabled("visionRetry") && !hasPartial && isImageSizeError(error)) {
            const compacted = new Set(activeCompactionFor(current)?.messageIds ?? []);
            const usedIds = new Set(current.messages.filter((message) => !compacted.has(message.id)).flatMap((message) => message.attachments ?? []));
            const next = await downscaleImageOverrides(current.attachments.filter((attachment) => usedIds.has(attachment.id)), imageOverrides);
            imageOverrides = next.overrides;
            const dimensions = next.resized.map((item) => `${item.name} ${item.width}×${item.height}`).join(", ");
            currentAssistant.meta = { ...currentAssistant.meta, imageRetries: (currentAssistant.meta?.imageRetries ?? 0) + 1 };
            if (current.id === session().id) {
              elements.attachmentStatus.hidden = false;
              elements.attachmentStatus.textContent = `Endpoint rejected image dimensions; retrying browser projection at ${dimensions}. Original attachments are unchanged.`;
            }
            continue;
          }
          throw error;
        }
      }
      const noOutput = !currentAssistant.content.trim() && !currentAssistant.reasoning.trim() && !result.toolCalls?.length;
      const noFinalAnswer = !currentAssistant.content.trim() && Boolean(currentAssistant.reasoning.trim()) && !result.toolCalls?.length;
      const interrupted = featureEnabled("streamRecovery")
        && (result.finishReason === "length" || !result.terminal || noOutput || noFinalAnswer);
      currentAssistant.state = interrupted ? "interrupted" : "complete";
      currentAssistant.toolCalls = structuredClone(result.toolCalls ?? []);
      currentAssistant.meta = {
        ...currentAssistant.meta,
        model: result.model || model,
        finishReason: result.finishReason,
        usage: result.usage,
        responseId: result.id,
        durationMs: performance.now() - startedAt,
        ...(featureEnabled("streamRecovery") ? { terminalSignal: result.sawDone ? "done" : result.sawFinishReason ? "finish_reason" : "missing" } : {}),
      };
      if (interrupted) {
        currentAssistant.error = noOutput
          ? "The endpoint completed without substantive output. Continue can ask it to resume this turn."
          : noFinalAnswer
            ? "The endpoint returned reasoning without a final answer. Continue preserves that reasoning only for the recovery request."
          : result.finishReason === "length"
            ? "The endpoint reached its output allowance. Continue resumes from the partial response."
            : "The response stream ended without [DONE] or a finish reason. It was preserved as interrupted, not marked complete.";
      }
      currentAssistant.updatedAt = new Date().toISOString();
      if (current.id === session().id) {
        state.connected = true;
        setConnection("connected", interrupted ? "Interrupted" : "Connected", `Last request completed through ${endpoint}.`);
      }
      if (interrupted) break;
    } catch (error) {
      currentAssistant.meta.durationMs = currentAssistant.meta.durationMs ?? performance.now() - startedAt;
      if (error?.name === "AbortError") {
        currentAssistant.state = "stopped";
        currentAssistant.meta.finishReason = "stopped";
        if (current.id === session().id) setConnection(state.connected ? "connected" : "idle", state.connected ? "Connected" : "Not connected");
      } else {
        currentAssistant.state = featureEnabled("streamRecovery") && (currentAssistant.content || currentAssistant.reasoning) ? "interrupted" : "error";
        currentAssistant.error = await connectionMessage(error, endpoint);
        if (current.id === session().id) {
          state.connected = false;
          setConnection("error", currentAssistant.state === "interrupted" ? "Stream interrupted" : "Request failed", currentAssistant.error);
          if (error instanceof OpenAIEndpointError && error.code === "NETWORK_ERROR") elements.help.open = true;
        }
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
      const toolMeta = {};
      try {
        const allowed = await approveToolCall(call, controller.signal);
        if (!allowed) throw new Error("The user denied this tool call.");
        if (current.id === session().id) {
          elements.attachmentStatus.hidden = false;
          elements.attachmentStatus.textContent = `Running ${call.function.name}…`;
        }
        content = await executeTool(call, {
          attachments: current.attachments,
          integrations: state.workspace.integrations,
          mcpConnections: state.mcpConnections,
          signal: controller.signal,
          executeLocalTool: (name, args) => executeBrowserTool(current, name, args),
          storeResource: featureEnabled("compaction") ? function storeResource(value, additions) {
            if (String(value).length < 24_000) return value;
            const resource = createContextResource(value, additions);
            current.resources.push(resource);
            toolMeta.resourceId = resource.id;
            return value;
          } : undefined,
          onProgress(status, progress) {
            const suffix = progress ? ` · ${Math.round(progress * 100)}%` : "";
            if (current.id === session().id) elements.attachmentStatus.textContent = `${call.function.name}: ${status}${suffix}`;
          },
        });
      } catch (error) {
        resultState = "error";
        content = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        if (current.id === session().id) elements.attachmentStatus.hidden = true;
      }
      current.messages.push(createMessage("tool", content, {
        state: resultState,
        toolCallId: call.id,
        name: call.function.name,
        meta: toolMeta,
      }));
      touchSession(current);
      queueSave();
      if (current.id === session().id) renderMessages();
    }
  }
}

async function launchGeneration(current, endpoint, model, options = {}) {
  if (state.requests.has(current.id) || (!featureEnabled("parallelSessions") && state.requests.size)) return;
  const controller = new AbortController();
  state.requests.set(current.id, { controller, sessionId: current.id });
  renderSessions();
  if (current.id === session().id) {
    updateGenerationControls();
    setConnection("connecting", state.connected ? "Generating…" : "Contacting local model…");
  }
  try {
    await runAssistantLoop(current, endpoint, model, controller, options);
  } finally {
    state.requests.delete(current.id);
    touchSession(current);
    maybeOfferCompaction(current);
    if (current.id === session().id) {
      elements.attachmentStatus.hidden = true;
      renderAll();
      elements.prompt.focus();
    } else renderSessions();
    queueSave();
  }
}

async function send(event) {
  event.preventDefault();
  if (featureEnabled("parallelSessions") ? requestFor() : state.requests.size) return;
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

  await launchGeneration(current, endpoint, model);
}

function stop() {
  requestFor()?.controller.abort();
}

async function continueMessage(id) {
  if (!featureEnabled("streamRecovery")) return;
  const current = session();
  if (state.requests.has(current.id)) return;
  const target = current.messages.find((item) => item.id === id && item.role === "assistant" && item.state === "interrupted");
  if (!target) return;
  if (current.messages.at(-1)?.id !== target.id) { toast("Continue is available only for the latest interrupted turn.", 4_000); return; }
  let endpoint;
  try { endpoint = normalizeLocalEndpoint(current.endpoint); }
  catch (error) { toast(await connectionMessage(error), 5_000); return; }
  if (!current.model.trim()) { toast("Enter a model id first."); return; }
  await launchGeneration(current, endpoint, current.model.trim(), { continuationTarget: target });
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
  if (!featureEnabled("undoDelete")) {
    const removedCalls = new Set(message.toolCalls?.map((call) => call.id) ?? []);
    current.messages = current.messages.filter((item) => item.id !== id && !removedCalls.has(item.toolCallId));
    repairToolHistory(current);
    pruneAttachments(current);
    touchSession(current);
    renderAll();
    queueSave();
    return;
  }
  const removeIds = new Set([message.id]);
  const relatedCalls = new Set(message.toolCalls?.map((call) => call.id) ?? []);
  if (message.role === "tool") {
    relatedCalls.add(message.toolCallId);
    const request = current.messages.find((item) => item.toolCalls?.some((call) => call.id === message.toolCallId));
    if (request) {
      removeIds.add(request.id);
      for (const call of request.toolCalls) relatedCalls.add(call.id);
    }
  }
  for (const item of current.messages) if (relatedCalls.has(item.toolCallId)) removeIds.add(item.id);
  const indexed = current.messages.map((item, index) => ({ item, index })).filter(({ item }) => removeIds.has(item.id));
  const removedAttachmentIds = new Set(indexed.flatMap(({ item }) => item.attachments ?? []));
  current.undo ??= [];
  current.undo.push({
    type: "delete-message",
    index: Math.min(...indexed.map((entry) => entry.index)),
    messages: indexed.map((entry) => structuredClone(entry.item)),
    attachments: current.attachments.filter((attachment) => removedAttachmentIds.has(attachment.id)).map((attachment) => structuredClone(attachment)),
    createdAt: new Date().toISOString(),
  });
  current.undo = current.undo.slice(-20);
  current.messages = current.messages.filter((item) => !removeIds.has(item.id));
  pruneAttachments(current);
  touchSession(current);
  renderAll();
  queueSave();
}

function undoDelete() {
  if (!featureEnabled("undoDelete")) return;
  const current = session();
  const entry = current.undo?.pop();
  if (!entry || entry.type !== "delete-message") return;
  const attachmentIds = new Set(current.attachments.map((attachment) => attachment.id));
  for (const attachment of entry.attachments ?? []) {
    if (!attachmentIds.has(attachment.id)) {
      current.attachments.push(structuredClone(attachment));
      attachmentIds.add(attachment.id);
    }
  }
  current.messages.splice(Math.min(entry.index, current.messages.length), 0, ...entry.messages.map((message) => createMessage(message.role, message.content, message)));
  touchSession(current);
  renderAll();
  queueSave();
  toast("Deleted turn restored");
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

async function copyActiveMarkdown() {
  if (!featureEnabled("markdownActions")) return;
  syncSessionFromForm();
  try {
    await copyText(conversationMarkdown(session()));
    toast("Conversation Markdown copied");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Copy failed", 5_000);
  }
}

async function shareActiveMarkdown() {
  if (!featureEnabled("markdownActions")) return;
  syncSessionFromForm();
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  elements.shareMarkdown.disabled = true;
  try {
    const url = await markdownShareUrl(conversationMarkdown(session()));
    if (popup) popup.location.replace(url);
    else {
      await copyText(url);
      toast("Popup blocked; a.shel.sh link copied instead", 4_000);
    }
  } catch (error) {
    popup?.close();
    toast(error instanceof Error ? error.message : "Could not build a.shel.sh link", 5_000);
  } finally {
    elements.shareMarkdown.disabled = false;
  }
}

const DEFAULT_COMPACTION_PROMPT = `Summarize only the supplied selected conversation entries for faithful continuation.
Preserve decisions, constraints, exact identifiers, unresolved work, tool findings, and user preferences.
Do not invent facts. Do not summarize unselected context. Return clean Markdown with no preamble.`;

function compactionSelection(current) {
  return new Set([...elements.compactionMessages.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value));
}

function expandToolSelection(current, selection) {
  const result = new Set(selection);
  const selectedCallIds = new Set();
  for (const message of current.messages) {
    if (result.has(message.id)) {
      for (const call of message.toolCalls ?? []) selectedCallIds.add(call.id);
      if (message.toolCallId) selectedCallIds.add(message.toolCallId);
    }
  }
  for (const message of current.messages) {
    if (message.toolCallId && selectedCallIds.has(message.toolCallId)) result.add(message.id);
    if (message.toolCalls?.some((call) => selectedCallIds.has(call.id))) {
      result.add(message.id);
      for (const call of message.toolCalls) selectedCallIds.add(call.id);
    }
  }
  for (const message of current.messages) if (message.toolCallId && selectedCallIds.has(message.toolCallId)) result.add(message.id);
  return result;
}

function renderContextDialog() {
  const current = session();
  const stats = sessionContextStats(current, projectedMessages(current));
  elements.contextDetail.textContent = `${stats.tokens.toLocaleString()} estimated tokens · ${stats.percent.toFixed(1)}% of ${stats.contextWindow.toLocaleString()}. Originals remain in browser state regardless of projection.`;
  const active = activeCompactionFor(current);
  const compacted = new Set(active?.messageIds ?? []);
  const timeline = document.createDocumentFragment();
  current.messages.forEach((message, index) => {
    const node = document.createElement("span");
    node.className = "timeline-node";
    node.dataset.role = message.role;
    node.dataset.state = message.state;
    node.dataset.compacted = String(compacted.has(message.id));
    node.title = `#${index + 1} · ${message.role}${message.name ? `:${message.name}` : ""} · ${message.state}`;
    timeline.append(node);
  });
  elements.contextTimeline.replaceChildren(timeline);
  if (!current.compactionPrompt) current.compactionPrompt = DEFAULT_COMPACTION_PROMPT;
  if (document.activeElement !== elements.compactionPrompt) elements.compactionPrompt.value = current.compactionPrompt;
  const latest = current.compactions.at(-1) ?? null;
  elements.restoreContext.disabled = !active && !latest;
  elements.restoreContext.textContent = active ? "Restore originals" : "Reapply latest";
  elements.activeCompaction.textContent = active
    ? `${active.mode === "soft" ? "Soft" : "Normal"} compaction active · ${active.messageIds.length} original entries collapsed · ${active.id}\n${active.summary}`
    : "No active compaction. The endpoint receives the native transcript.";
  const fragment = document.createDocumentFragment();
  for (const [index, message] of current.messages.entries()) {
    const row = document.createElement("label");
    row.className = "compaction-entry";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = message.id;
    checkbox.disabled = message.state === "streaming";
    checkbox.checked = active?.messageIds.includes(message.id) ?? false;
    const role = document.createElement("strong");
    role.textContent = message.role === "tool" ? `tool:${message.name || "result"}` : message.role;
    const preview = document.createElement("code");
    preview.textContent = (message.content || message.reasoning || "(empty)").replace(/\s+/g, " ").slice(0, 180);
    const count = document.createElement("span");
    count.className = "hint";
    count.textContent = `#${index + 1}`;
    row.append(checkbox, role, preview, count);
    fragment.append(row);
  }
  elements.compactionMessages.replaceChildren(fragment);
}

function openContextDialog() {
  if (!featureEnabled("contextMeter") && !featureEnabled("compaction")) return;
  renderContextDialog();
  elements.contextDialog.showModal();
}

function activateCompaction(current, value) {
  for (const item of current.compactions) item.active = false;
  current.compactions.push(value);
  current.activeCompactionId = value.id;
  touchSession(current);
  renderAll();
  renderContextDialog();
  queueSave();
}

function compactSoft() {
  if (!featureEnabled("compaction")) return;
  const current = session();
  const selected = new Set();
  const resources = [];
  for (const message of current.messages) {
    if (message.role !== "tool" || !["web_search", "web_scrape"].includes(message.name)) continue;
    let resource = message.meta?.resourceId ? current.resources.find((item) => item.id === message.meta.resourceId) : null;
    if (!resource) {
      resource = createContextResource(message.content, {
        kind: message.name === "web_scrape" ? "firecrawl-scrape" : "firecrawl-search",
        name: `${message.name}: ${message.content.match(/^#{1,6}\s+(.+)$/m)?.[1] || "result"}`,
        sourceTool: message.name,
      });
      current.resources.push(resource);
      message.meta = { ...message.meta, resourceId: resource.id };
    }
    selected.add(message.id);
    resources.push(resource);
  }
  if (!selected.size) { toast("No Firecrawl search or scrape results are present in this chat."); return; }
  const expanded = expandToolSelection(current, selected);
  const summary = [
    "Firecrawl results were losslessly indexed as clean Markdown. Original messages remain stored.",
    ...resources.map((resource) => `- \`${resource.id}\` · ${resource.name} · ${resource.sections.length} ordered section${resource.sections.length === 1 ? "" : "s"}`),
    "Use context_read kind=resource with a resource id and one-based section to open only the needed portion.",
  ].join("\n");
  activateCompaction(current, {
    id: messageId("compact"), mode: "soft", messageIds: [...expanded], summary,
    prompt: "", active: true, createdAt: new Date().toISOString(),
  });
  toast(`Indexed ${resources.length} Firecrawl result${resources.length === 1 ? "" : "s"}`);
}

function compactionSource(current, ids) {
  const selected = new Set(ids);
  return current.messages.filter((message) => selected.has(message.id)).map((message) => ({
    id: message.id,
    role: message.role,
    ...(message.name ? { tool: message.name } : {}),
    content: message.content,
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
  }));
}

async function compactNormal() {
  if (!featureEnabled("compaction")) return;
  const current = session();
  if (elements.compactNormal.disabled) return;
  const selected = expandToolSelection(current, compactionSelection(current));
  if (!selected.size) { toast("Select one or more completed entries to summarize."); return; }
  if (!current.model.trim()) { toast("Enter a model id first."); return; }
  current.compactionPrompt = elements.compactionPrompt.value.trim() || DEFAULT_COMPACTION_PROMPT;
  elements.compactNormal.disabled = true;
  elements.compactNormal.textContent = "Summarizing…";
  try {
    const endpoint = normalizeLocalEndpoint(current.endpoint);
    const result = await streamChatCompletion(endpoint, requestBody(current.model.trim(), [
      { role: "system", content: current.compactionPrompt },
      { role: "user", content: `Selected entries (exact browser-local snapshot):\n\n${JSON.stringify(compactionSource(current, selected), null, 2)}` },
    ], { ...current.parameters, maxTokens: null }, []));
    if (!result.content.trim()) throw new Error("The stateless summarizer returned no summary.");
    activateCompaction(current, {
      id: messageId("compact"), mode: "normal", messageIds: [...selected], summary: result.content.trim(),
      prompt: current.compactionPrompt, active: true, createdAt: new Date().toISOString(),
    });
    toast(`${selected.size} entries compacted; originals remain available`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Compaction failed", 6_000);
  } finally {
    elements.compactNormal.disabled = false;
    elements.compactNormal.textContent = "Normal · summarize selected";
    renderContextDialog();
  }
}

function restoreContext() {
  if (!featureEnabled("compaction")) return;
  const current = session();
  const active = activeCompactionFor(current);
  if (active) {
    active.active = false;
    current.activeCompactionId = "";
  } else {
    const latest = current.compactions.at(-1);
    if (!latest) return;
    for (const item of current.compactions) item.active = false;
    latest.active = true;
    current.activeCompactionId = latest.id;
  }
  touchSession(current);
  renderAll();
  renderContextDialog();
  queueSave();
  toast(active ? "Native original context restored" : "Latest compaction reapplied");
}

function selectOlderContext() {
  if (!featureEnabled("compaction")) return;
  const rows = [...elements.compactionMessages.querySelectorAll("input[type='checkbox']")].filter((input) => !input.disabled);
  const cutoff = Math.max(0, rows.length - 4);
  rows.forEach((input, index) => { input.checked = index < cutoff; });
}

function renderTodos(current) {
  const fragment = document.createDocumentFragment();
  for (const item of current.todos) {
    const row = document.createElement("label");
    row.className = "todo-row";
    row.dataset.done = String(item.done);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.addEventListener("change", () => {
      item.done = checkbox.checked;
      item.updatedAt = new Date().toISOString();
      touchSession(current); renderWorkspaceDialog(); queueSave();
    });
    const label = document.createElement("span");
    label.textContent = item.text;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      current.todos = current.todos.filter((candidate) => candidate.id !== item.id);
      touchSession(current); renderWorkspaceDialog(); queueSave();
    });
    row.append(checkbox, label, remove);
    fragment.append(row);
  }
  if (!current.todos.length) {
    const empty = document.createElement("p"); empty.className = "hint"; empty.textContent = "No TODOs yet."; fragment.append(empty);
  }
  elements.todoList.replaceChildren(fragment);
}

function selectedDocument(current) {
  return current.documents.find((item) => item.id === state.selectedDocumentId) ?? null;
}

function renderDocumentDiff(documentValue, revision) {
  elements.documentDiff.replaceChildren();
  if (!documentValue) return;
  const currentIndex = documentValue.revisions.findIndex((item) => item.revision === revision);
  const after = documentValue.revisions[currentIndex] ?? documentValue.revisions.at(-1);
  const before = documentValue.revisions[Math.max(0, currentIndex - 1)] ?? { content: "" };
  const fragment = document.createDocumentFragment();
  for (const line of diffRevision(before.content, after.content)) {
    const row = document.createElement("span");
    row.className = "diff-line";
    row.dataset.type = line.type;
    row.textContent = `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} ${line.text}`;
    fragment.append(row);
  }
  elements.documentDiff.replaceChildren(fragment);
}

function renderWorkspaceDialog() {
  const current = session();
  renderTodos(current);
  if (state.selectedDocumentId && !current.documents.some((item) => item.id === state.selectedDocumentId)) state.selectedDocumentId = "";
  if (!state.selectedDocumentId && current.documents.length) state.selectedDocumentId = current.documents[0].id;
  const documentValue = selectedDocument(current);
  const options = document.createDocumentFragment();
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "New document"; options.append(placeholder);
  for (const item of current.documents) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.name} · r${item.revision}`; options.append(option);
  }
  elements.documentSelect.replaceChildren(options);
  elements.documentSelect.value = documentValue?.id ?? "";
  elements.documentName.value = documentValue?.name ?? "";
  elements.documentLanguage.value = documentValue?.language ?? "markdown";
  const revisions = document.createDocumentFragment();
  for (const revision of documentValue?.revisions ?? []) {
    const option = document.createElement("option"); option.value = String(revision.revision); option.textContent = `Revision ${revision.revision}`; revisions.append(option);
  }
  elements.documentRevision.replaceChildren(revisions);
  if (documentValue) elements.documentRevision.value = String(documentValue.revision);
  elements.documentRevision.disabled = !documentValue;
  const content = documentValue?.content ?? "";
  elements.documentContent.value = content;
  elements.documentContent.readOnly = false;
  elements.saveDocument.disabled = false;
  const diagnostics = lintDocument(content, documentValue?.language || "markdown");
  elements.documentDiagnostics.textContent = diagnostics.length ? `${diagnostics.length} lint diagnostic${diagnostics.length === 1 ? "" : "s"}` : documentValue ? "No lint diagnostics" : "Unsaved document";
  renderDocumentDiff(documentValue, documentValue?.revision);
  elements.documentPreview.replaceChildren();
  if (content) {
    if (["markdown", "md"].includes(documentValue?.language)) elements.documentPreview.append(renderMarkdown(content, { rich: featureEnabled("richMarkdown") }));
    else elements.documentPreview.append(renderMarkdown(`\`\`\`${documentValue?.language || "text"}\n${content}\n\`\`\``, { rich: featureEnabled("richMarkdown") }));
  }
}

function openWorkspaceDialog() {
  if (!featureEnabled("todoTool") && !featureEnabled("readTools") && !featureEnabled("writeTools")) return;
  renderWorkspaceDialog();
  elements.workspaceDialog.showModal();
}

function addTodo() {
  if (!featureEnabled("todoTool")) return;
  const value = elements.todoInput.value.trim();
  if (!value) return;
  const now = new Date().toISOString();
  session().todos.push({ id: messageId("todo"), text: value, done: false, createdAt: now, updatedAt: now });
  elements.todoInput.value = "";
  touchSession(session()); renderWorkspaceDialog(); queueSave();
}

function startNewDocument(name = "") {
  if (!featureEnabled("readTools") && !featureEnabled("writeTools")) return;
  state.selectedDocumentId = "";
  elements.documentSelect.value = "";
  elements.documentName.value = name;
  elements.documentLanguage.value = languageFromName(name || "document.md");
  elements.documentContent.value = "";
  elements.documentRevision.replaceChildren();
  elements.documentRevision.disabled = true;
  elements.documentDiff.replaceChildren();
  elements.documentPreview.replaceChildren();
  elements.documentContent.readOnly = false;
  elements.documentName.focus();
}

function saveDocumentFromEditor() {
  if (!featureEnabled("readTools") && !featureEnabled("writeTools")) return;
  const current = session();
  const existing = selectedDocument(current);
  const name = elements.documentName.value.trim();
  if (!name) { elements.documentName.focus(); return; }
  const next = putBrowserDocument(existing, {
    name,
    language: elements.documentLanguage.value.trim() || languageFromName(name),
    content: elements.documentContent.value,
    expected_revision: existing?.revision,
  }, { readRevision: existing?.revision, actor: "user" });
  if (existing) current.documents.splice(current.documents.indexOf(existing), 1, next);
  else current.documents.push(next);
  state.selectedDocumentId = next.id;
  touchSession(current); renderWorkspaceDialog(); queueSave();
  toast(`${next.name} revision ${next.revision} saved`);
}

function selectDocumentRevision() {
  const documentValue = selectedDocument(session());
  if (!documentValue) return;
  const revision = Number(elements.documentRevision.value);
  const snapshot = documentValue.revisions.find((item) => item.revision === revision);
  if (!snapshot) return;
  elements.documentContent.value = snapshot.content;
  elements.documentContent.readOnly = revision !== documentValue.revision;
  elements.saveDocument.disabled = revision !== documentValue.revision;
  renderDocumentDiff(documentValue, revision);
  elements.documentPreview.replaceChildren(renderMarkdown(
    ["markdown", "md"].includes(documentValue.language) ? snapshot.content : `\`\`\`${documentValue.language}\n${snapshot.content}\n\`\`\``,
    { rich: featureEnabled("richMarkdown") },
  ));
}

async function importState(file) {
  if (!file) return;
  if (state.requests.size) { toast("Stop active generations before importing workspace state."); return; }
  try {
    const source = JSON.parse(await file.text());
    for (const connection of state.mcpConnections.values()) await connection.client.close();
    state.mcpConnections.clear();
    state.mcpStatus.clear();
    if (source?.schema === WORKSPACE_SCHEMA || source?.schema === LEGACY_WORKSPACE_SCHEMA) {
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

function setFeatureMatrix(enabled) {
  const hasBackgroundRequest = [...state.requests.keys()].some((id) => id !== session().id);
  if (!enabled && hasBackgroundRequest) {
    toast("Stop background chat generations before disabling Parallel chats.", 5_000);
    return;
  }
  for (const control of Object.values(featureControls)) control.checked = enabled;
  syncIntegrationsFromForm();
  const current = session();
  for (const item of state.workspace.sessions) item.parameters.maxTokens = enabled ? null : 8192;
  writeParameters(current.parameters);
  applyFeatureVisibility();
  renderAll();
  queueSave();
}

function handleFeatureInput(event) {
  if (event?.target === elements.featureParallelSessions
      && !elements.featureParallelSessions.checked
      && [...state.requests.keys()].some((id) => id !== session().id)) {
    elements.featureParallelSessions.checked = true;
    toast("Stop background chat generations before disabling Parallel chats.", 5_000);
    return;
  }
  const previousAuto = featureEnabled("autoMaxTokens");
  if (event?.target === elements.writeToolsEnabled && elements.writeToolsEnabled.checked) {
    elements.readToolsEnabled.checked = true;
  }
  syncIntegrationsFromForm();
  const current = session();
  if (previousAuto !== featureEnabled("autoMaxTokens")) {
    for (const item of state.workspace.sessions) item.parameters.maxTokens = featureEnabled("autoMaxTokens") ? null : 8192;
    writeParameters(current.parameters);
  }
  applyFeatureVisibility();
  renderAll();
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
elements.copyMarkdown.addEventListener("click", copyActiveMarkdown);
elements.shareMarkdown.addEventListener("click", shareActiveMarkdown);
elements.undo.addEventListener("click", undoDelete);
elements.featureEnableAll.addEventListener("click", () => setFeatureMatrix(true));
elements.featureDisableAll.addEventListener("click", () => setFeatureMatrix(false));
elements.contextMeter.addEventListener("click", openContextDialog);
elements.openWorkspace.addEventListener("click", openWorkspaceDialog);
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
elements.compactSoft.addEventListener("click", compactSoft);
elements.compactNormal.addEventListener("click", compactNormal);
elements.restoreContext.addEventListener("click", restoreContext);
elements.selectOlderContext.addEventListener("click", selectOlderContext);
elements.closeContext.addEventListener("click", () => elements.contextDialog.close());
elements.compactionPrompt.addEventListener("input", () => {
  session().compactionPrompt = elements.compactionPrompt.value;
  queueSave();
});
elements.closeWorkspace.addEventListener("click", () => elements.workspaceDialog.close());
elements.addTodo.addEventListener("click", addTodo);
elements.todoInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); addTodo(); }
});
elements.newDocument.addEventListener("click", () => startNewDocument());
elements.openInstructions.addEventListener("click", () => {
  const existing = findDocument(session(), "instructions.md");
  if (existing) { state.selectedDocumentId = existing.id; renderWorkspaceDialog(); }
  else startNewDocument("instructions.md");
});
elements.documentSelect.addEventListener("change", () => {
  state.selectedDocumentId = elements.documentSelect.value;
  if (state.selectedDocumentId) renderWorkspaceDialog();
  else startNewDocument();
});
elements.documentRevision.addEventListener("change", selectDocumentRevision);
elements.saveDocument.addEventListener("click", saveDocumentFromEditor);
elements.prompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

for (const input of [
  elements.endpoint, elements.model, elements.systemPrompt, elements.temperature, elements.topP,
  elements.maxTokens, elements.contextWindow, elements.seed, elements.reasoningEffort, elements.enableThinking, elements.prompt,
]) input.addEventListener("input", handleSessionFormInput);
for (const input of [
  elements.approval, elements.maxToolRounds, elements.ocrEnabled, elements.firecrawlEnabled,
  elements.firecrawlUrl, elements.firecrawlLimit,
]) input.addEventListener("input", handleIntegrationInput);
for (const input of Object.values(featureControls)) input.addEventListener("input", handleFeatureInput);

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
