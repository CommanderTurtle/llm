import { scrapeFirecrawl, searchFirecrawl } from "./firecrawl.js";
import { mcpFunctionName, mcpResultText, mcpToolsForOpenAi } from "./mcp.js";
import { ocrImageAttachment } from "./ocr.js";

export const OCR_TOOL_NAME = "ocr_attachment";
export const SEARCH_TOOL_NAME = "web_search";
export const SCRAPE_TOOL_NAME = "web_scrape";

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
    const attachment = findAttachment(context.attachments, args.attachment);
    return ocrImageAttachment(attachment, { onProgress: context.onProgress });
  }
  if (name === SEARCH_TOOL_NAME) {
    return searchFirecrawl(context.integrations.firecrawl.url, args, {
      defaultLimit: context.integrations.firecrawl.limit,
      signal: context.signal,
    });
  }
  if (name === SCRAPE_TOOL_NAME) {
    return scrapeFirecrawl(context.integrations.firecrawl.url, args, { signal: context.signal });
  }
  for (const connection of context.mcpConnections.values()) {
    const tool = connection.tools.find((candidate) => mcpFunctionName(connection.server.id, candidate.name) === name);
    if (tool) return mcpResultText(await connection.client.callTool(tool.name, args, { signal: context.signal }));
  }
  throw new Error(`No enabled browser tool is registered as ${name}.`);
}
