import { createMessage, messageId, normalizeParameters, parseConversationDocument } from "./transcript.js";
import { createBrowserDocument } from "./documents.js";

export const LEGACY_WORKSPACE_SCHEMA = "https://llm.shel.sh/schemas/workspace-v1.json";
export const WORKSPACE_SCHEMA = "https://llm.shel.sh/schemas/workspace-v2.json";
export const WORKSPACE_VERSION = 2;

const DEFAULT_ENDPOINT = "http://localhost:8000/v1";
const DEFAULT_FIRECRAWL = "http://localhost:3002";

export const FEATURE_KEYS = Object.freeze([
  "streamRecovery",
  "autoMaxTokens",
  "richMarkdown",
  "parallelSessions",
  "markdownActions",
  "visionRetry",
  "stableScroll",
  "contextMeter",
  "compaction",
  "readTools",
  "writeTools",
  "todoTool",
  "undoDelete",
]);

export function defaultFeatures() {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, false]));
}

export function normalizeFeatures(value = {}) {
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, value?.[key] === true]));
  if (features.writeTools) features.readTools = true;
  return features;
}

function iso(value, fallback = new Date().toISOString()) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function normalizedAttachment(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    type: typeof value.type === "string" ? value.type : "application/octet-stream",
    size: Number.isFinite(Number(value.size)) ? Math.max(0, Number(value.size)) : 0,
    kind: ["image", "text", "document", "archive"].includes(value.kind) ? value.kind : "text",
    dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : "",
    text: typeof value.text === "string" ? value.text : "",
    sourceFormat: typeof value.sourceFormat === "string" ? value.sourceFormat : "",
    createdAt: iso(value.createdAt),
    meta: value.meta && typeof value.meta === "object" ? { ...value.meta } : {},
  };
}

function normalizedMcpServer(value, index) {
  if (!value || typeof value !== "object") return null;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url) return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : messageId(`mcp-${index}`),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : `MCP ${index + 1}`,
    url,
    enabled: value.enabled !== false,
    protocolVersion: typeof value.protocolVersion === "string" ? value.protocolVersion : "",
    serverInfo: value.serverInfo && typeof value.serverInfo === "object" ? { ...value.serverInfo } : null,
    tools: Array.isArray(value.tools) ? value.tools.filter((tool) => tool && typeof tool.name === "string").map((tool) => ({
      name: tool.name,
      title: typeof tool.title === "string" ? tool.title : "",
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
      annotations: tool.annotations && typeof tool.annotations === "object" ? tool.annotations : {},
    })) : [],
  };
}

export function defaultIntegrations() {
  return {
    approval: "ask",
    maxToolRounds: 8,
    ocr: { enabled: true },
    features: defaultFeatures(),
    localTools: { context: false, read: false, write: false, todos: false },
    firecrawl: { enabled: false, url: DEFAULT_FIRECRAWL, limit: 5 },
    mcpServers: [],
  };
}

export function normalizeIntegrations(value = {}) {
  const defaults = defaultIntegrations();
  const approval = value.approval === "always" ? "always" : "ask";
  const maxToolRounds = Math.max(1, Math.min(16, Math.trunc(Number(value.maxToolRounds) || defaults.maxToolRounds)));
  const features = normalizeFeatures(value.features);
  return {
    approval,
    maxToolRounds,
    ocr: { enabled: value.ocr?.enabled !== false },
    features,
    localTools: {
      context: features.readTools || features.compaction,
      read: features.readTools,
      write: features.readTools && features.writeTools,
      todos: features.todoTool,
    },
    firecrawl: {
      enabled: value.firecrawl?.enabled === true,
      url: typeof value.firecrawl?.url === "string" && value.firecrawl.url.trim() ? value.firecrawl.url.trim() : DEFAULT_FIRECRAWL,
      limit: Math.max(1, Math.min(10, Math.trunc(Number(value.firecrawl?.limit) || defaults.firecrawl.limit))),
    },
    mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers.map(normalizedMcpServer).filter(Boolean) : [],
  };
}

function normalizedTodo(value) {
  if (!value || typeof value !== "object" || typeof value.text !== "string" || !value.text.trim()) return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : messageId("todo"),
    text: value.text.trim().slice(0, 2_000),
    done: value.done === true,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
}

function normalizedResource(value) {
  if (!value || typeof value !== "object" || typeof value.content !== "string") return null;
  const suppliedSections = Array.isArray(value.sections) && value.sections.every((section) => typeof section === "string")
    ? [...value.sections]
    : [];
  const sections = suppliedSections.length && suppliedSections.join("") === value.content ? suppliedSections : [value.content];
  return {
    id: typeof value.id === "string" && value.id ? value.id : messageId("resource"),
    kind: typeof value.kind === "string" ? value.kind : "document",
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 240) : "Browser tool result",
    sourceTool: typeof value.sourceTool === "string" ? value.sourceTool : "",
    content: value.content,
    sections,
    createdAt: iso(value.createdAt),
  };
}

function normalizedCompaction(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.messageIds) || !value.messageIds.length) return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : messageId("compact"),
    mode: value.mode === "soft" ? "soft" : "normal",
    messageIds: [...new Set(value.messageIds.filter((id) => typeof id === "string" && id))],
    summary: typeof value.summary === "string" ? value.summary : "",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    active: value.active !== false,
    createdAt: iso(value.createdAt),
  };
}

function normalizedUndo(value) {
  if (!value || typeof value !== "object" || value.type !== "delete-message" || !Array.isArray(value.messages)) return null;
  return {
    type: "delete-message",
    index: Math.max(0, Math.trunc(Number(value.index) || 0)),
    messages: value.messages.map((message) => createMessage(message.role, message.content, message)),
    attachments: Array.isArray(value.attachments) ? value.attachments.map(normalizedAttachment).filter(Boolean) : [],
    createdAt: iso(value.createdAt),
  };
}

