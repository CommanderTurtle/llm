# llm

`llm` is a static browser agent harness for OpenAI-compatible models running on localhost or a private LAN. It has resumable chats, multimodal attachments, local document conversion and OCR, Firecrawl search/scrape, and browser-reachable MCP tools—without an application server, account, API-key field, telemetry, or cloud database.

The page is intended for `https://llm.shel.sh/` with base `/`, but it also runs from the included development server. Persistent state lives only in that browser profile's IndexedDB. Network traffic goes only to endpoints the user explicitly configures and invokes.

## Start

Run an unauthenticated OpenAI-compatible service such as vLLM, then serve this directory:

```bash
bun run dev
```

Open `http://127.0.0.1:4173/`, leave the default `http://localhost:8000/v1` or enter another private-LAN address, and click **Connect**. The harness shows the exact `GET /v1/models` target while connecting and stops that discovery attempt after 12 seconds rather than hanging indefinitely; a model id can also be typed manually. **Send** calls `POST /v1/chat/completions` with streaming enabled. `Ctrl+Enter` / `Cmd+Enter` sends and **Stop** aborts the active request.

There is no install or build step. Publish the repository contents directly when deploying it as a static site.

## Baseline behavior

- Multiple named, resumable chats with new, switch, rename, and delete actions.
- Automatic IndexedDB persistence for chats, drafts, settings, attachments, tool turns, and integrations.
- Complete workspace JSON import/export and legacy single-conversation import.
- Active-chat Markdown export and browser print/save-to-PDF.
- Streaming and non-streaming OpenAI completions, including separate reasoning, final text, usage, finish reason, and tool calls.
- Generation controls for temperature, top-p, max tokens, seed, `reasoning_effort`, and `chat_template_kwargs.enable_thinking`.
- Per-turn copy, edit, and delete. The visible edited transcript is the transcript used on later model requests.
- Safe Markdown presentation with tables, lists, links, blockquotes, fenced code, and per-code-block copy.
- Bounded model/tool continuation with approval before every call by default.

Refresh resumes the last workspace. It does not reconnect to a model, Firecrawl, or MCP server and does not issue an unsolicited network request.

## Opt-in feature matrix

Every enhancement below starts disabled and is saved in browser state. **Clear all** restores the request and interaction contract of the last baseline release: the 8192-token output allowance, one foreground generation, the original Markdown renderer and scrolling, the original deletion behavior, and only the previously enabled OCR/Firecrawl/MCP tools. Nothing silently enables a dependent tool; the sole dependency is that write tools also enable their required read tools. Drag across feature rows to paint checkboxes, or Shift-click one checkbox to apply that choice to its small functional group.

| Checkbox | Effect |
| --- | --- |
| Interrupted-response recovery | Distinguishes a real terminal signal from clean premature EOF, empty output, or `finish_reason: length`; preserves partial output and offers **Continue**. It adds no timeout. |
| Server-decided output allowance | Omits `max_tokens` so the endpoint chooses its allowance. Turning it off restores 8192. |
| Rich Markdown | Lazily enables syntax highlighting, Mermaid, Temml math (`$`, `$$`, and math fences), task lists, code copy, and lightweight code diagnostics. |
| Parallel chats | Lets independent sessions continue generating while the user switches or starts another chat. Each session owns its own request and Stop action. Its status marker is static, and streaming mutates only stable text nodes inside the active assistant card—there is no per-token session-list repaint, Markdown pass, or card replacement. |
| Complete Markdown export | Makes download, Copy, and the lazy local a.shel.sh link use one complete Markdown document: every native turn, reasoning block, tool request/result, attachment reference, and compaction record is retained regardless of API projection. |
| Vision resize recovery | On an image-dimension `ValueError`, retries the request with browser-only projections reduced by exactly 128 pixels on the longest side until accepted. Stored originals never change. |
| Stable streaming scroll | Follows output only while near the bottom. The growing reasoning node is retained in place, so its disclosure state, selection, and independent scroll position are not destroyed by a new delta. |
| Context meter | Shows a per-session token estimate against the model-advertised or manually entered context window. |
| Composable context controls | Enables separate Soft actions for Firecrawl indexing and completed context-read collapse, plus user-selected Normal summarization. Each new group composes with earlier active groups instead of reopening them; exact originals stay stored and can be restored independently or together. Indexed sections carry at most two comma-delimited `code`, `table`, or `html_gibberish` tags. |
| Scraped image reads | Exposes source-bound `view_image` only for image URLs discovered in earlier stored Firecrawl results. The approval view shows the source and subsection. |
| Browser read tools | Lets the model read exact transcript/reasoning entries, resources, instructions, and editor documents. Reading a resource section unlocks indexed search for only that resource. |
| Document write tools | Adds read-before-write, revisioned document and `instructions.md` PUT operations. A full document can be written as normal assistant Markdown ending with `DONE` on its own line, then stored with `from_response=true`; small changes retain the precise hashline path. |
| TODO tool | Adds a visible per-chat checklist that the model and user can update, plus **Clear all but recent**, which keeps the most recently updated item after confirmation. |
| Undo deleted turns | Keeps the last 20 deleted turn groups in a browser-local undo stack. |
| Advanced turn controls | Adds reasoning copy/edit and individual tool-request copy/edit/delete without removing the containing assistant turn. |
| Timeline + search | Adds a color-coded jump timeline and transcript search. Unquoted terms use forgiving fuzzy matching; a whole query in matching quotes is an exact phrase. |

