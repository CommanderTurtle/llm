export const CONVERSATION_SCHEMA = "https://llm.shel.sh/schemas/conversation-v1.json";
export const CONVERSATION_VERSION = 1;

const SUPPORTED_ROLES = new Set(["system", "developer", "user", "assistant"]);

export function messageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createMessage(role, content = "", additions = {}) {
  if (!SUPPORTED_ROLES.has(role)) throw new TypeError(`Unsupported message role: ${role}`);
  return {
    id: additions.id ?? messageId(),
    role,
    content: String(content),
    reasoning: typeof additions.reasoning === "string" ? additions.reasoning : "",
    createdAt: additions.createdAt ?? new Date().toISOString(),
    state: additions.state ?? "complete",
    meta: additions.meta && typeof additions.meta === "object" ? { ...additions.meta } : {},
    error: typeof additions.error === "string" ? additions.error : "",
  };
}

function finiteNumber(value, fallback, constraints = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (constraints.min != null && number < constraints.min) return fallback;
  if (constraints.max != null && number > constraints.max) return fallback;
  return number;
}

export function normalizeParameters(parameters = {}) {
  const seedValue = parameters.seed;
  const seed = seedValue === "" || seedValue == null ? null : finiteNumber(seedValue, null);
  return {
    temperature: finiteNumber(parameters.temperature, 0.6, { min: 0, max: 2 }),
    topP: finiteNumber(parameters.topP ?? parameters.top_p, 0.95, { min: 0, max: 1 }),
    maxTokens: Math.trunc(finiteNumber(parameters.maxTokens ?? parameters.max_tokens, 8192, { min: 1 })),
    seed: seed == null ? null : Math.trunc(seed),
  };
}

function normalizeImportedMessage(value, index) {
  if (!value || typeof value !== "object") {
    throw new TypeError(`Message ${index + 1} must be an object.`);
  }
  if (!SUPPORTED_ROLES.has(value.role)) {
    throw new TypeError(`Message ${index + 1} has unsupported role "${String(value.role)}".`);
  }
  if (typeof value.content !== "string") {
    throw new TypeError(`Message ${index + 1} must have string content.`);
  }

  return createMessage(value.role, value.content, {
    id: typeof value.id === "string" && value.id ? value.id : undefined,
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    state: "complete",
    meta: value.meta,
  });
}

export function parseConversationDocument(value) {
  const source = Array.isArray(value) ? { messages: value } : value;
  if (!source || typeof source !== "object") {
    throw new TypeError("Conversation JSON must be an object or an array of OpenAI-style messages.");
  }
  if (source.schema === CONVERSATION_SCHEMA && Number(source.version) > CONVERSATION_VERSION) {
    throw new TypeError(`Conversation version ${source.version} is newer than this page supports.`);
  }
  if (!Array.isArray(source.messages)) {
    throw new TypeError("Conversation JSON must contain a messages array.");
  }
  if (source.messages.length > 10_000) {
    throw new TypeError("Conversation JSON contains more than 10,000 messages.");
  }

  return {
    endpoint: typeof source.endpoint === "string" ? source.endpoint : "",
    model: typeof source.model === "string" ? source.model : "",
    systemPrompt: typeof source.systemPrompt === "string" ? source.systemPrompt : "",
    parameters: normalizeParameters(source.parameters),
    messages: source.messages.map(normalizeImportedMessage),
  };
}

export function conversationDocument(state) {
  return {
    schema: CONVERSATION_SCHEMA,
    version: CONVERSATION_VERSION,
    exportedAt: new Date().toISOString(),
    endpoint: state.endpoint,
    model: state.model,
    systemPrompt: state.systemPrompt,
    parameters: normalizeParameters(state.parameters),
    messages: state.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      createdAt: message.createdAt,
      ...(Object.keys(message.meta ?? {}).length ? { meta: message.meta } : {}),
    })),
  };
}

export function apiMessages(messages, systemPrompt = "") {
  const result = [];
  if (systemPrompt.trim()) result.push({ role: "system", content: systemPrompt.trim() });

  for (const message of messages) {
    if (!SUPPORTED_ROLES.has(message.role)) continue;
    if (message.state === "error" && !message.content) continue;
    if (!message.content) continue;
    result.push({ role: message.role, content: message.content });
  }
  return result;
}