export function createSession(additions = {}) {
  const now = new Date().toISOString();
  const id = additions.id || messageId("session");
  const attachments = Array.isArray(additions.attachments) ? additions.attachments.map(normalizedAttachment).filter(Boolean) : [];
  const attachmentIds = new Set(attachments.map((item) => item.id));
  const messages = Array.isArray(additions.messages)
    ? additions.messages.map((message) => createMessage(message.role, message.content, message))
    : [];
  for (const message of messages) {
    if (message.state === "streaming") {
      message.state = "stopped";
      message.meta = { ...message.meta, finishReason: message.meta?.finishReason || "interrupted" };
    }
  }
  for (const message of messages) message.attachments = message.attachments.filter((attachmentId) => attachmentIds.has(attachmentId));
  const messageIds = new Set(messages.map((message) => message.id));
  const resources = Array.isArray(additions.resources) ? additions.resources.map(normalizedResource).filter(Boolean) : [];
  const documents = Array.isArray(additions.documents) ? additions.documents.map(createBrowserDocument) : [];
  const todos = Array.isArray(additions.todos) ? additions.todos.map(normalizedTodo).filter(Boolean) : [];
  const compactions = Array.isArray(additions.compactions)
    ? additions.compactions.map(normalizedCompaction).filter(Boolean).map((item) => ({ ...item, messageIds: item.messageIds.filter((id) => messageIds.has(id)) })).filter((item) => item.messageIds.length)
    : [];
  const requestedCompaction = typeof additions.activeCompactionId === "string" ? additions.activeCompactionId : "";
  return {
    id,
    title: typeof additions.title === "string" && additions.title.trim() ? additions.title.trim().slice(0, 120) : "New chat",
    titleLocked: additions.titleLocked === true,
    endpoint: typeof additions.endpoint === "string" && additions.endpoint.trim() ? additions.endpoint.trim() : DEFAULT_ENDPOINT,
    model: typeof additions.model === "string" ? additions.model : "",
    systemPrompt: typeof additions.systemPrompt === "string" ? additions.systemPrompt : "",
    parameters: normalizeParameters(additions.parameters),
    messages,
    attachments,
    todos,
    documents,
    resources,
    compactions,
    activeCompactionId: compactions.some((item) => item.id === requestedCompaction && item.active) ? requestedCompaction : "",
    compactionPrompt: typeof additions.compactionPrompt === "string" ? additions.compactionPrompt : "",
    contextOfferAt: Math.max(0, Math.trunc(Number(additions.contextOfferAt) || 0)),
    undo: Array.isArray(additions.undo) ? additions.undo.map(normalizedUndo).filter(Boolean).slice(-20) : [],
    draft: typeof additions.draft === "string" ? additions.draft : "",
    pendingAttachmentIds: Array.isArray(additions.pendingAttachmentIds)
      ? additions.pendingAttachmentIds.filter((attachmentId) => attachmentIds.has(attachmentId))
      : [],
    createdAt: iso(additions.createdAt, now),
    updatedAt: iso(additions.updatedAt, now),
  };
}

export function deriveSessionTitle(session) {
  if (session.titleLocked) return session.title;
  const first = session.messages.find((message) => message.role === "user" && message.content.trim());
  if (!first) return session.title || "New chat";
  const singleLine = first.content.replace(/\s+/g, " ").trim();
  return singleLine.length > 52 ? `${singleLine.slice(0, 51).trimEnd()}…` : singleLine;
}

export function touchSession(session) {
  session.title = deriveSessionTitle(session);
  session.updatedAt = new Date().toISOString();
  return session;
}

export function createWorkspace(additions = {}) {
  const sourceSessions = Array.isArray(additions.sessions) ? additions.sessions : [];
  const sessions = sourceSessions.length ? sourceSessions.map(createSession) : [createSession()];
  const requestedActive = typeof additions.activeSessionId === "string" ? additions.activeSessionId : "";
  const integrations = normalizeIntegrations(additions.integrations);
  for (const session of sessions) {
    session.parameters.maxTokens = integrations.features.autoMaxTokens
      ? null
      : session.parameters.maxTokens ?? 8192;
  }
  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    activeSessionId: sessions.some((session) => session.id === requestedActive) ? requestedActive : sessions[0].id,
    sessions,
    integrations,
    savedAt: iso(additions.savedAt),
  };
}

export function activeSession(workspace) {
  return workspace.sessions.find((session) => session.id === workspace.activeSessionId) ?? workspace.sessions[0];
}

export function parseWorkspaceDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Workspace JSON must be an object.");
  if (value.schema !== WORKSPACE_SCHEMA && value.schema !== LEGACY_WORKSPACE_SCHEMA) throw new TypeError("This is not an llm workspace document.");
  if (Number(value.version) > WORKSPACE_VERSION) throw new TypeError(`Workspace version ${value.version} is newer than this page supports.`);
  if (!Array.isArray(value.sessions) || !value.sessions.length) throw new TypeError("Workspace JSON must contain at least one session.");
  if (value.sessions.length > 1_000) throw new TypeError("Workspace JSON contains more than 1,000 sessions.");
  return createWorkspace(value);
}

export function workspaceDocument(workspace) {
  const normalized = createWorkspace(workspace);
  normalized.savedAt = new Date().toISOString();
  return normalized;
}

export function sessionFromConversation(value) {
  const conversation = parseConversationDocument(value);
  return createSession({ ...conversation, titleLocked: conversation.title !== "Imported chat" });
}
