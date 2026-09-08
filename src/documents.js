import { messageId } from "./transcript.js";

const CODE_LANGUAGES = new Set([
  "js", "javascript", "jsx", "ts", "typescript", "tsx", "json", "css", "html", "xml",
  "py", "python", "sh", "bash", "powershell", "ps1", "c", "cpp", "csharp", "cs", "java", "rust", "rs",
]);

export function lineHash(value) {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(String(value));
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function iso(value, fallback = new Date().toISOString()) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function revisionSnapshot(value, fallbackRevision = 1) {
  if (!value || typeof value !== "object") return null;
  return {
    revision: Math.max(1, Math.trunc(Number(value.revision) || fallbackRevision)),
    content: typeof value.content === "string" ? value.content : "",
    createdAt: iso(value.createdAt),
    actor: typeof value.actor === "string" ? value.actor : "unknown",
  };
}

export function createBrowserDocument(additions = {}) {
  const now = new Date().toISOString();
  const content = typeof additions.content === "string" ? additions.content : "";
  const revision = Math.max(1, Math.trunc(Number(additions.revision) || 1));
  const revisions = Array.isArray(additions.revisions)
    ? additions.revisions.map((value, index) => revisionSnapshot(value, index + 1)).filter(Boolean)
    : [];
  if (!revisions.some((entry) => entry.revision === revision)) {
    revisions.push({ revision, content, createdAt: iso(additions.updatedAt, now), actor: additions.actor || "user" });
  }
  revisions.sort((left, right) => left.revision - right.revision);
  return {
    id: typeof additions.id === "string" && additions.id ? additions.id : messageId("document"),
    name: typeof additions.name === "string" && additions.name.trim() ? additions.name.trim().slice(0, 180) : "untitled.md",
    language: typeof additions.language === "string" && additions.language.trim() ? additions.language.trim().toLowerCase() : languageFromName(additions.name),
    content,
    revision,
    revisions,
    createdAt: iso(additions.createdAt, now),
    updatedAt: iso(additions.updatedAt, now),
  };
}

export function languageFromName(name = "") {
  const extension = String(name).toLowerCase().split(".").pop();
  const aliases = { md: "markdown", mjs: "javascript", cjs: "javascript", jsx: "javascript", tsx: "typescript", py: "python", rs: "rust", ps1: "powershell", yml: "yaml" };
  return aliases[extension] || extension || "text";
}

function scanDelimiters(source, language, lineOffset = 0) {
  if (!CODE_LANGUAGES.has(language)) return [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closing = new Set(Object.values(pairs));
  const stack = [];
  const diagnostics = [];
  let line = 1;
  let column = 0;
  let quote = "";
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";
    column += 1;
    if (char === "\n") {
      line += 1;
      column = 0;
      lineComment = false;
      continue;
    }
    if (lineComment) continue;
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; column += 1; }
      continue;
    }
    if (quote) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; index += 1; column += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; column += 1; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (pairs[char]) stack.push({ char, line, column });
    else if (closing.has(char)) {
      const open = stack.pop();
      if (!open || pairs[open.char] !== char) {
        diagnostics.push({ line: line + lineOffset, column, message: `Unexpected ${char}.`, severity: "error" });
        if (open) stack.push(open);
      }
    }
  }
  for (const open of stack.slice(-20)) diagnostics.push({
    line: open.line + lineOffset,
    column: open.column,
    message: `Unclosed ${open.char}.`,
    severity: "error",
  });
  if (quote) diagnostics.push({ line: line + lineOffset, column: Math.max(1, column), message: "Unclosed string literal.", severity: "error" });
  if (blockComment) diagnostics.push({ line: line + lineOffset, column: Math.max(1, column), message: "Unclosed block comment.", severity: "error" });
  return diagnostics;
}

function jsonDiagnostic(source, lineOffset = 0) {
  try {
    JSON.parse(source);
    return [];
  } catch (error) {
    const position = Number(String(error?.message).match(/position\s+(\d+)/i)?.[1]);
    const before = Number.isFinite(position) ? source.slice(0, position) : "";
    return [{
      line: (before.match(/\n/g)?.length ?? 0) + 1 + lineOffset,
      column: before.length - before.lastIndexOf("\n"),
      message: error instanceof Error ? error.message : "Invalid JSON.",
      severity: "error",
    }];
  }
}

export function lintCode(source, language = "text", lineOffset = 0) {
  const normalized = String(language).toLowerCase();
  if (normalized === "json" || normalized === "jsonc") return normalized === "json" ? jsonDiagnostic(source, lineOffset) : scanDelimiters(source, "json", lineOffset);
  return scanDelimiters(source, normalized, lineOffset);
}

export function lintDocument(content, language = "markdown") {
  const source = String(content);
  const normalized = String(language || "text").toLowerCase();
  if (normalized !== "markdown" && normalized !== "md") return lintCode(source, normalized);
  const diagnostics = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let fence = null;
  let body = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(```|~~~)\s*([^\s`]*)/);
    if (!fence && match) {
      fence = { marker: match[1], language: (match[2] || "text").toLowerCase(), line: index + 1 };
      body = [];
    } else if (fence && new RegExp(`^\\s*${fence.marker}\\s*$`).test(lines[index])) {
      diagnostics.push(...lintCode(body.join("\n"), fence.language, fence.line));
      fence = null;
      body = [];
    } else if (fence) body.push(lines[index]);
  }
  if (fence) diagnostics.push({ line: fence.line, column: 1, message: `Unclosed ${fence.marker} code fence.`, severity: "error" });
  return diagnostics;
}

