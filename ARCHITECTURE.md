# Architecture

`llm` is a static ES-module application. Its trusted core is the browser page itself: there is no companion application server, proxy, database process, service worker, or remote asset dependency.

## System shape

```text
local files ──> attachment preparation ──> session attachment store
                    │                          │
                    ├─ image: exact data URL ──┤
                    ├─ document: AnyDoc WASM ──┤
                    └─ ZIP: JSZip/combined.md ─┘
                                               │
IndexedDB <── versioned workspace <── UI ──> feature-gated projection
                    │                          │
          exact originals/revisions            v
                    │              private OpenAI /v1 endpoint(s)
                    └─ compaction/resources ────┤
                                               │
                                  assistant function-tool requests
                                               │
                         approval + bounded browser tool dispatcher
                    │           │              │                │
              context/docs   Tesseract   Firecrawl /v2    MCP HTTP server(s)
```

Only the arrows ending at configured endpoints cross the page boundary. AnyDoc, ZIP processing, Markdown rendering, state normalization, and OCR execute in the browser.

## Persistent data model

The root object is `workspace-v2`:

```text
workspace
├── activeSessionId
├── sessions[]
│   ├── id, title, titleLocked
│   ├── endpoint, model, systemPrompt, parameters
│   ├── messages[]
│   ├── attachments[]
│   ├── todos[], documents[], resources[]
│   ├── compactions[], activeCompactionId
│   ├── undo[]
│   ├── pendingAttachmentIds[]
│   └── draft, createdAt, updatedAt
└── integrations
    ├── approval, maxToolRounds
    ├── features{}
    ├── derived localTools{}
    ├── ocr
    ├── firecrawl
    └── mcpServers[]
```

`src/workspace.js` is the only constructor/normalizer for this shape. It rejects unknown workspace schemas, future versions, empty session lists, and more than 1,000 sessions. Every imported session is reconstructed rather than trusted as a live object. Attachment references that do not resolve inside their session are removed. A `workspace-v1` import migrates to v2 with every new feature disabled.

The persisted feature matrix is wholly opt-in. Its default is thirteen `false` values. Derived local-tool flags are rebuilt from it rather than trusted from imported JSON. Write tools imply read tools because their optimistic-concurrency contract requires a current read receipt.

The IndexedDB database `llm-shel-harness`, object store `state`, key `workspace` contains one normalized snapshot. `src/storage.js` serializes debounced writes so an older asynchronous transaction cannot overwrite a later one. The `pagehide` handler flushes the latest queued snapshot. A persisted response with state `streaming` is recovered as `stopped`/`interrupted`.

The downloaded workspace document and IndexedDB snapshot use the same schema. A single `conversation-v2`, legacy `conversation-v1`, or plain OpenAI-style text-message array imports as a newly isolated session rather than replacing the workspace.

## Message invariants

`src/transcript.js` owns message construction and projection.

- Roles are limited to `system`, `developer`, `user`, `assistant`, and `tool`.
- Message ids are stable across persistence and export.
- Tool calls use OpenAI's function-call shape and tool results carry the matching `tool_call_id`.
- Deleting one side of a tool exchange repairs the other side before a later request.
- Edits update the stored message itself. There is no hidden immutable transcript sent to the model.
- Empty transport-error placeholders are not projected into a later request.
- An assistant tool-call message is immediately followed by the corresponding visible tool results before continuation.

Images linked to a user message produce an OpenAI multipart content array containing a text descriptor and one `image_url` data URL per image. Non-image attachments are appended to text as named, MIME-typed delimiters. This keeps document projection broadly compatible with text-only OpenAI-compatible servers while preserving direct vision input for multimodal servers.

## Model transport

`src/local-endpoint.js` validates a destination before any request. `src/openai.js` then performs:

1. `GET /v1/models` for discovery.
2. `POST /v1/chat/completions` for generation.
3. SSE parsing when the server streams, or ordinary JSON parsing when it does not.

The SSE parser holds incomplete UTF-8/text-event fragments across chunks, accepts multi-line `data:` records, and recognizes `[DONE]`. The completion accumulator independently joins content, reasoning fields, and fragmented tool-call arguments by tool index.

By default, the request contract is unchanged: one foreground AbortController blocks session switching, creation, deletion, and import until it finishes or is stopped. With Parallel chats enabled, a request map gives each generating session its own AbortController and updates that session object directly even while another chat is visible. A generating session cannot be deleted, and Parallel chats cannot be disabled while a background request exists. Import remains blocked until every request stops.

There is no generation timeout. Interrupted-response recovery only inspects terminal evidence already supplied by the endpoint: `[DONE]`, a finish reason, empty output, and `finish_reason: length`. When enabled, suspicious completion is stored as `interrupted`, partial text is retained, and **Continue** adds a transient continuation instruction without adding that instruction to persistent history. Assistant reasoning is replayed only where it is needed for an opted-in tool-call continuation. With recovery disabled, completion classification matches the baseline behavior.

`max_tokens` remains 8192 by default. Server-decided output allowance represents Auto as `null` and omits the field from the JSON request; disabling the feature restores 8192.

