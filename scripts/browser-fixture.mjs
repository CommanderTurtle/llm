import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pagePort = Number.parseInt(process.env.LLM_FIXTURE_PAGE_PORT ?? "4273", 10);
const apiPort = Number.parseInt(process.env.LLM_FIXTURE_API_PORT ?? "4274", 10);
const pageOrigin = `http://127.0.0.1:${pagePort}`;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

const staticServer = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", pageOrigin).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(root, normalize(relative));
  if (!candidate.startsWith(`${root}${sep}`) && candidate !== root) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let file = candidate;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    if (!statSync(file).isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
});

function cors(response, status, headers = {}) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": pageOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Allow-Private-Network": "true",
    ...headers,
  });
}

function readJson(request, response, callback) {
  const buffers = [];
  request.on("data", (chunk) => buffers.push(chunk));
  request.on("end", () => {
    try {
      callback(JSON.parse(Buffer.concat(buffers).toString("utf8")));
    } catch {
      cors(response, 400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Invalid fixture request JSON" } }));
    }
  });
}

function rpc(response, id, result, headers = {}) {
  cors(response, 200, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function streamedCompletion(response, chunks, options = {}) {
  cors(response, 200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let index = 0;
  const write = () => {
    if (index >= chunks.length) {
      response.end(options.done === false ? "" : "data: [DONE]\n\n");
      return;
    }
    response.write(`data: ${JSON.stringify(chunks[index])}\n\n`);
    index += 1;
    setTimeout(write, options.delay ?? 20);
  };
  write();
}

function textFromUserContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => part.text || "").join("\n");
}

function handleCompletion(body, response) {
  if (!body?.model || !Array.isArray(body?.messages)) {
    cors(response, 400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Fixture requires model and messages" } }));
    return;
  }
  const last = body.messages.at(-1);
  if (last?.role === "tool") {
    streamedCompletion(response, [
      { id: "fixture-tool-final", model: body.model, choices: [{ delta: { reasoning_content: "Use the returned tool evidence. " } }] },
      { id: "fixture-tool-final", model: body.model, choices: [{ delta: { content: `Tool continuation complete: ${last.content}` } }] },
      { id: "fixture-tool-final", model: body.model, choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 24 } },
    ]);
    return;
  }

  const userText = textFromUserContent(last?.content);
  const prompt = userText.toLowerCase();
  if (prompt.includes("cut off fixture")) {
    streamedCompletion(response, [
      { id: "fixture-cutoff", model: body.model, choices: [{ delta: { content: "This fixture ends without terminal evidence." } }] },
    ], { done: false });
    return;
  }
  if (prompt.includes("length fixture")) {
    streamedCompletion(response, [
      { id: "fixture-length", model: body.model, choices: [{ delta: { content: "This fixture reaches its output allowance." } }] },
      { id: "fixture-length", model: body.model, choices: [{ delta: {}, finish_reason: "length" }] },
    ]);
    return;
  }
  if (prompt.includes("reasoning only fixture")) {
    streamedCompletion(response, [
      { id: "fixture-reasoning-only", model: body.model, choices: [{ delta: { reasoning_content: "The final answer has not been emitted yet." } }] },
      { id: "fixture-reasoning-only", model: body.model, choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    return;
  }
  const availableTools = Array.isArray(body.tools) ? body.tools : [];
  const requestedTool = prompt.includes("scrape fixture")
    ? availableTools.find((tool) => tool?.function?.name === "web_scrape")
    : prompt.includes("search fixture")
    ? availableTools.find((tool) => tool?.function?.name === "web_search")
    : prompt.includes("ocr fixture")
      ? availableTools.find((tool) => tool?.function?.name === "ocr_attachment")
      : prompt.includes("use fixture tool")
        ? availableTools.find((tool) => tool?.function?.name?.startsWith("mcp_"))
        : null;
  if (requestedTool) {
    const imageName = userText.match(/<image_attachment\b[^>]*\bname="([^"]+)"/)?.[1] ?? "ocr.svg";
    const args = requestedTool.function.name === "web_search"
      ? { query: "fixture query", limit: 1 }
      : requestedTool.function.name === "web_scrape" ? { url: "https://example.test/long" }
      : requestedTool.function.name === "ocr_attachment" ? { attachment: imageName } : { value: "hello" };
    streamedCompletion(response, [
      { id: "fixture-tool", model: body.model, choices: [{ delta: { tool_calls: [{ index: 0, id: "fixture-call-1", type: "function", function: { name: requestedTool.function.name, arguments: JSON.stringify(args).slice(0, 8) } }] } }] },
      { id: "fixture-tool", model: body.model, choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(8) } }] } }] },
      { id: "fixture-tool", model: body.model, choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
    return;
  }

  const hasImage = body.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part?.type === "image_url"));
  streamedCompletion(response, [
    { id: "fixture-1", model: body.model, choices: [{ delta: { reasoning_content: "Check the request. " } }] },
    { id: "fixture-1", model: body.model, choices: [{ delta: { content: `## Fixture response${hasImage ? " with image" : ""}\n\n` } }] },
    { id: "fixture-1", model: body.model, choices: [{ delta: { content: "```js\nconsole.log('local');\n```" } }] },
    { id: "fixture-1", model: body.model, choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 } },
  ], { delay: prompt.includes("slow fixture") ? 350 : 20 });
}

