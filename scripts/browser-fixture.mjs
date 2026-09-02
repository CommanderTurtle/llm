import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pageOrigin = "http://127.0.0.1:4173";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
}

const apiServer = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    cors(response, 204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/v1/models") {
    cors(response, 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: "fixture-reasoner" }, { id: "fixture-chat" }] }));
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    const buffers = [];
    request.on("data", (chunk) => buffers.push(chunk));
    request.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      } catch {
        cors(response, 400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid fixture request JSON" } }));
        return;
      }

      if (!body?.model || !Array.isArray(body?.messages)) {
        cors(response, 400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Fixture requires model and messages" } }));
        return;
      }

      cors(response, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const chunks = [
        { id: "fixture-1", model: body.model, choices: [{ delta: { reasoning_content: "Check the request. " } }] },
        { id: "fixture-1", model: body.model, choices: [{ delta: { content: "## Fixture response\n\n" } }] },
        { id: "fixture-1", model: body.model, choices: [{ delta: { content: "```js\nconsole.log('local');\n```" } }] },
        {
          id: "fixture-1",
          model: body.model,
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 },
        },
      ];

      let index = 0;
      const write = () => {
        if (index >= chunks.length) {
          response.end("data: [DONE]\n\n");
          return;
        }
        response.write(`data: ${JSON.stringify(chunks[index])}\n\n`);
        index += 1;
        setTimeout(write, 25);
      };
      write();
    });
    return;
  }

  cors(response, 404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { message: "Fixture route not found" } }));
});

staticServer.listen(4173, "127.0.0.1", () => {
  apiServer.listen(4174, "127.0.0.1", () => {
    console.log(`llm browser fixture: ${pageOrigin}`);
    console.log("mock OpenAI endpoint: http://127.0.0.1:4174/v1");
  });
});

function close() {
  apiServer.close(() => staticServer.close(() => process.exit(0)));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
