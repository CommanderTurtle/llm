import { createMessage, messageId, normalizeParameters, parseConversationDocument } from "./transcript.js";

export const WORKSPACE_SCHEMA = "https://llm.shel.sh/schemas/workspace-v1.json";
export const WORKSPACE_VERSION = 1;

const DEFAULT_ENDPOINT = "http://localhost:8000/v1";
const DEFAULT_FIRECRAWL = "http://localhost:3002";

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
    firecrawl: { enabled: false, url: DEFAULT_FIRECRAWL, limit: 5 },
    mcpServers: [],
  };
}

export function normalizeIntegrations(value = {}) {
  const defaults = defaultIntegrations();
  const approval = value.approval === "always" ? "always" : "ask";
  const maxToolRounds = Math.max(1, Math.min(16, Math.trunc(Number(value.maxToolRounds) || defaults.maxToolRounds)));
  return {
    approval,
    maxToolRounds,
    ocr: { enabled: value.ocr?.enabled !== false },
    firecrawl: {
      enabled: value.firecrawl?.enabled === true,
      url: typeof value.firecrawl?.url === "string" && value.firecrawl.url.trim() ? value.firecrawl.url.trim() : DEFAULT_FIRECRAWL,
      limit: Math.max(1, Math.min(10, Math.trunc(Number(value.firecrawl?.limit) || defaults.firecrawl.limit))),
    },
    mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers.map(normalizedMcpServer).filter(Boolean) : [],
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
  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    activeSessionId: sessions.some((session) => session.id === requestedActive) ? requestedActive : sessions[0].id,
    sessions,
    integrations: normalizeIntegrations(additions.integrations),
    savedAt: iso(additions.savedAt),
  };
}

export function activeSession(workspace) {
  return workspace.sessions.find((session) => session.id === workspace.activeSessionId) ?? workspace.sessions[0];
}

export function parseWorkspaceDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Workspace JSON must be an object.");
  if (value.schema !== WORKSPACE_SCHEMA) throw new TypeError("This is not an llm workspace document.");
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
