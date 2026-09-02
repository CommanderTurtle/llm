# llm

`llm` is a static browser agent harness for OpenAI-compatible models running on localhost or a private LAN. It has resumable chats, multimodal attachments, local document conversion and OCR, Firecrawl search/scrape, and browser-reachable MCP tools—without an application server, account, API-key field, telemetry, or cloud database.

The page is intended for `https://llm.shel.sh/` with base `/`, but it also runs from the included development server. Persistent state lives only in that browser profile's IndexedDB. Network traffic goes only to endpoints the user explicitly configures and invokes.

## Start

Run an unauthenticated OpenAI-compatible service such as vLLM, then serve this directory:

```bash
bun run dev
```

Open `http://127.0.0.1:4173/`, leave the default `http://localhost:8000/v1` or enter another private-LAN address, and click **Connect**. The harness requests `GET /v1/models`; a model id can also be typed manually. **Send** calls `POST /v1/chat/completions` with streaming enabled. `Ctrl+Enter` / `Cmd+Enter` sends and **Stop** aborts the active request.

There is no install or build step. Publish the repository contents directly when deploying it as a static site.

## What is included

- Multiple named chats with new, switch, rename, and delete actions.
- Automatic IndexedDB persistence for chats, drafts, settings, attachments, tool turns, and integrations.
- Complete workspace JSON import/export and legacy single-conversation import.
- Active-chat Markdown export and browser print/save-to-PDF.
- Streaming and non-streaming OpenAI completions, including separate reasoning, final text, usage, finish reason, and tool calls.
- Generation controls for temperature, top-p, max tokens, seed, `reasoning_effort`, and `chat_template_kwargs.enable_thinking`.
- Per-turn copy, edit, and delete. The visible edited transcript is the transcript used on later model requests.
- Safe Markdown presentation with tables, lists, links, blockquotes, fenced code, and per-code-block copy.
- Bounded model/tool continuation with approval before every call by default.

Refresh resumes the last workspace. It does not reconnect to a model, Firecrawl, or MCP server and does not issue an unsolicited network request.

## Attachments

Use **+ Files** to attach one or more files to the next user turn.

| Input | Browser-side handling | Model projection |
| --- | --- | --- |
| PNG, JPEG, WebP, GIF, AVIF and other browser image types | Exact bytes retained as a data URL | OpenAI `image_url` plus a filename/id descriptor |
| Text, Markdown, HTML, JSON, and common source/config formats | Read as text | Delimited text attachment |
| PDF, DOC/DOCX, ODT, RTF, EPUB, PPT/PPTX, ODP, XLSX, and ODS | Vendored AnyDoc WASM converts to Markdown | Delimited Markdown attachment |
| ZIP | Vendored JSZip reads the archive and creates deterministic `combined.md` | Delimited Markdown attachment |

ZIP combination sorts normalized paths, preserves a heading for every entry, chooses a fenced-code language from the path, and records binary/oversized entries as omitted instead of inserting their bytes. Paths cannot escape the synthetic archive tree. Limits are 128 MiB per selected file, 20,000 archive entries, 8 MiB per text entry, 512 MiB expanded archive data, and 64 MiB combined text.

The complete workspace export retains original attachment data URLs as well as converted text. This makes state files portable, but it also means an export can be large and contains every attached byte.

## Browser tools

Tools are translated into OpenAI function definitions and exposed only when enabled. Calls and results remain visible in the transcript. The default approval mode asks before every invocation; **Allow enabled tools** is an explicit session-wide opt-in. Tool continuation stops at the configured round limit (1–16, default 8).

### Local OCR

The `ocr_attachment` tool runs vendored Tesseract.js, its WASM core, and English language data entirely in the page. The model addresses an attached image by its exact filename or attachment id. OCR assets load lazily on the first call.

### Firecrawl

Enable Firecrawl and enter a private URL such as `http://localhost:3002`. The harness uses the existing service endpoints:

- `POST /v2/search` for `web_search`, requesting web results and main-content Markdown.
- `POST /v2/scrape` for `web_scrape`, requesting main-content Markdown for one HTTP(S) URL.

