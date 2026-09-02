import assert from "node:assert/strict";
import test from "node:test";

import {
  McpHttpClient,
  MODERN_MCP_VERSION,
  mcpFunctionName,
  mcpResultText,
  mcpToolsForOpenAi,
} from "../src/mcp.js";

function jsonRpcResponse(id, result, headers = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("current stateless MCP discovers and calls browser-reachable tools", async () => {
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    seen.push({ request, headers: new Headers(init.headers) });
    if (request.method === "server/discover") {
      return jsonRpcResponse(request.id, { supportedVersions: [MODERN_MCP_VERSION], serverInfo: { name: "fixture" } });
    }
    if (request.method === "tools/list") {
      return jsonRpcResponse(request.id, { tools: [{
        name: "lookup",
        description: "Read a record",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "integer" },
            region: { type: "string", "x-mcp-header": "Region" },
          },
        },
      }] });
    }
    if (request.method === "tools/call") {
      return jsonRpcResponse(request.id, { content: [{ type: "text", text: `record:${request.params.arguments.id}` }] });
    }
    throw new Error(`unexpected ${request.method}`);
  };
  const client = new McpHttpClient("http://localhost:3001/mcp", { fetchImpl });
  const tools = await client.connect();
  const result = await client.callTool("lookup", { id: 7, region: "us-west1" });
  assert.equal(client.mode, "modern");
  assert.equal(tools[0].name, "lookup");
  assert.equal(mcpResultText(result), "record:7");
  assert.equal(seen[0].headers.get("mcp-protocol-version"), MODERN_MCP_VERSION);
  assert.equal(seen[2].headers.get("mcp-name"), "lookup");
  assert.equal(seen[2].headers.get("mcp-param-region"), "us-west1");
  assert.equal(seen[2].request.params._meta["io.modelcontextprotocol/protocolVersion"], MODERN_MCP_VERSION);
});

test("current MCP works without optional discovery and encodes non-ASCII name headers", async () => {
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    seen.push({ request, headers });
    if (request.method === "server/discover") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    if (request.method === "tools/list") {
      return jsonRpcResponse(request.id, { tools: [{ name: "世界", inputSchema: { type: "object", properties: {} } }] });
    }
    if (request.method === "tools/call") return jsonRpcResponse(request.id, { content: [{ type: "text", text: "ok" }] });
    throw new Error(`unexpected ${request.method}`);
  };
  const client = new McpHttpClient("http://localhost:3001/mcp", { fetchImpl });
  const tools = await client.connect();
  assert.equal(client.mode, "modern");
  assert.equal(tools[0].name, "世界");
  await client.callTool("世界", {});
  assert.match(seen.at(-1).headers.get("mcp-name"), /^=\?base64\?.+\?=$/);
});

test("initialize/session-era MCP fallback sends the negotiated session", async () => {
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const request = init.body ? JSON.parse(init.body) : null;
    seen.push({ method: init.method, request, headers: new Headers(init.headers) });
    if (request?.method === "server/discover") return new Response("not implemented", { status: 404 });
    if (request?.method === "tools/list" && new Headers(init.headers).get("mcp-protocol-version") === MODERN_MCP_VERSION) {
      return new Response("unsupported", { status: 400 });
    }
    if (request?.method === "initialize") {
      return jsonRpcResponse(request.id, {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "legacy", version: "1" },
        capabilities: { tools: {} },
      }, { "Mcp-Session-Id": "session-42" });
    }
    if (request?.method === "notifications/initialized") return new Response("", { status: 200 });
    if (request?.method === "tools/list") return jsonRpcResponse(request.id, { tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`unexpected ${request?.method ?? init.method}`);
  };
  const client = new McpHttpClient("localhost:3001/mcp", { fetchImpl });
  const tools = await client.connect();
  assert.equal(client.mode, "legacy");
  assert.equal(client.sessionId, "session-42");
  assert.equal(tools[0].name, "echo");
  const listCall = seen.find((item) => item.request?.method === "tools/list" && item.headers.get("mcp-session-id"));
  assert.equal(listCall.headers.get("mcp-session-id"), "session-42");
  await client.close();
  assert.equal(seen.at(-1).method, "DELETE");
});

test("MCP tool names are stable, namespaced, and OpenAI compatible", () => {
  const first = mcpFunctionName("server one", "Read/Record");
  const second = mcpFunctionName("server two", "Read/Record");
  assert.notEqual(first, second);
  assert.match(first, /^[a-z0-9_-]{1,64}$/);
  const tools = mcpToolsForOpenAi({ id: "server one", name: "Records" }, [{
    name: "Read/Record", description: "Read it", inputSchema: { type: "object", properties: { id: { type: "integer" } } },
  }]);
  assert.equal(tools[0].function.name, first);
  assert.equal(tools[0].function.parameters.properties.id.type, "integer");
});