**Enable all** and **Clear all** apply the entire matrix. Parallel chats cannot be disabled while another session is still generating; stop that background request first so its Stop control never becomes unreachable.

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

### Browser workspace

The opt-in browser workspace stores documents, `instructions.md`, TODOs, revisions, diffs, and lint diagnostics inside the current chat. For a full document, the model writes ordinary Markdown or code in its response, ends with a standalone `DONE`, and calls the applicable PUT with `from_response=true`; the page stores the exact response before that marker, so the content is never duplicated or JSON-escaped inside tool arguments. Existing documents must still be read at their current revision first. Small changes use stable per-line hashes; stale, ambiguous, overlapping, or unread edits fail explicitly. Each accepted write creates an immutable browser-local revision that can be compared as red/green lines.

The context-read tool can reopen the exact content or reasoning of a stored turn. Completed context-read results render as closed disclosures, and **Soft · collapse context reads** removes their matching request/result pairs only from the outbound projection while retaining their exact message ids for later reads. Long Firecrawl results are split losslessly into ordered Markdown sections only when Composable context controls is enabled; the model initially receives an index plus section one and may open later sections individually. Each section is classified with at most two comma-delimited `code`, `table`, or `html_gibberish` tags. Once `context_read` opens a resource section, `resource_search` becomes available for that resource and uses an in-memory word index to return matching section links and short excerpts.

### Local OCR

The `ocr_attachment` tool runs vendored Tesseract.js, its WASM core, and English language data entirely in the page. The model addresses an attached image by its exact filename or attachment id. OCR assets load lazily on the first call.

### Firecrawl

Enable Firecrawl and enter a private URL such as `http://localhost:3002`. The harness uses the existing service endpoints:

- `POST /v2/search` for `web_search`, requesting web results and main-content Markdown.
- `POST /v2/scrape` for `web_scrape`, requesting main-content Markdown for one HTTP(S) URL.

With **Scraped image reads** enabled, image URLs actually present in a stored Firecrawl section expose `view_image` on later model rounds. Enabling it after a scrape also indexes eligible image references from already-stored Firecrawl tool results. The call is limited to an exact indexed URL; its approval panel shows the page source, section heading/tags, and an excerpt before the browser renders anything. Approved images load in the chat without a referrer. A restored workspace shows a **Load viewed image** button instead of making an unsolicited network request.

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

This policy is not a CORS bypass. Each local service must accept the page's `Origin`, respond to preflight requests, and permit the headers it receives. MCP commonly needs `Content-Type`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Session-Id`, and any schema-declared `Mcp-Param-*` headers, with `Mcp-Session-Id` exposed to browser JavaScript. Every model, Firecrawl, and MCP fetch explicitly declares its Local Network Access target as `loopback` or `local`. The top-level Connect click immediately fetches `/v1/models`, which is the permission trigger; no separate JavaScript permission-request API exists. Permission diagnostics query the current `loopback-network` or `local-network` permission and fall back to Chromium's older combined `local-network-access` alias. A dev page already served from loopback normally does not cross into a more-private address space, so the absence of a prompt there is expected.

