import { normalizeLocalServiceUrl } from "./local-endpoint.js";
import { SseDataParser } from "./openai.js";

export const MODERN_MCP_VERSION = "2026-07-28";
export const LEGACY_MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const CLIENT_INFO = { name: "llm.shel.sh", version: "1.0.0" };

export class McpError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "McpError";
    this.code = options.code ?? "MCP_ERROR";
    this.status = options.status ?? null;
    this.detail = options.detail ?? "";
  }
}

async function responseTextError(response) {
  const detail = (await response.text().catch(() => "")).slice(0, 8_000);
  let message = `MCP endpoint returned HTTP ${response.status}.`;
  let code = "HTTP_ERROR";
  try {
    const payload = JSON.parse(detail);
    message = payload?.error?.message || payload?.message || message;
    code = payload?.error?.code ?? payload?.code ?? code;
  } catch {
    if (detail) message = `${message} ${detail.slice(0, 300)}`;
  }
  return new McpError(message, { code, status: response.status, detail });
}

async function parseResponse(response, requestId) {
  if (response.status === 202 || response.status === 204) return null;
  if (!response.ok) throw await responseTextError(response);
  const contentType = response.headers.get("content-type") ?? "";
  let messages = [];
  if (contentType.includes("text/event-stream")) {
    const parser = new SseDataParser();
    const reader = response.body?.getReader();
    if (!reader) throw new McpError("MCP returned an empty event stream.", { code: "EMPTY_RESPONSE" });
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        for (const value of parser.push(decoder.decode(part.value, { stream: true }))) {
          if (!value.trim()) continue;
          try { messages.push(JSON.parse(value)); } catch { /* Ignore non-JSON SSE keepalives. */ }
        }
      }
      for (const value of [...parser.push(decoder.decode()), ...parser.finish()]) {
        try { messages.push(JSON.parse(value)); } catch { /* Ignore a trailing keepalive. */ }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const text = await response.text();
    if (!text.trim() && requestId == null) return null;
    if (!text.trim()) throw new McpError("MCP returned an empty response.", { code: "EMPTY_RESPONSE" });
    try {
      const parsed = JSON.parse(text);
      messages = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      throw new McpError("MCP response was not valid JSON.", { code: "INVALID_JSON", detail: text.slice(0, 2_000), cause: error });
    }
  }
  const message = messages.find((item) => item && item.id === requestId) ?? messages.find((item) => item?.error || item?.result);
  if (!message) throw new McpError("MCP response did not include the requested JSON-RPC result.", { code: "MISSING_RESULT" });
  if (message.error) throw new McpError(message.error.message || "MCP returned a JSON-RPC error.", {
    code: message.error.code ?? "RPC_ERROR",
    detail: JSON.stringify(message.error),
  });
  return message.result;
}

function modernMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN_MCP_VERSION,
    "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

function nameHeader(method, params) {
  if (typeof params?.name === "string") return params.name;
  if (typeof params?.uri === "string") return params.uri;
  if (typeof params?.taskId === "string") return params.taskId;
  return "";
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function encodedHeaderValue(value) {
  const text = String(value);
  const sentinel = text.startsWith("=?base64?") && text.endsWith("?=");
  const plainAscii = /^[\x09\x20-\x7e]*$/.test(text) && text.trim() === text && !sentinel;
  return plainAscii ? text : `=?base64?${encodeBase64(text)}?=`;
}

const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function toolHeaderMappings(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const mappings = [];
  const names = new Set();

  const walk = (node, path, reachable) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, path, false);
      return;
    }
    if (Object.hasOwn(node, "x-mcp-header")) {
      const name = node["x-mcp-header"];
      if (!reachable || !path.length) throw new McpError("x-mcp-header must be on a property reachable only through properties.", { code: "INVALID_TOOL_SCHEMA" });
      if (typeof name !== "string" || !name || !HEADER_TOKEN.test(name)) throw new McpError("x-mcp-header must be a non-empty HTTP token.", { code: "INVALID_TOOL_SCHEMA" });
      if (!["string", "integer", "boolean"].includes(node.type)) throw new McpError("x-mcp-header properties must have type string, integer, or boolean.", { code: "INVALID_TOOL_SCHEMA" });
      const folded = name.toLowerCase();
      if (names.has(folded)) throw new McpError("x-mcp-header names must be unique within a tool schema.", { code: "INVALID_TOOL_SCHEMA" });
      names.add(folded);
      mappings.push({ name, path, type: node.type });
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "x-mcp-header") continue;
      if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
        for (const [property, propertySchema] of Object.entries(child)) walk(propertySchema, [...path, property], reachable);
      } else if (child && typeof child === "object") {
        walk(child, path, false);
      }
    }
  };

  walk(schema, [], true);
  return mappings;
}