## Tool loop

For each assistant pass, `src/tools.js` constructs the currently enabled OpenAI functions. Tool definitions are not cached into model history. If the model returns tool calls:

1. Enforce the configured round bound.
2. Ask for approval unless automatic mode was explicitly selected.
3. Dispatch each call to OCR, Firecrawl, or its namespaced MCP connection.
4. Append the request and each result/error to the visible transcript.
5. Project that transcript into a new model completion.

Denied and failed calls still receive a matching tool-result message containing the error. This preserves the OpenAI tool-message ordering contract and lets the model respond to the failure. Reaching the bound creates matching unexecuted-call errors and stops instead of silently dropping requested calls.

Tool calls execute serially. This produces deterministic transcript order and avoids racing user approval dialogs or multiple side-effecting MCP operations.

### Browser-local context and documents

Feature-gated local tools add no network service. `context_read` exposes a timeline, an exact original message, separately stored reasoning, a compaction record, or one numbered resource section. Long Firecrawl output is normalized once, preserved exactly after that normalization, and divided at readable boundaries; concatenating its sections reproduces the stored resource byte-for-byte. Derived section metadata contains at most two `code`, `table`, or `html_gibberish` tags and source-bound image URLs. Reading one section records a capability receipt that exposes `resource_search` only for that resource; the in-memory inverted word index returns section anchors and excerpts without rewriting the stored content.

`view_image` accepts only an exact URL already indexed inside the specified resource section. The approval dialog resolves that tuple before showing its source page, subsection metadata, and excerpt. An accepted result gets an ephemeral load receipt so the image appears immediately; persisted history requires a fresh click after reload and therefore does not make an unsolicited image request.

`read_document` and `instructions_read` return revision metadata, stable FNV-derived line hashes, and diagnostics. A successful read records an in-memory receipt for that session and revision. `put_document` and `instructions_put` reject writes to an existing document without that receipt, reject stale expected revisions, and reject ambiguous or overlapping hash ranges. Every accepted change appends an immutable content snapshot. The UI can compare adjacent revisions as context, removed, and added lines.

The lightweight browser linter validates JSON, balances common code delimiters while respecting strings/comments, and checks Markdown fences plus supported fenced languages. It is deliberately a local diagnostic layer, not a replacement for a language compiler or LSP.

TODO entries are session-local structured records with stable ids, checked state, and timestamps. The visible checklist and model tool operate on the same records.

### Lossless context controls

Compaction changes only API projection:

- **Soft** identifies Firecrawl search/scrape turns, stores clean output as ordered browser resources, and projects an index with exact ids.
- **Normal** lets the user select completed entries, expands tool-call/result groups, and runs a separate stateless model call with an editable summarizer prompt.

The resulting envelope includes the summary plus the ids/order of every collapsed original. Originals, reasoning, attachments, and resources remain in the session. Restore removes the envelope from projection immediately; Reapply selects the latest saved compaction. The context meter uses projected estimates while compaction is active rather than an old server usage count.

## OCR

`src/ocr.js` lazily loads the vendored Tesseract browser bundle, worker, best available SIMD/LSTM core, and `eng.traineddata.gz`. One worker is reused for later calls and can be terminated explicitly. The tool accepts only an image attachment that already belongs to the session; it cannot read arbitrary filesystem paths.

## Document and archive conversion

`src/anydoc.js` initializes the vendored AnyDoc WASM module once. Format detection uses the filename first and file bytes second; `toMarkdownBytes` performs the conversion.

`src/archive.js` treats ZIPs as synthetic source trees:

- Normalize separators, drive prefixes, control characters, `.` and `..` components.
- Sort paths before reading and rendering.
- Omit known binary extensions and content that looks binary.
- Decode UTF-8 and BOM-marked UTF-16 text.
- Fence each included file with a delimiter longer than any backtick run inside it.
- Emit an explicit `(omitted — reason, size)` body for every omitted file.
- Enforce entry, file, expanded-byte, and combined-text bounds.

The result is deterministic for the same logical archive regardless of ZIP member order.

## Firecrawl

`src/firecrawl.js` preserves a configured service path, adds `/v2` once, and calls only `/search` or `/scrape`. Search requests web sources plus main-content Markdown; scrape requests main-content Markdown. Error responses retain a bounded diagnostic body for the UI without writing it into another service.

This is a direct browser integration. It does not use the Firecrawl CLI and does not modify the Firecrawl service. Any multilingual behavior installed into that service's `/v2` endpoints remains a server-side concern and can be reached through the same adapter when its API contract exposes it.

## MCP HTTP

`src/mcp.js` supports two transports over direct browser `fetch`:

- Current stateless MCP: `server/discover`, current metadata, then `tools/list`/`tools/call`.
- Initialize/session era: negotiate `initialize`, send `notifications/initialized`, retain `Mcp-Session-Id`, and use the negotiated protocol header.