const apiServer = createServer((request, response) => {
  if (request.url === "/mcp") console.log(`fixture MCP ${request.method}`);
  if (request.method === "OPTIONS") {
    cors(response, 204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/v1/models") {
    cors(response, 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: "fixture-reasoner", max_model_len: 32768 }, { id: "fixture-chat", context_length: 16384 }] }));
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    readJson(request, response, (body) => handleCompletion(body, response));
    return;
  }

  if (request.method === "POST" && request.url === "/v2/search") {
    readJson(request, response, (body) => {
      cors(response, 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        success: true,
        data: { web: [{ title: `Fixture: ${body.query}`, url: "https://example.test/source", description: "Fixture search result", markdown: "# Fixture source" }] },
      }));
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v2/scrape") {
    readJson(request, response, (body) => {
      cors(response, 200, { "Content-Type": "application/json" });
      const long = String(body.url).includes("long") ? `\n\n${"## Ordered section\nfixture paragraph\n\n".repeat(900)}` : "";
      response.end(JSON.stringify({ success: true, data: { markdown: `# Scraped fixture\n\n${body.url}${long}` } }));
    });
    return;
  }

  if (request.method === "POST" && request.url === "/mcp") {
    readJson(request, response, (body) => {
      if (body.method === "server/discover") {
        rpc(response, body.id, { supportedVersions: ["2026-07-28"], serverInfo: { name: "fixture-mcp", version: "1" } });
      } else if (body.method === "tools/list") {
        rpc(response, body.id, { tools: [{
          name: "fixture_echo",
          description: "Echo a string from the browser fixture",
          inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        }] });
      } else if (body.method === "tools/call") {
        rpc(response, body.id, { content: [{ type: "text", text: `fixture echo: ${body.params?.arguments?.value ?? ""}` }] });
      } else {
        cors(response, 400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Fixture method not found" } }));
      }
    });
    return;
  }

  cors(response, 404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { message: "Fixture route not found" } }));
});

staticServer.listen(pagePort, "127.0.0.1", () => {
  apiServer.listen(apiPort, "127.0.0.1", () => {
    console.log(`llm browser fixture: ${pageOrigin}`);
    console.log(`mock OpenAI endpoint: http://127.0.0.1:${apiPort}/v1`);
    console.log(`mock Firecrawl endpoint: http://127.0.0.1:${apiPort}/v2`);
    console.log(`mock MCP endpoint: http://127.0.0.1:${apiPort}/mcp`);
  });
});

function close() {
  apiServer.close(() => staticServer.close(() => process.exit(0)));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