function toolArgumentHeaders(tool, argumentsValue) {
  const headers = {};
  for (const mapping of toolHeaderMappings(tool?.inputSchema)) {
    let value = argumentsValue;
    let present = true;
    for (const component of mapping.path) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, component)) {
        present = false;
        break;
      }
      value = value[component];
    }
    if (!present || value == null) continue;
    const valid = mapping.type === "string"
      ? typeof value === "string"
      : mapping.type === "boolean" ? typeof value === "boolean" : Number.isSafeInteger(value);
    if (!valid) throw new McpError(`MCP header argument ${mapping.path.join(".")} does not match its ${mapping.type} schema.`, { code: "INVALID_HEADER_ARGUMENT" });
    headers[`Mcp-Param-${mapping.name}`] = encodedHeaderValue(value);
  }
  return headers;
}

export class McpHttpClient {
  constructor(url, options = {}) {
    this.url = normalizeLocalServiceUrl(url, { emptyMessage: "Enter a local MCP Streamable HTTP endpoint." });
    const fetchImpl = options.fetchImpl ?? fetch;
    this.fetchImpl = (...argumentsValue) => fetchImpl(...argumentsValue);
    this.mode = "";
    this.protocolVersion = "";
    this.sessionId = "";
    this.serverInfo = null;
    this.instructions = "";
    this.tools = [];
    this.nextId = 1;
  }