Responses may be JSON or SSE. Current discovery is optional, so a failed `server/discover` is followed by a current-version `tools/list` probe before initialize-era fallback. Tool listing rejects repeated cursors, applies page/tool bounds, and excludes invalid `x-mcp-header` schemas. `tools/call` mirrors valid schema-designated primitive arguments into encoded `Mcp-Param-*` headers, and non-ASCII `Mcp-Name` values use the specification's Base64 sentinel form. MCP-native names are mapped to stable OpenAI-safe names using a sanitized server/tool prefix plus an FNV-1a-derived suffix. Dispatch reverses that mapping against the live connection; a model cannot invent a callable endpoint merely by guessing a name.

Connection objects and session ids are runtime-only. Persisted MCP records contain configuration and discovered schemas for display, but restore/import does not reconnect. A manual **Connect** creates a fresh transport instance.

## Rendering boundary

The baseline path in `src/markdown.js` creates DOM nodes directly and assigns model text through `textContent`. It supports the original bounded Markdown subset and permits only HTTP(S), `mailto:`, and validated local section-fragment links; HTTP(S) links open with `noopener noreferrer`. Resource-search fragments open their target disclosure and jump without smooth-scroll behavior. Code copy uses the Clipboard API with a textarea fallback.

Rich Markdown is a separate opt-in path. Highlight.js, Mermaid, and Temml are vendored and imported lazily. Highlight and math output is generated by those local renderers; Mermaid diagrams are produced in an isolated render host after a message stops streaming. Task lists and diagnostics remain ordinary DOM. Disabling Rich Markdown returns immediately to the baseline parser.

The whole-chat share action lazily imports the vendored ln.kr/ha.nr codec. Small Markdown uses its V1 text encoder and larger Markdown uses its deflate-backed V4 encoder, then opens the canonical `https://a.shel.sh/#m:` URL. No remote compression request is made.

Streaming output coalesces browser paints and replaces only the active assistant article, rather than reconstructing every visible turn per token. Expensive rich highlighting waits until the message is terminal, and context-meter recalculation is bounded to twice per second during a stream. Stable streaming scroll snapshots the outer chat position, open disclosure state, and inner reasoning/code scroll positions before that replacement. It follows output only while the reader is near the bottom. With the box clear, the original forced-follow behavior remains.

Vision resize recovery catches only recognizable image-dimension `ValueError`s before substantive output exists. All referenced image projections are proportionally reduced by exactly 128 pixels on the longest side using canvas, then the same request is retried. Each retry derives from the previous projection. Stored attachment bytes and exports are never modified.

User messages are rendered as pre-wrapped text. Tool outputs and assistant messages use the same Markdown renderer. Reasoning and tool payloads live in native `<details>` elements.

## Static-host constraints

The model and tool servers—not the page—must supply compatible CORS and Private Network Access responses. An HTTPS deployment calling plain HTTP on another LAN host may be blocked as mixed content. The harness cannot and should not bypass those browser controls.

The site must serve `.wasm` as `application/wasm`, `.js` as JavaScript, and `.gz` as a retrievable binary. The included development and fixture servers provide those MIME mappings.

## Module ownership

| Module | Owns | Does not own |
| --- | --- | --- |
| `app.js` | DOM coordination and request lifecycle | Transport parsing or file conversion |
| `workspace.js` | Multi-session state normalization | IndexedDB I/O |
| `storage.js` | IndexedDB transactions and write ordering | Schema interpretation |
| `transcript.js` | Message schemas and API/export projections | Network calls |
| `openai.js` | `/v1` transport and completion aggregation | UI state |
| `context.js` | Token estimates, resources, compaction envelopes, timelines | Persistent storage or model calls |
| `documents.js` | Hashlines, revisions, diffs, lightweight diagnostics | UI or filesystem writes |
| `image-retry.js` | Browser image projection resizing | Stored attachment mutation |
| `share.js`, `lnkr/` | Lazy a.shel.sh-compatible Markdown encoding | URL navigation policy |
| `attachments.js` | Classification and one attachment record | Archive/document internals |
| `archive.js` | Safe deterministic ZIP-to-Markdown | Generic file selection |
| `anydoc.js` | AnyDoc WASM lifecycle | Attachment persistence |
| `ocr.js` | Tesseract lifecycle | Model tool orchestration |
| `firecrawl.js` | `/v2` request/response contract | Research strategy |
| `mcp.js` | MCP transport and name mapping | Tool approval |
| `tools.js` | OpenAI definitions and dispatch | Model transport |
| `markdown.js` | Baseline and opt-in rich presentation | Transcript storage |

## Verification layers

- Unit tests cover endpoint policy, workspace/conversation interchange and migration, feature-default invariants, multimodal projection, terminal evidence, image-retry dimensions, exact context segmentation, compaction projection, hashline write conflicts, revisions/diffs, a.shel.sh round trips, streaming tool calls, archive rendering, attachment preparation, Firecrawl contracts, and both MCP transport modes.
- `scripts/check.mjs` builds the browser graph in memory, checks the HTML/JavaScript DOM contract and all-disabled controls, verifies vendored assets, and runs a real AnyDoc WASM conversion.
- `scripts/browser-fixture.mjs` exposes deterministic OpenAI, Firecrawl, and MCP surfaces for an actual-browser smoke test without contacting public services.