Chromium 142 and newer can grant this permission and then relax mixed-content blocking for a declared HTTP local destination. Browsers without `Request.targetAddressSpace` support can still classify literal private addresses themselves, but may retain ordinary mixed-content restrictions. If a hosted connection reports `ERR_BLOCKED_BY_CLIENT`, the browser stopped it before the endpoint could answer. Set **Local network access** to **Allow** in the site permissions for the hosted origin, reload, and check any content-blocking extension. A public proxy cannot reach the browser machine's `localhost`; the transport alternatives are a trusted HTTPS listener/reverse proxy on that machine or the locally served harness.

MCP tools can be more privileged than this page. Approval controls whether the harness invokes them; the MCP server remains responsible for its own authorization, sandboxing, and effects.

## State and privacy

- IndexedDB contains the workspace only in the current browser profile and origin.
- **Save state** downloads the complete versioned workspace, including attachment bytes.
- **Import state** validates and restores that format without connecting to anything.
- A legacy conversation document or OpenAI-style text-message array imports as a new isolated chat.
- A response interrupted by refresh is recovered as **stopped**, never left permanently **streaming**.
- Images are sent as base64 data URLs to the configured model endpoint. Converted non-image files are sent as text/Markdown. OCR and conversion stay local unless their resulting text is later included in a model request.
- No service worker, analytics beacon, cookies, credential store, or remote asset CDN is used.
- Compaction never deletes or overwrites a turn. Normal compaction adds a stateless model-generated summary projection; Soft compaction indexes Firecrawl output or collapses completed context-read request/result pairs. Active groups compose, carry deterministic searchable values, and share a color across their originals and summary card. The native entries, reasoning, resources, and revision history remain in the workspace and complete Markdown export.
- Vision retries alter only the outbound in-memory image projection. The exact attached data URL remains in IndexedDB and state exports.
- Rich renderer and a.shel.sh compression modules are vendored and loaded only after their feature is used.

## Develop and verify

```bash
bun test
bun run check
bun run test:browser
```

`bun run check` runs the unit suite, bundles the browser module graph in memory, verifies every required DOM id and the all-disabled baseline controls, verifies vendored files, and initializes the real AnyDoc WASM build for an in-memory RTF conversion.

`bun run test:browser` serves the page at `http://127.0.0.1:4273/` and a deterministic fixture at `http://127.0.0.1:4274/` with OpenAI `/v1`, Firecrawl `/v2`, and MCP `/mcp` surfaces. The ports can be changed with `LLM_FIXTURE_PAGE_PORT` and `LLM_FIXTURE_API_PORT`. Stop it with `Ctrl+C`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for data flow and invariants, and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for vendored runtime licenses.

## Source map

- `src/app.js` — UI state, persistence triggers, model/tool loop, imports/exports.
- `src/workspace.js` — versioned multi-session workspace normalization.
- `src/transcript.js` — message contract, OpenAI projection, conversation interchange.
- `src/context.js` — token estimates, exact resource sections, compaction envelopes, and timelines.
- `src/documents.js` — hashline documents, read-before-write revisions, diffs, and diagnostics.
- `src/image-retry.js` — browser-only 128-pixel image projection retries.
- `src/share.js`, `src/lnkr/` — lazy a.shel.sh Markdown-link encoding.
- `src/storage.js` — IndexedDB and serialized debounced writes.
- `src/openai.js` — model discovery, SSE framing, streaming/non-streaming aggregation.
- `src/attachments.js` — file classification and persistent attachment preparation.
- `src/anydoc.js`, `src/archive.js`, `src/ocr.js` — local document, ZIP, and OCR pipelines.
- `src/firecrawl.js`, `src/mcp.js`, `src/tools.js` — browser tool adapters and dispatch.
- `src/local-endpoint.js` — local/private endpoint validation and normalization.
- `src/markdown.js` — baseline DOM-native Markdown plus opt-in lazy rich rendering.
