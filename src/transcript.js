export const CONVERSATION_SCHEMA = "https://llm.shel.sh/schemas/conversation-v2.json";
export const LEGACY_CONVERSATION_SCHEMA = "https://llm.shel.sh/schemas/conversation-v1.json";
export const CONVERSATION_VERSION = 2;

const SUPPORTED_ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);
const REASONING_EFFORTS = new Set(["", "none", "minimal", "low", "medium", "high", "xhigh"]);

export function messageId(prefix = "msg") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function stringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
}

function normalizeToolCall(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const fn = value.function && typeof value.function === "object" ? value.function : value;
  const name = typeof fn.name === "string" ? fn.name.trim() : "";
  if (!name) return null;
  let argumentsText = fn.arguments;
  if (typeof argumentsText !== "string") {
    try {
      argumentsText = JSON.stringify(argumentsText ?? {});
    } catch {
      argumentsText = "{}";
    }
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : `call_${messageId("tool").replace(/[^A-Za-z0-9_-]/g, "")}_${index}`,
    type: "function",
    function: { name, arguments: argumentsText },
  };
}

export function createMessage(role, content = "", additions = {}) {
  if (!SUPPORTED_ROLES.has(role)) throw new TypeError(`Unsupported message role: ${role}`);
  const now = new Date().toISOString();
  const createdAt = additions.createdAt ?? now;
  const toolCalls = Array.isArray(additions.toolCalls)
    ? additions.toolCalls.map(normalizeToolCall).filter(Boolean)
    : [];
  return {
    id: additions.id ?? messageId(),
    role,
    content: String(content ?? ""),
    reasoning: typeof additions.reasoning === "string" ? additions.reasoning : "",
    attachments: stringArray(additions.attachments),
    toolCalls,
    toolCallId: typeof additions.toolCallId === "string" ? additions.toolCallId : "",
    name: typeof additions.name === "string" ? additions.name : "",
    createdAt,
    updatedAt: additions.updatedAt ?? createdAt,
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

function booleanValue(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

export function normalizeParameters(parameters = {}) {
  const seedValue = parameters.seed;
  const seed = seedValue === "" || seedValue == null ? null : finiteNumber(seedValue, null);
  const requestedEffort = typeof parameters.reasoningEffort === "string"
    ? parameters.reasoningEffort
    : typeof parameters.reasoning_effort === "string" ? parameters.reasoning_effort : "";
  const hasMaxTokens = Object.hasOwn(parameters, "maxTokens") || Object.hasOwn(parameters, "max_tokens");
  const maxTokenValue = Object.hasOwn(parameters, "maxTokens") ? parameters.maxTokens : parameters.max_tokens;
  const parsedMaxTokens = finiteNumber(maxTokenValue, 8192, { min: 1 });
  const maxTokens = hasMaxTokens && (maxTokenValue === "" || maxTokenValue == null)
    ? null
    : Math.trunc(parsedMaxTokens);
  const contextValue = parameters.contextWindow ?? parameters.context_window;
  const contextWindow = contextValue === "" || contextValue == null
    ? 131_072
    : Math.trunc(finiteNumber(contextValue, 131_072, { min: 1 }));
  return {
    temperature: finiteNumber(parameters.temperature, 0.6, { min: 0, max: 2 }),
    topP: finiteNumber(parameters.topP ?? parameters.top_p, 0.95, { min: 0, max: 1 }),
    maxTokens,
    contextWindow,
    seed: seed == null ? null : Math.trunc(seed),
    reasoningEffort: REASONING_EFFORTS.has(requestedEffort) ? requestedEffort : "",
    enableThinking: booleanValue(parameters.enableThinking ?? parameters.enable_thinking, true),
  };
}

function normalizeImportedMessage(value, index) {
  if (!value || typeof value !== "object") throw new TypeError(`Message ${index + 1} must be an object.`);
  if (!SUPPORTED_ROLES.has(value.role)) {
    throw new TypeError(`Message ${index + 1} has unsupported role "${String(value.role)}".`);
  }
  if (typeof value.content !== "string" && value.content != null) {
    throw new TypeError(`Message ${index + 1} must have string content.`);
  }
  if (value.role === "tool" && typeof (value.toolCallId ?? value.tool_call_id) !== "string") {
    throw new TypeError(`Tool message ${index + 1} must name its tool call id.`);
  }

  return createMessage(value.role, value.content ?? "", {
    id: typeof value.id === "string" && value.id ? value.id : undefined,
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
    attachments: value.attachments,
    toolCalls: value.toolCalls ?? value.tool_calls,
    toolCallId: value.toolCallId ?? value.tool_call_id,
    name: value.name,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    state: ["stopped", "interrupted", "error"].includes(value.state) ? value.state : "complete",
    meta: value.meta,
    error: value.error,
  });
}

function normalizeAttachment(value, index) {
  if (!value || typeof value !== "object") throw new TypeError(`Attachment ${index + 1} must be an object.`);
  if (typeof value.id !== "string" || !value.id) throw new TypeError(`Attachment ${index + 1} has no id.`);
  if (typeof value.name !== "string" || !value.name) throw new TypeError(`Attachment ${index + 1} has no filename.`);
  return {
    id: value.id,
    name: value.name,
    type: typeof value.type === "string" ? value.type : "application/octet-stream",
    size: Number.isFinite(Number(value.size)) ? Math.max(0, Number(value.size)) : 0,
    kind: ["image", "text", "document", "archive"].includes(value.kind) ? value.kind : "text",
    dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : "",
    text: typeof value.text === "string" ? value.text : "",
    sourceFormat: typeof value.sourceFormat === "string" ? value.sourceFormat : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    meta: value.meta && typeof value.meta === "object" ? { ...value.meta } : {},
  };
}

export function parseConversationDocument(value) {
  const source = Array.isArray(value) ? { messages: value } : value;
  if (!source || typeof source !== "object") {
    throw new TypeError("Conversation JSON must be an object or an array of OpenAI-style messages.");
  }
  if (
    (source.schema === CONVERSATION_SCHEMA || source.schema === LEGACY_CONVERSATION_SCHEMA)
    && Number(source.version) > CONVERSATION_VERSION
  ) {
    throw new TypeError(`Conversation version ${source.version} is newer than this page supports.`);
  }
  if (!Array.isArray(source.messages)) throw new TypeError("Conversation JSON must contain a messages array.");
  if (source.messages.length > 10_000) throw new TypeError("Conversation JSON contains more than 10,000 messages.");
  const attachments = Array.isArray(source.attachments) ? source.attachments.map(normalizeAttachment) : [];
  const attachmentIds = new Set(attachments.map((item) => item.id));
  const messages = source.messages.map(normalizeImportedMessage);
  for (const message of messages) message.attachments = message.attachments.filter((id) => attachmentIds.has(id));

  return {
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Imported chat",
    endpoint: typeof source.endpoint === "string" ? source.endpoint : "",
    model: typeof source.model === "string" ? source.model : "",
    systemPrompt: typeof source.systemPrompt === "string" ? source.systemPrompt : "",
    parameters: normalizeParameters(source.parameters),
    messages,
    attachments,
  };
}

function exportedMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.attachments?.length ? { attachments: [...message.attachments] } : {}),
    ...(message.toolCalls?.length ? { toolCalls: message.toolCalls.map((call) => normalizeToolCall(call)).filter(Boolean) } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.name ? { name: message.name } : {}),
    createdAt: message.createdAt,
    ...(message.updatedAt && message.updatedAt !== message.createdAt ? { updatedAt: message.updatedAt } : {}),
    ...(message.state && message.state !== "complete" ? { state: message.state } : {}),
    ...(Object.keys(message.meta ?? {}).length ? { meta: message.meta } : {}),
    ...(message.error ? { error: message.error } : {}),
  };
}

