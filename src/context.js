import { messageId } from "./transcript.js";

export const DEFAULT_CONTEXT_WINDOW = 131_072;
export const RESOURCE_SECTION_CHARS = 12_000;

function text(value) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

export function estimateTokens(value) {
  const source = text(value);
  if (!source) return 0;
  const bytes = new TextEncoder().encode(source).length;
  const words = source.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(Math.max(bytes / 4, words * 0.72)));
}

export function sessionContextStats(session, projectedMessages = null) {
  const projection = projectedMessages ?? session.messages ?? [];
  const estimatedTokens = estimateTokens(projection);
  const latestUsage = [...(session.messages ?? [])].reverse()
    .find((message) => Number.isFinite(Number(message.meta?.usage?.total_tokens)))?.meta?.usage;
  const recordedTokens = Number(latestUsage?.total_tokens);
  const activeCompaction = (session.compactions ?? [])
    .some((item) => item.id === session.activeCompactionId && item.active);
  const tokens = activeCompaction
    ? estimatedTokens
    : Math.max(estimatedTokens, Number.isFinite(recordedTokens) ? recordedTokens : 0);
  const contextWindow = Math.max(1, Math.trunc(Number(session.parameters?.contextWindow) || DEFAULT_CONTEXT_WINDOW));
  return {
    tokens,
    estimatedTokens,
    recordedTokens: Number.isFinite(recordedTokens) ? recordedTokens : null,
    contextWindow,
    percent: Math.min(999, (tokens / contextWindow) * 100),
  };
}

export function cleanToolMarkdown(value) {
  return text(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function segmentMarkdown(value, maxChars = RESOURCE_SECTION_CHARS) {
  const source = text(value);
  if (!source) return [""];
  const width = Math.max(64, Math.trunc(Number(maxChars) || RESOURCE_SECTION_CHARS));
  if (source.length <= width) return [source];
  const sections = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source.length - cursor <= width) {
      sections.push(source.slice(cursor));
      break;
    }
    const target = cursor + width;
    const minimum = cursor + Math.floor(width * 0.55);
    let cut = source.lastIndexOf("\n\n", target);
    if (cut >= minimum) cut += 2;
    else {
      cut = source.lastIndexOf("\n", target);
      if (cut >= minimum) cut += 1;
      else {
        cut = source.lastIndexOf(" ", target);
        if (cut >= minimum) cut += 1;
        else cut = target;
      }
    }
    sections.push(source.slice(cursor, cut));
    cursor = cut;
  }
  return sections;
}

export function createContextResource(value, additions = {}) {
  const content = text(value);
  const sections = segmentMarkdown(content, additions.maxChars);
  return {
    id: additions.id || messageId("resource"),
    kind: additions.kind || "document",
    name: additions.name || "Browser tool result",
    sourceTool: additions.sourceTool || "",
    content,
    sections,
    createdAt: additions.createdAt || new Date().toISOString(),
  };
}

export function resourceIndex(resource, options = {}) {
  const includeFirst = options.includeFirst !== false;
  const headings = resource.sections.map((section, index) => {
    const heading = section.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
    return `${index + 1}. section ${index + 1}${heading ? ` — ${heading}` : ""} (${section.length.toLocaleString()} characters)`;
  });
  const lines = [
    `# Indexed browser result: ${resource.name}`,
    "",
    `Resource id: \`${resource.id}\``,
    `${resource.sections.length} ordered section${resource.sections.length === 1 ? "" : "s"}; use \`context_read\` with this resource id and a one-based section number to open any section exactly.`,
    "",
    ...headings,
  ];
  if (includeFirst && resource.sections[0]) {
    lines.push("", "## Open section 1", "", resource.sections[0]);
  }
  return lines.join("\n");
}

export function compactionEnvelope(compaction, messages) {
  if (!compaction?.active || !Array.isArray(compaction.messageIds) || !compaction.messageIds.length) return "";
  const selected = new Set(compaction.messageIds);
  const ordered = messages.filter((message) => selected.has(message.id));
  const list = ordered.map((message, index) => {
    const label = message.role === "tool" ? `${message.role}:${message.name || "result"}` : message.role;
    const preview = (message.content || message.reasoning || "(empty)").replace(/\s+/g, " ").slice(0, 120);
    return `${index + 1}. \`${message.id}\` · ${label} · ${preview}${preview.length >= 120 ? "…" : ""}`;
  });
  return [
    `<compacted_context id=${JSON.stringify(compaction.id)} mode=${JSON.stringify(compaction.mode)}>`,
    compaction.summary || "Selected context was collapsed without a generated summary.",
    "",
    "Collapsed originals remain available in exact form. Call context_read with kind=message or kind=reasoning and the listed id:",
    ...list,
    "</compacted_context>",
  ].join("\n");
}

export function timelineMarkdown(session) {
  const active = (session.compactions ?? []).find((item) => item.id === session.activeCompactionId && item.active);
  const selected = new Set(active?.messageIds ?? []);
  const lines = ["# Conversation timeline", ""];
  for (const [index, message] of (session.messages ?? []).entries()) {
    const label = message.role === "tool" ? `${message.role}:${message.name || "result"}` : message.role;
    const state = message.state && message.state !== "complete" ? ` · ${message.state}` : "";
    const compacted = selected.has(message.id) ? " · compacted" : "";
    lines.push(`${index + 1}. \`${message.id}\` · ${label}${state}${compacted} · ${estimateTokens(message.content || message.reasoning)} estimated tokens`);
  }
  return lines.join("\n");
}