  async post(payload, options = {}) {
    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    if (options.modern) {
      headers["MCP-Protocol-Version"] = MODERN_MCP_VERSION;
      headers["Mcp-Method"] = payload.method;
      const name = nameHeader(payload.method, payload.params);
      if (name) headers["Mcp-Name"] = encodedHeaderValue(name);
    } else {
      if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
      if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    }
    Object.assign(headers, options.headers ?? {});
    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: options.signal,
      });
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      throw new McpError(`The browser could not reach the local MCP endpoint.${detail}`, { code: "NETWORK_ERROR", cause: error });
    }
    const assigned = response.headers.get("mcp-session-id");
    if (assigned) this.sessionId = assigned;
    return parseResponse(response, payload.id);
  }

  async request(method, params = {}, options = {}) {
    const id = this.nextId++;
    const modern = options.modern ?? this.mode === "modern";
    const decorated = modern ? { ...params, _meta: { ...(params._meta ?? {}), ...modernMeta() } } : params;
    return this.post({ jsonrpc: "2.0", id, method, params: decorated }, { ...options, modern });
  }

  async notify(method, params = {}, options = {}) {
    const modern = options.modern ?? this.mode === "modern";
    const decorated = modern ? { ...params, _meta: { ...(params._meta ?? {}), ...modernMeta() } } : params;
    return this.post({ jsonrpc: "2.0", method, params: decorated }, { ...options, modern });
  }

  async connect(options = {}) {
    let modernError;
    let discovery;
    try {
      discovery = await this.request("server/discover", {}, { modern: true, signal: options.signal });
      const versions = Array.isArray(discovery?.supportedVersions) ? discovery.supportedVersions : [];
      if (versions.length && !versions.includes(MODERN_MCP_VERSION)) throw new McpError("Server does not advertise the current stateless MCP version.", { code: "UNSUPPORTED_MODERN" });
    } catch (error) {
      modernError = error;
      if (error?.status === 401 || error?.status === 403) throw error;
    }

    if (modernError?.code !== "UNSUPPORTED_MODERN") {
      try {
        this.mode = "modern";
        this.protocolVersion = MODERN_MCP_VERSION;
        this.sessionId = "";
        this.serverInfo = discovery?._meta?.["io.modelcontextprotocol/serverInfo"] ?? discovery?.serverInfo ?? null;
        this.instructions = typeof discovery?.instructions === "string" ? discovery.instructions : "";
        return await this.listTools(options);
      } catch (error) {
        modernError = error;
        if (error?.status === 401 || error?.status === 403) throw error;
      }
    }

    let legacyError;
    for (const requestedVersion of LEGACY_MCP_VERSIONS) {
      try {
        this.mode = "legacy";
        this.protocolVersion = "";
        this.sessionId = "";
        const initialized = await this.request("initialize", {
          protocolVersion: requestedVersion,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        }, { modern: false, signal: options.signal });
        this.protocolVersion = initialized?.protocolVersion || requestedVersion;
        this.serverInfo = initialized?.serverInfo ?? null;
        this.instructions = typeof initialized?.instructions === "string" ? initialized.instructions : "";
        await this.notify("notifications/initialized", {}, { modern: false, signal: options.signal });
        return await this.listTools(options);
      } catch (error) {
        legacyError = error;
      }
    }
    const modernMessage = modernError instanceof Error ? modernError.message : "modern probe failed";
    const legacyMessage = legacyError instanceof Error ? legacyError.message : "legacy initialization failed";
    throw new McpError(`MCP connection failed. Modern: ${modernMessage} Legacy: ${legacyMessage}`, { code: "CONNECT_FAILED", cause: legacyError ?? modernError });
  }

  async listTools(options = {}) {
    const tools = [];
    const cursors = new Set();
    let cursor;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, { signal: options.signal });
      if (Array.isArray(result?.tools)) {
        for (const tool of result.tools) {
          try {
            toolHeaderMappings(tool?.inputSchema);
            tools.push(tool);
          } catch (error) {
            console.warn(`Ignoring invalid MCP tool ${tool?.name || "(unnamed)"}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (cursor && cursors.has(cursor)) throw new McpError("MCP tools/list repeated a pagination cursor.", { code: "PAGINATION_LOOP" });
      if (cursor) cursors.add(cursor);
    } while (cursor && tools.length < 10_000 && cursors.size < 1_000);
    this.tools = tools;
    return tools;
  }

  async callTool(name, argumentsValue = {}, options = {}) {
    const tool = this.tools.find((candidate) => candidate.name === name);
    const headers = tool ? toolArgumentHeaders(tool, argumentsValue) : {};
    const result = await this.request("tools/call", { name, arguments: argumentsValue }, { signal: options.signal, headers });
    if (result?.resultType === "input_required") {
      throw new McpError("This MCP tool requires an interactive follow-up that the static harness cannot answer automatically.", { code: "INPUT_REQUIRED" });
    }
    return result;
  }

  async close() {
    if (this.mode !== "legacy" || !this.sessionId) return;
    await this.fetchImpl(this.url, {
      method: "DELETE",
      headers: { "MCP-Protocol-Version": this.protocolVersion, "Mcp-Session-Id": this.sessionId },
    }).catch(() => {});
    this.sessionId = "";
  }
}

function shortHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function mcpFunctionName(serverId, toolName) {
  const prefix = String(serverId).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 18) || "server";
  const tool = String(toolName).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34) || "tool";
  return `mcp_${prefix}_${tool}_${shortHash(`${serverId}:${toolName}`)}`.slice(0, 64);
}

export function mcpToolsForOpenAi(server, tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: mcpFunctionName(server.id, tool.name),
      description: `[${server.name}] ${tool.description || tool.title || tool.name}`.slice(0, 1_024),
      parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    },
  }));
}

export function mcpResultText(result) {
  const pieces = [];
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type === "text" && typeof item.text === "string") pieces.push(item.text);
    else if (item?.type === "resource" && item.resource) pieces.push(JSON.stringify(item.resource, null, 2));
    else if (item?.type === "image" && item.data) pieces.push(`[image result: ${item.mimeType || "image"}, ${item.data.length} base64 characters]`);
    else if (item != null) pieces.push(JSON.stringify(item, null, 2));
  }
  if (result?.structuredContent != null) pieces.push(JSON.stringify(result.structuredContent, null, 2));
  if (!pieces.length) pieces.push(JSON.stringify(result ?? {}, null, 2));
  return pieces.join("\n\n");
}
