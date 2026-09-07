import { scrapeFirecrawl, searchFirecrawl } from "./firecrawl.js";
import { mcpFunctionName, mcpResultText, mcpToolsForOpenAi } from "./mcp.js";
import { ocrImageAttachment } from "./ocr.js";

export const OCR_TOOL_NAME = "ocr_attachment";
export const SEARCH_TOOL_NAME = "web_search";
export const SCRAPE_TOOL_NAME = "web_scrape";
export const CONTEXT_TOOL_NAME = "context_read";
export const TODO_TOOL_NAME = "todo_update";
export const READ_DOCUMENT_TOOL_NAME = "read_document";
export const PUT_DOCUMENT_TOOL_NAME = "put_document";
export const READ_INSTRUCTIONS_TOOL_NAME = "instructions_read";
export const PUT_INSTRUCTIONS_TOOL_NAME = "instructions_put";

const LOCAL_TOOL_NAMES = new Set([
  CONTEXT_TOOL_NAME,
  TODO_TOOL_NAME,
  READ_DOCUMENT_TOOL_NAME,
  PUT_DOCUMENT_TOOL_NAME,
  READ_INSTRUCTIONS_TOOL_NAME,
  PUT_INSTRUCTIONS_TOOL_NAME,
]);

function localToolEnabled(name, integrations) {
  if (name === CONTEXT_TOOL_NAME) return integrations.localTools?.context === true;
  if (name === TODO_TOOL_NAME) return integrations.localTools?.todos === true;
  if (name === READ_DOCUMENT_TOOL_NAME || name === READ_INSTRUCTIONS_TOOL_NAME) return integrations.localTools?.read === true;
  if (name === PUT_DOCUMENT_TOOL_NAME || name === PUT_INSTRUCTIONS_TOOL_NAME) return integrations.localTools?.write === true;
  return false;
}

export function parseToolArguments(value) {
  if (value == null || value === "") return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("arguments must be an object");
    return parsed;
  } catch (error) {
    throw new Error(`Tool arguments were not valid JSON: ${error.message}`);
  }
}