export function conversationDocument(state) {
  return {
    schema: CONVERSATION_SCHEMA,
    version: CONVERSATION_VERSION,
    exportedAt: new Date().toISOString(),
    title: state.title || "Chat",
    endpoint: state.endpoint,
    model: state.model,
    systemPrompt: state.systemPrompt,
    parameters: normalizeParameters(state.parameters),
    attachments: (state.attachments ?? []).map((attachment, index) => normalizeAttachment(attachment, index)),
    messages: state.messages.map(exportedMessage),
  };
}

function attachmentText(attachment) {
  if (!attachment?.text) return "";
  return `\n\n<attachment name=${JSON.stringify(attachment.name)} type=${JSON.stringify(attachment.type)}>\n${attachment.text}\n</attachment>`;
}

function imageAttachmentText(attachment) {
  return `\n\n<image_attachment id=${JSON.stringify(attachment.id)} name=${JSON.stringify(attachment.name)} type=${JSON.stringify(attachment.type)} />`;
}

export function apiMessages(messages, systemPrompt = "", attachments = [], options = {}) {
  const result = [];
  if (systemPrompt.trim()) result.push({ role: "system", content: systemPrompt.trim() });
  if (typeof options.compactionEnvelope === "string" && options.compactionEnvelope.trim()) {
    result.push({ role: "system", content: options.compactionEnvelope.trim() });
  }
  const compactedIds = new Set(options.compactedMessageIds ?? []);
  const imageOverrides = options.imageOverrides instanceof Map ? options.imageOverrides : new Map();
  const resourceIndexes = options.resourceIndexes instanceof Map ? options.resourceIndexes : new Map();
  const reasoningMessageIds = new Set(options.reasoningMessageIds ?? []);
  const attachmentMap = attachments instanceof Map ? attachments : new Map(attachments.map((item) => [item.id, item]));

  for (const message of messages) {
    if (compactedIds.has(message.id)) continue;
    if (!SUPPORTED_ROLES.has(message.role)) continue;
    if (message.state === "error" && !message.content && !message.toolCalls?.length) continue;

    if (message.role === "tool") {
      if (!message.toolCallId || !message.content) continue;
      const projectedContent = resourceIndexes.get(message.meta?.resourceId) || message.content;
      result.push({ role: "tool", tool_call_id: message.toolCallId, ...(message.name ? { name: message.name } : {}), content: projectedContent });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      result.push({
        role: "assistant",
        content: message.content || null,
        ...(options.preserveToolReasoning && message.reasoning ? { reasoning_content: message.reasoning } : {}),
        tool_calls: message.toolCalls.map((call) => normalizeToolCall(call)).filter(Boolean),
      });
      continue;
    }

    if (message.role === "assistant" && reasoningMessageIds.has(message.id) && message.reasoning) {
      result.push({ role: "assistant", content: message.content || null, reasoning_content: message.reasoning });
      continue;
    }

    const linked = (message.attachments ?? []).map((id) => attachmentMap.get(id)).filter(Boolean);
    const images = linked.filter((item) => item.kind === "image" && item.dataUrl);
    const text = `${message.content ?? ""}${images.map(imageAttachmentText).join("")}${linked.filter((item) => item.kind !== "image").map(attachmentText).join("")}`;
    if (!text && !images.length) continue;

    if (message.role === "user" && images.length) {
      const content = [];
      if (text) content.push({ type: "text", text });
      for (const image of images) {
        const override = imageOverrides.get(image.id);
        content.push({ type: "image_url", image_url: { url: override?.dataUrl || image.dataUrl } });
      }
      result.push({ role: message.role, content });
    } else {
      result.push({ role: message.role, content: text });
    }
  }
  return result;
}

function htmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function baselineAttachmentList(message, attachmentMap) {
  const names = (message.attachments ?? []).map((id) => attachmentMap.get(id)?.name).filter(Boolean);
  return names.length ? `\n\nAttachments: ${names.map((name) => `\`${name}\``).join(", ")}` : "";
}

function baselineConversationMarkdown(session, attachmentMap) {
  const lines = [`# ${session.title || "Conversation"}`, ""];
  if (session.model) lines.push(`Model: \`${session.model}\``, "");
  for (const message of session.messages ?? []) {
    if (message.role === "tool") {
      lines.push(`<details><summary>Tool · ${message.name || message.toolCallId || "result"}</summary>`, "", "```text", message.content, "```", "", "</details>", "");
      continue;
    }
    lines.push(`## ${message.role[0].toUpperCase()}${message.role.slice(1)}`, "");
    if (message.reasoning) lines.push("<details><summary>Reasoning</summary>", "", message.reasoning, "", "</details>", "");
    lines.push(message.content || "", baselineAttachmentList(message, attachmentMap), "");
  }
  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}

function markdownAttachmentDetails(message, attachmentMap) {
  const attachments = (message.attachments ?? []).map((id) => attachmentMap.get(id)).filter(Boolean);
  if (!attachments.length) return [];
  const lines = ["<details><summary>Attachments · exact chat references</summary>", ""];
  for (const attachment of attachments) {
    const size = Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0;
    const name = String(attachment.name || "attachment");
    const type = String(attachment.type || "application/octet-stream");
    lines.push(`### ${name}`, "", `Type: \`${type}\` · ${size.toLocaleString()} bytes`, "");
    if (attachment.kind === "image" && attachment.dataUrl) {
      lines.push(`<img src="${htmlAttribute(attachment.dataUrl)}" alt="${htmlAttribute(name)}">`, "");
    } else if (attachment.text) {
      lines.push("```text", attachment.text, "```", "");
    }
    if (attachment.dataUrl) {
      lines.push(`<a href="${htmlAttribute(attachment.dataUrl)}" download="${htmlAttribute(name)}">Download exact attachment bytes</a>`, "");
    }
  }
  lines.push("</details>", "");
  return lines;
}

