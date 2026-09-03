import assert from "node:assert/strict";
import test from "node:test";

import {
  endpointResource,
  isLocalHostname,
  localFetchOptions,
  LocalEndpointError,
  normalizeLocalEndpoint,
  normalizeLocalServiceUrl,
  serviceResource,
  targetAddressSpaceForEndpoint,
} from "../src/local-endpoint.js";

test("normalizes local endpoints to /v1", () => {
  assert.equal(normalizeLocalEndpoint("localhost:8000"), "http://localhost:8000/v1");
  assert.equal(normalizeLocalEndpoint("http://127.0.0.1:9000/anything?x=1#y"), "http://127.0.0.1:9000/v1");
  assert.equal(normalizeLocalEndpoint("https://192.168.10.203:443/v1/"), "https://192.168.10.203/v1");
  assert.equal(endpointResource("http://10.2.3.4:8000", "/models"), "http://10.2.3.4:8000/v1/models");
});

test("preserves local service paths for Firecrawl and MCP", () => {
  assert.equal(normalizeLocalServiceUrl("localhost:3002", { defaultPath: "/v2" }), "http://localhost:3002/v2");
  assert.equal(normalizeLocalServiceUrl("http://192.168.1.20:3001/mcp?token=nope#x"), "http://192.168.1.20:3001/mcp");
  assert.equal(serviceResource("http://127.0.0.1:3002/v2", "/search"), "http://127.0.0.1:3002/v2/search");
});

test("recognizes loopback and private address families", () => {
  for (const host of [
    "localhost",
    "model.localhost",
    "workstation.local",
    "host.docker.internal",
    "10.1.2.3",
    "127.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.50",
    "169.254.10.2",
    "::1",
    "fd12::1",
    "fe80::1",
  ]) {
    assert.equal(isLocalHostname(host), true, host);
  }
});

test("labels loopback and private-LAN requests for browser Local Network Access", () => {
  for (const endpoint of ["localhost:8000", "http://model.localhost:9000/v1", "http://127.7.8.9:8000", "http://[::1]:8000"]) {
    assert.equal(targetAddressSpaceForEndpoint(endpoint), "loopback", endpoint);
  }
  for (const endpoint of ["http://192.168.1.50:8000", "http://10.2.3.4:8000", "http://workstation.local:8000", "http://host.docker.internal:8000"]) {
    assert.equal(targetAddressSpaceForEndpoint(endpoint), "local", endpoint);
  }

  const signal = new AbortController().signal;
  assert.deepEqual(localFetchOptions("http://localhost:8000/v1/models", { method: "GET", signal }), {
    method: "GET",
    signal,
    mode: "cors",
    credentials: "omit",
    targetAddressSpace: "loopback",
  });
});

test("rejects public, credential-bearing, and wildcard endpoints", () => {
  for (const endpoint of [
    "https://example.com/v1",
    "https://8.8.8.8/v1",
    "http://user:pass@localhost:8000/v1",
    "file:///tmp/model",
    "http://0.0.0.0:8000",
  ]) {
    assert.throws(() => normalizeLocalEndpoint(endpoint), LocalEndpointError, endpoint);
  }
});
