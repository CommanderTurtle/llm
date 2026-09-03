import { localFetchOptions, normalizeLocalServiceUrl } from "./local-endpoint.js";

export class FirecrawlError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "FirecrawlError";
    this.status = options.status ?? null;
    this.detail = options.detail ?? "";
  }
}

export function normalizeFirecrawlUrl(input) {
  const parsed = new URL(normalizeLocalServiceUrl(input, { emptyMessage: "Enter the local Firecrawl URL." }));
  const path = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = path.endsWith("/v2") ? path : `${path}/v2`.replace(/^\/\//, "/");
  return parsed.toString().replace(/\/$/, "");
}

function resource(base, name) {
  return `${normalizeFirecrawlUrl(base)}/${String(name).replace(/^\/+/, "")}`;
}

async function request(base, name, body, options = {}) {
  const url = resource(base, name);
  let response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, localFetchOptions(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: options.signal,
    }));
  } catch (error) {
    throw new FirecrawlError("The browser could not reach the local Firecrawl service.", { cause: error });
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new FirecrawlError(`Firecrawl returned HTTP ${response.status} with invalid JSON.`, { status: response.status, detail: text.slice(0, 4_000) });
  }
  if (!response.ok || payload?.success === false) {
    throw new FirecrawlError(payload?.error || payload?.message || `Firecrawl returned HTTP ${response.status}.`, {
      status: response.status,
      detail: text.slice(0, 8_000),
    });
  }
  return payload;
}

export function formatSearchResults(payload) {
  const data = payload?.data;
  const web = Array.isArray(data) ? data : Array.isArray(data?.web) ? data.web : [];
  if (!web.length) return "No web results were returned.";
  return web.map((item, index) => {
    const title = item?.title || item?.metadata?.title || `Result ${index + 1}`;
    const url = item?.url || item?.metadata?.sourceURL || item?.metadata?.url || "";
    const description = item?.description || item?.metadata?.description || "";
    const markdown = item?.markdown || "";
    return [`## ${index + 1}. ${title}`, url, description, markdown].filter(Boolean).join("\n\n");
  }).join("\n\n---\n\n");
}

export async function searchFirecrawl(base, argumentsValue, options = {}) {
  const query = typeof argumentsValue?.query === "string" ? argumentsValue.query.trim() : "";
  if (!query) throw new FirecrawlError("web_search requires a non-empty query.");
  const limit = Math.max(1, Math.min(10, Math.trunc(Number(argumentsValue.limit) || Number(options.defaultLimit) || 5)));
  const payload = await request(base, "search", {
    query,
    limit,
    sources: ["web"],
    scrapeOptions: { formats: [{ type: "markdown" }], onlyMainContent: true },
  }, options);
  return formatSearchResults(payload);
}

export async function scrapeFirecrawl(base, argumentsValue, options = {}) {
  const url = typeof argumentsValue?.url === "string" ? argumentsValue.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) throw new FirecrawlError("web_scrape requires an http:// or https:// URL.");
  const payload = await request(base, "scrape", {
    url,
    formats: [{ type: "markdown" }],
    onlyMainContent: true,
  }, options);
  const data = payload?.data ?? payload;
  return data?.markdown || data?.content || JSON.stringify(data, null, 2);
}

export async function testFirecrawl(base, options = {}) {
  return searchFirecrawl(base, { query: "Firecrawl", limit: 1 }, options);
}