function toolRequestDetails(message) {
  const lines = [];
  for (const call of message.toolCalls ?? []) {
    let args = call.function.arguments;
    try { args = JSON.stringify(JSON.parse(args || "{}"), null, 2); } catch { /* Preserve malformed arguments verbatim. */ }
    lines.push(
      `<details><summary>Tool request · ${call.function.name || "pending"} · ${call.id}</summary>`,
      "",
      "```json",
      typeof args === "string" ? args : JSON.stringify(args, null, 2),
      "```",
      "",
      "</details>",
      "",
    );
  }
  return lines;
}

export function conversationMarkdown(session, options = {}) {
  const attachmentMap = new Map((session.attachments ?? []).map((item) => [item.id, item]));
  if (options.complete === false) return baselineConversationMarkdown(session, attachmentMap);
  const lines = [`# ${session.title || "Conversation"}`, ""];
  if (session.model) lines.push(`Model: \`${session.model}\``, "");
  if (session.compactions?.length) {
    lines.push("## Context records", "");
    for (const compaction of session.compactions) {
      lines.push(
        `<details><summary>${compaction.active ? "Active" : "Inactive"} ${compaction.mode === "soft" ? "Soft index" : "Normal summary"} · ${compaction.messageIds.length} originals · ${compaction.id}</summary>`,
        "",
        compaction.summary || "(empty summary)",
        "",
        `Original message ids: ${compaction.messageIds.map((id) => `\`${id}\``).join(", ")}`,
      );
      if (compaction.searchTerms?.length) lines.push("", `Searchable values: ${compaction.searchTerms.map((term) => `\`${term}\``).join(", ")}`);
      lines.push("", "</details>", "");
    }
  }
  for (const [index, message] of (session.messages ?? []).entries()) {
    if (message.role === "tool") {
      lines.push(
        `<details><summary>Tool result · ${message.name || "result"} · ${message.toolCallId || message.id}</summary>`,
        "",
        message.content || "(empty result)",
        "",
        ...(message.error ? [`**Error:** ${message.error}`, ""] : []),
        "</details>",
        "",
      );
      continue;
    }
    const state = message.state && message.state !== "complete" ? ` · ${message.state}` : "";
    lines.push(`## ${message.role[0].toUpperCase()}${message.role.slice(1)} · #${index + 1}${state}`, "");
    if (message.reasoning) lines.push(`<details><summary>Reasoning · ${message.reasoning.length.toLocaleString()} characters</summary>`, "", message.reasoning, "", "</details>", "");
    lines.push(...toolRequestDetails(message));
    lines.push(message.content || "", ...markdownAttachmentDetails(message, attachmentMap));
    if (message.error) lines.push(`> **Turn error:** ${message.error}`, "");
  }
  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}
