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
IndexedDB <── versioned workspace <── UI ──> API message projection
                                               │
                                               v
                                   private OpenAI /v1 endpoint
                                               │
                                  assistant function-tool requests
                                               │
                         approval + bounded browser tool dispatcher
                            │                 │                │
                      Tesseract OCR    Firecrawl /v2    MCP HTTP server(s)
```

Only the arrows ending at configured endpoints cross the page boundary. AnyDoc, ZIP processing, Markdown rendering, state normalization, and OCR execute in the browser.

## Persistent data model

The root object is `workspace-v1`:

```text
workspace
├── activeSessionId
├── sessions[]
│   ├── id, title, titleLocked
│   ├── endpoint, model, systemPrompt, parameters
│   ├── messages[]
│   ├── attachments[]
│   ├── pendingAttachmentIds[]
│   └── draft, createdAt, updatedAt
└── integrations
    ├── approval, maxToolRounds
    ├── ocr
    ├── firecrawl
    └── mcpServers[]
```

`src/workspace.js` is the only constructor/normalizer for this shape. It rejects unknown workspace schemas, future versions, empty session lists, and more than 1,000 sessions. Every imported session is reconstructed rather than trusted as a live object. Attachment references that do not resolve inside their session are removed.

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

The AbortController belongs to exactly one active session request. Session switching, new-session creation, deletion, and state import are blocked until that request finishes or is stopped, so an asynchronous response cannot mutate a different active chat.

## Tool loop

For each assistant pass, `src/tools.js` constructs the currently enabled OpenAI functions. Tool definitions are not cached into model history. If the model returns tool calls:

1. Enforce the configured round bound.
2. Ask for approval unless automatic mode was explicitly selected.
3. Dispatch each call to OCR, Firecrawl, or its namespaced MCP connection.
4. Append the request and each result/error to the visible transcript.
5. Project that transcript into a new model completion.

Denied and failed calls still receive a matching tool-result message containing the error. This preserves the OpenAI tool-message ordering contract and lets the model respond to the failure. Reaching the bound creates matching unexecuted-call errors and stops instead of silently dropping requested calls.

Tool calls execute serially. This produces deterministic transcript order and avoids racing user approval dialogs or multiple side-effecting MCP operations.

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

`src/markdown.js` creates DOM nodes directly and assigns text through `textContent`. Model output is never assigned to `innerHTML`. It supports a deliberately bounded Markdown subset and permits only HTTP(S) and `mailto:` links; HTTP(S) links open with `noopener noreferrer`. Code copy uses the Clipboard API with a textarea fallback.

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
| `attachments.js` | Classification and one attachment record | Archive/document internals |
| `archive.js` | Safe deterministic ZIP-to-Markdown | Generic file selection |
| `anydoc.js` | AnyDoc WASM lifecycle | Attachment persistence |
| `ocr.js` | Tesseract lifecycle | Model tool orchestration |
| `firecrawl.js` | `/v2` request/response contract | Research strategy |
| `mcp.js` | MCP transport and name mapping | Tool approval |
| `tools.js` | OpenAI definitions and dispatch | Model transport |
| `markdown.js` | Safe presentation and copy | Transcript storage |

## Verification layers

- Unit tests cover endpoint policy, workspace/conversation interchange, multimodal projection, streaming tool calls, archive rendering, attachment preparation, Firecrawl contracts, and both MCP transport modes.
- `scripts/check.mjs` builds the browser graph in memory, checks the HTML/JavaScript DOM contract, verifies vendored assets, and runs a real AnyDoc WASM conversion.
- `scripts/browser-fixture.mjs` exposes deterministic OpenAI, Firecrawl, and MCP surfaces for an actual-browser smoke test without contacting public services.
