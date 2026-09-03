import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFirecrawlUrl, scrapeFirecrawl, searchFirecrawl } from "../src/firecrawl.js";

test("Firecrawl roots normalize once to /v2", () => {
  assert.equal(normalizeFirecrawlUrl("localhost:3002"), "http://localhost:3002/v2");
  assert.equal(normalizeFirecrawlUrl("http://192.168.1.5:3002/v2/"), "http://192.168.1.5:3002/v2");
});

test("Firecrawl search sends the v2 contract and formats cited Markdown", async () => {
  let called;
  const fetchImpl = async (url, init) => {
    called = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      success: true,
      data: { web: [{ title: "Local result", url: "https://example.test/source", description: "Summary", markdown: "# Body" }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await searchFirecrawl("http://localhost:3002", { query: "local inference", limit: 3 }, { fetchImpl });
  assert.equal(called.url, "http://localhost:3002/v2/search");
  assert.equal(called.init.targetAddressSpace, "loopback");
  assert.equal(called.init.credentials, "omit");
  assert.deepEqual(called.body.sources, ["web"]);
  assert.deepEqual(called.body.scrapeOptions.formats, [{ type: "markdown" }]);
  assert.match(result, /Local result[\s\S]*https:\/\/example\.test\/source[\s\S]*# Body/);
});

test("Firecrawl scrape requests clean Markdown", async () => {
  let body;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ success: true, data: { markdown: "# Scraped" } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  assert.equal(await scrapeFirecrawl("localhost:3002", { url: "https://example.test" }, { fetchImpl }), "# Scraped");
  assert.deepEqual(body.formats, [{ type: "markdown" }]);
  assert.equal(body.onlyMainContent, true);
});