export function openAiTools(integrations, mcpConnections = new Map()) {
  const tools = [];
  if (integrations.ocr.enabled) {
    tools.push({
      type: "function",
      function: {
        name: OCR_TOOL_NAME,
        description: "Read visible text from an image attached anywhere in this chat using the browser's local Tesseract OCR runtime. Pass its attachment id or exact filename.",
        parameters: {
          type: "object",
          properties: { attachment: { type: "string", description: "Attachment id or exact filename." } },
          required: ["attachment"],
          additionalProperties: false,
        },
      },
    });
  }
  if (integrations.firecrawl.enabled) {
    tools.push({
      type: "function",
      function: {
        name: SEARCH_TOOL_NAME,
        description: "Search the web through the user's local Firecrawl /v2 service and return source URLs plus scraped Markdown.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } },
          required: ["query"],
          additionalProperties: false,
        },
      },
    }, {
      type: "function",
      function: {
        name: SCRAPE_TOOL_NAME,
        description: "Scrape one public http(s) URL through the user's local Firecrawl /v2 service and return clean Markdown.",
        parameters: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
          additionalProperties: false,
        },
      },
    });
  }
  if (integrations.localTools?.context === true) {
    tools.push({
      type: "function",
      function: {
        name: CONTEXT_TOOL_NAME,
        description: "Read browser-local conversation material that is not automatically projected: the timeline, one exact original message, its optional reasoning, a compaction, or one ordered section of a long browser-tool resource.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["timeline", "message", "reasoning", "compaction", "resource"] },
            id: { type: "string", description: "Message, compaction, or resource id when required." },
            section: { type: "integer", minimum: 1, description: "One-based resource section." },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      },
    });
  }
  if (integrations.localTools?.read === true) {
    tools.push({
      type: "function",
      function: {
        name: READ_DOCUMENT_TOOL_NAME,
        description: "Read a browser-local editor document with revision, stable per-line hashes, and lint diagnostics. An existing document must be read at its current revision before put_document may edit it.",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "Exact document name." } },
          required: ["name"],
          additionalProperties: false,
        },
      },
    }, {
      type: "function",
      function: {
        name: READ_INSTRUCTIONS_TOOL_NAME,
        description: "Open the browser-local instructions.md document with hashline revision data and diagnostics.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    });
  }
  if (integrations.localTools?.read === true && integrations.localTools?.write === true) {
    const putParameters = {
      type: "object",
      properties: {
        name: { type: "string" },
        language: { type: "string" },
        expected_revision: { type: "integer", minimum: 1 },
        content: { type: "string", description: "Complete replacement content. Use edits for a smaller hashline patch." },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              line_hash: { type: "string" },
              end_hash: { type: "string" },
              content: { type: "string" },
            },
            required: ["line_hash", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["name"],
      anyOf: [{ required: ["content"] }, { required: ["edits"] }],
      additionalProperties: false,
    };
    tools.push({
      type: "function",
      function: {
        name: PUT_DOCUMENT_TOOL_NAME,
        description: "Create or hashline-edit a browser-local editor document. Editing an existing revision fails unless read_document returned that same revision first. Each successful put creates an immutable diffable revision.",
        parameters: putParameters,
      },
    }, {
      type: "function",
      function: {
        name: PUT_INSTRUCTIONS_TOOL_NAME,
        description: "Create or hashline-edit instructions.md. Existing instructions must be opened with instructions_read at the current revision first.",
        parameters: {
          ...putParameters,
          properties: Object.fromEntries(Object.entries(putParameters.properties).filter(([key]) => key !== "name")),
          required: [],
          anyOf: [{ required: ["content"] }, { required: ["edits"] }],
        },
      },
    });
  }
  if (integrations.localTools?.todos === true) {
    tools.push({
      type: "function",
      function: {
        name: TODO_TOOL_NAME,
        description: "Read or update the visible browser-local TODO checklist for this chat.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "add", "set", "remove"] },
            id: { type: "string" },
            text: { type: "string" },
            done: { type: "boolean" },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
    });
  }
  for (const connection of mcpConnections.values()) {
    if (!connection.server.enabled || !connection.tools.length) continue;
    tools.push(...mcpToolsForOpenAi(connection.server, connection.tools));
  }
  return tools;
}

function findAttachment(attachments, reference) {
  const exact = attachments.find((item) => item.id === reference || item.name === reference);
  if (exact) return exact;
  const normalized = String(reference).toLowerCase();
  const partial = attachments.filter((item) => item.name.toLowerCase().includes(normalized));
  if (partial.length === 1) return partial[0];
  throw new Error(partial.length ? `Attachment reference ${reference} is ambiguous.` : `Attachment ${reference} is not present in this chat.`);
}

export async function executeTool(call, context) {
  const name = call?.function?.name;
  const args = parseToolArguments(call?.function?.arguments);
  if (name === OCR_TOOL_NAME) {
    if (context.integrations.ocr?.enabled !== true) throw new Error("Local image OCR is disabled.");
    const attachment = findAttachment(context.attachments, args.attachment);
    return ocrImageAttachment(attachment, { onProgress: context.onProgress });
  }
  if (name === SEARCH_TOOL_NAME) {
    if (context.integrations.firecrawl?.enabled !== true) throw new Error("Firecrawl is disabled.");
    const result = await searchFirecrawl(context.integrations.firecrawl.url, args, {
      defaultLimit: context.integrations.firecrawl.limit,
      signal: context.signal,
    });
    return context.storeResource ? context.storeResource(result, { kind: "firecrawl-search", name: `Search: ${args.query}`, sourceTool: name }) : result;
  }
  if (name === SCRAPE_TOOL_NAME) {
    if (context.integrations.firecrawl?.enabled !== true) throw new Error("Firecrawl is disabled.");
    const result = await scrapeFirecrawl(context.integrations.firecrawl.url, args, { signal: context.signal });
    return context.storeResource ? context.storeResource(result, { kind: "firecrawl-scrape", name: `Scrape: ${args.url}`, sourceTool: name }) : result;
  }
  if (LOCAL_TOOL_NAMES.has(name)) {
    if (!localToolEnabled(name, context.integrations)) throw new Error(`The browser-local ${name} tool is disabled.`);
    if (!context.executeLocalTool) throw new Error(`The browser-local ${name} handler is unavailable.`);
    return context.executeLocalTool(name, args);
  }
  for (const connection of context.mcpConnections.values()) {
    const tool = connection.tools.find((candidate) => mcpFunctionName(connection.server.id, candidate.name) === name);
    if (tool) return mcpResultText(await connection.client.callTool(tool.name, args, { signal: context.signal }));
  }
  throw new Error(`No enabled browser tool is registered as ${name}.`);
}