export function hashlineDocument(documentValue) {
  const lines = documentValue.content.replace(/\r\n?/g, "\n").split("\n");
  const body = lines.map((line, index) => `${String(index + 1).padStart(5, " ")}#${lineHash(line)} ${line}`).join("\n");
  const diagnostics = lintDocument(documentValue.content, documentValue.language);
  const diagnosticText = diagnostics.length
    ? diagnostics.map((item) => `- L${item.line}:${item.column} ${item.message}`).join("\n")
    : "- none";
  return [
    `Document: ${documentValue.name}`,
    `Revision: ${documentValue.revision}`,
    `Language: ${documentValue.language}`,
    "Each editable line is prefixed by line#stable-hash. Use those hashes in put_document edits.",
    "",
    body,
    "",
    "Diagnostics:",
    diagnosticText,
  ].join("\n");
}

export function documentDraftFromResponse(value) {
  const source = String(value ?? "").replace(/\r\n?/g, "\n");
  const match = source.match(/(?:^|\n)DONE[ \t]*$/);
  if (!match) throw new Error("Response-backed PUT requires a final line containing only DONE.");
  // The matched newline is the DONE delimiter. Preserve everything before it,
  // including an intentional trailing blank line in the document itself.
  const content = source.slice(0, match.index);
  if (!content.trim()) throw new Error("Response-backed PUT did not contain document text before DONE.");
  return content;
}

function findHash(lines, hash, startAt = 0) {
  const matches = [];
  for (let index = startAt; index < lines.length; index += 1) if (lineHash(lines[index]) === hash) matches.push(index);
  if (matches.length !== 1) throw new Error(matches.length ? `Line hash ${hash} is ambiguous; read the current revision again.` : `Line hash ${hash} is stale or missing; read the current revision again.`);
  return matches[0];
}

export function applyHashlineEdits(content, edits) {
  const lines = String(content).replace(/\r\n?/g, "\n").split("\n");
  const changes = [];
  for (const [index, edit] of (edits ?? []).entries()) {
    if (!edit || typeof edit !== "object" || typeof edit.line_hash !== "string") throw new Error(`Edit ${index + 1} requires line_hash.`);
    const start = findHash(lines, edit.line_hash);
    const end = edit.end_hash ? findHash(lines, edit.end_hash, start) : start;
    if (end < start) throw new Error(`Edit ${index + 1} ends before it starts.`);
    changes.push({ start, end, content: typeof edit.content === "string" ? edit.content : "" });
  }
  changes.sort((left, right) => right.start - left.start);
  for (let index = 1; index < changes.length; index += 1) {
    if (changes[index - 1].start <= changes[index].end) throw new Error("Hashline edits overlap.");
  }
  for (const change of changes) lines.splice(change.start, change.end - change.start + 1, ...change.content.replace(/\r\n?/g, "\n").split("\n"));
  return lines.join("\n");
}

export function putBrowserDocument(documentValue, args, additions = {}) {
  const now = new Date().toISOString();
  const existing = documentValue ? createBrowserDocument(documentValue) : null;
  if (existing && additions.readRevision !== existing.revision) {
    throw new Error(`Read-before-write failed: ${existing.name} revision ${existing.revision} must be read before it can be edited.`);
  }
  if (existing && args.expected_revision != null && Number(args.expected_revision) !== existing.revision) {
    throw new Error(`Revision mismatch: expected ${args.expected_revision}, current ${existing.revision}. Read it again.`);
  }
  if (!existing && typeof args.content !== "string") throw new Error("Creating a document requires content.");
  if (existing && typeof args.content !== "string" && !Array.isArray(args.edits)) throw new Error("Provide content or hashline edits.");
  const previous = existing?.content ?? "";
  const nextContent = typeof args.content === "string" ? args.content : applyHashlineEdits(previous, args.edits);
  const revision = existing ? existing.revision + 1 : 1;
  const result = createBrowserDocument({
    ...existing,
    name: args.name || existing?.name,
    language: args.language || existing?.language,
    content: nextContent,
    revision,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revisions: [...(existing?.revisions ?? []), { revision, content: nextContent, createdAt: now, actor: additions.actor || "model" }],
  });
  return result;
}

export function diffRevision(before, after) {
  const left = String(before ?? "").replace(/\r\n?/g, "\n").split("\n");
  const right = String(after ?? "").replace(/\r\n?/g, "\n").split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const result = [];
  for (const line of left.slice(0, prefix)) result.push({ type: "context", text: line });
  for (const line of left.slice(prefix, left.length - suffix)) result.push({ type: "remove", text: line });
  for (const line of right.slice(prefix, right.length - suffix)) result.push({ type: "add", text: line });
  for (const line of left.slice(left.length - suffix)) result.push({ type: "context", text: line });
  return result;
}