The **Test** button performs a one-result search. Firecrawl is separate from MCP and from Firebending; no endpoint is inferred from another integration. See the [Firecrawl search API](https://docs.firecrawl.dev/api-reference/endpoint/search) and [scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape) for the service contract.

### MCP Streamable HTTP

Add a browser-reachable local MCP URL, give it a display name, then click **Add and discover**. Connected tools receive stable OpenAI-safe namespaced names so two servers may expose the same native tool name without colliding.

The client first tries current stateless discovery (`2026-07-28`), including servers that omit the optional `server/discover` method, then initialize/session negotiation for `2025-11-25`, `2025-06-18`, and `2025-03-26`. It supports JSON and server-sent-event responses, pagination in `tools/list`, `tools/call`, required name/parameter header mirroring (including `x-mcp-header` schemas), negotiated session headers, and best-effort session deletion. Imported/restored MCP definitions are inert until **Connect** is clicked. See the [current MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) and the [initialize-era transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## Endpoint policy and browser boundaries

Model, Firecrawl, and MCP fields accept only HTTP(S) destinations that resolve syntactically to one of these local forms:

- `localhost`, `*.localhost`, and `*.local`
- IPv4 loopback, RFC1918 private, or link-local addresses
- IPv6 loopback, unique-local, or link-local addresses
- `host.docker.internal` and `gateway.docker.internal`

Public hostnames, URL credentials, non-HTTP protocols, `0.0.0.0`, and `[::]` are rejected before `fetch`. Model URLs are canonicalized to `/v1`; service paths for Firecrawl and MCP are preserved.

This policy is not a CORS bypass. Each local service must accept the page's `Origin`, respond to preflight requests, and permit the headers it receives. MCP commonly needs `Content-Type`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Session-Id`, and any schema-declared `Mcp-Param-*` headers, with `Mcp-Session-Id` exposed to browser JavaScript. Chromium may additionally send a Private Network Access preflight or display a local-network permission prompt. An HTTPS-hosted page may be unable to call a plain-HTTP LAN host; use an HTTPS local endpoint or serve the page locally when the browser enforces mixed-content restrictions.

MCP tools can be more privileged than this page. Approval controls whether the harness invokes them; the MCP server remains responsible for its own authorization, sandboxing, and effects.

## State and privacy

- IndexedDB contains the workspace only in the current browser profile and origin.
- **Save state** downloads the complete versioned workspace, including attachment bytes.
- **Import state** validates and restores that format without connecting to anything.
- A legacy conversation document or OpenAI-style text-message array imports as a new isolated chat.
- A response interrupted by refresh is recovered as **stopped**, never left permanently **streaming**.
- Images are sent as base64 data URLs to the configured model endpoint. Converted non-image files are sent as text/Markdown. OCR and conversion stay local unless their resulting text is later included in a model request.
- No service worker, analytics beacon, cookies, credential store, or remote asset CDN is used.

## Develop and verify

```bash
bun test
bun run check
bun run test:browser
```

`bun run check` runs the unit suite, bundles the browser module graph in memory, verifies every required DOM id, verifies vendored files, and initializes the real AnyDoc WASM build for an in-memory RTF conversion.

`bun run test:browser` serves the page at `http://127.0.0.1:4273/` and a deterministic fixture at `http://127.0.0.1:4274/` with OpenAI `/v1`, Firecrawl `/v2`, and MCP `/mcp` surfaces. The ports can be changed with `LLM_FIXTURE_PAGE_PORT` and `LLM_FIXTURE_API_PORT`. Stop it with `Ctrl+C`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for data flow and invariants, and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for vendored runtime licenses.

## Source map

- `src/app.js` — UI state, persistence triggers, model/tool loop, imports/exports.
- `src/workspace.js` — versioned multi-session workspace normalization.
- `src/transcript.js` — message contract, OpenAI projection, conversation interchange.
- `src/storage.js` — IndexedDB and serialized debounced writes.
- `src/openai.js` — model discovery, SSE framing, streaming/non-streaming aggregation.
- `src/attachments.js` — file classification and persistent attachment preparation.
- `src/anydoc.js`, `src/archive.js`, `src/ocr.js` — local document, ZIP, and OCR pipelines.
- `src/firecrawl.js`, `src/mcp.js`, `src/tools.js` — browser tool adapters and dispatch.
- `src/local-endpoint.js` — local/private endpoint validation and normalization.
- `src/markdown.js` — DOM-native response rendering and clipboard actions.
