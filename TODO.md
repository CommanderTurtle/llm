# Agent harness implementation checklist

This checklist is the implementation contract for the static `llm.shel.sh` harness. All runtime code and vendored browser assets live in this repository; the referenced mk.it, webclip, Firecrawl, and Firebending projects remain read-only.

## State and sessions

- [x] Replace the single in-memory transcript with multiple named sessions.
- [x] Persist sessions, drafts, settings, messages, tool turns, and attachments in IndexedDB.
- [x] Support new, switch, rename, and delete session actions without making network requests.
- [x] Export/import the complete versioned workspace state, while retaining compatibility with the original single-conversation JSON format.
- [x] Export the active conversation as Markdown and expose browser print/save-to-PDF.

## Messages and OpenAI compatibility

- [x] Keep streamed OpenAI-compatible `/v1/chat/completions` support and model discovery.
- [x] Add `reasoning_effort` and `chat_template_kwargs.enable_thinking` controls.
- [x] Preserve expandable reasoning and add per-message copy, edit, and delete controls for both user and assistant turns.
- [x] Ensure edited/deleted turns are the exact turns projected into later API requests.
- [x] Parse streamed and non-streamed OpenAI tool calls and continue the conversation after tool results.
- [x] Bound autonomous tool-call rounds and make approval behavior explicit.

## Attachments

- [x] Add composer attachment selection and persistent attachment chips/previews.
- [x] Send images as OpenAI `image_url` data URLs alongside text.
- [x] Read plain text, Markdown, source, JSON, and HTML locally without a server.
- [x] Vendor the existing AnyDoc WASM build and convert supported documents/PDFs to Markdown in-browser.
- [x] Vendor JSZip and combine ZIP source trees into deterministic `combined.md`, omitting binary payloads while preserving file headers.
- [x] Keep original attachment bytes in exported state; send portable Markdown/text projections for non-image documents.

## Browser tools

- [x] Vendor Tesseract.js, its local worker/core/language assets, and licenses.
- [x] Expose attachment OCR as an OpenAI function tool with visible progress/results.
- [x] Expose Firecrawl `/v2/search` and `/v2/scrape` through a configurable private-LAN endpoint.
- [x] Implement generic private-LAN MCP Streamable HTTP discovery, `tools/list`, and `tools/call`.
- [x] Support both current stateless MCP (`2026-07-28`) and initialize/session-era servers.
- [x] Namespace MCP functions safely and show every invocation/result in the transcript.
- [x] Require per-call approval by default, with an explicit session-level automatic mode.

## Verification and handoff

- [x] Add unit coverage for state normalization, multimodal transcript projection, streamed tool calls, archive rendering, Firecrawl normalization, and MCP transports.
- [x] Extend the browser fixture with OpenAI tool calls, Firecrawl, and MCP endpoints.
- [x] Run the complete automated suite and a real browser smoke test of persistence, session switching, editing, attachments, and tool continuation.
- [x] Rewrite README and architecture documentation to match the finished implementation and its browser/CORS boundaries.
- [x] Review the final diff, verify all third-party licenses are present, and commit the finished repository.

## Opt-in reliability and browser-workspace pass

- [x] Add a persisted feature matrix whose sixteen options all default to disabled, with drag painting, grouped Shift-click, and one-click Clear all.
- [x] Preserve the `fb2a460` interaction/request contract when every option is disabled, including the 8192-token allowance and baseline tool list.
- [x] Detect output-limit, empty-output, and missing-terminal completions without adding a generation timeout; preserve partial output and offer manual Continue.
- [x] Add an Auto/server-decided output allowance that omits `max_tokens` only when selected.
- [x] Add lazy syntax highlighting, Mermaid, math, task lists, code copy, and lightweight diagnostics.
- [x] Let each session own an independent stream and Stop control when Parallel chats is enabled; avoid animated/per-token session-list work and retain the active streaming card in place.
- [x] Make whole-chat Markdown download/copy/a.shel.sh exports preserve every original turn, reasoning block, tool exchange, attachment reference, and compaction record.
- [x] Retry image-dimension `ValueError`s with proportional browser projections reduced by exactly 128 pixels on the longest side, without mutating originals.
- [x] Preserve outer and nested scroll/disclosure state while streaming when Stable streaming scroll is selected, without recreating the growing reasoning node.
- [x] Add per-session token/context estimates and a circular context meter.
- [x] Add composable, independently restorable Soft Firecrawl/context-read and Normal context projection with exact original turns retained, searchable terms, and matching color treatment.
- [x] Index unusually long Firecrawl results into exact, ordered, model-readable sections.
- [x] Add model-visible context/reasoning reads, an explicit source-bound scraped-image reader, collapsed context-read result disclosures, and a visible TODO checklist/tool with a keep-most-recent cleanup action.
- [x] Add revisioned browser documents and `instructions.md` with response-backed `DONE` PUTs, hashline read-before-write, stale-write rejection, diffs, and diagnostics.
- [x] Add browser-local undo for deleted turn groups, including the exact attachment bytes required to restore them.
- [x] Add reasoning copy/edit, individual malformed tool-request editing/deletion, Continue on the latest assistant turn, and a color-coded fuzzy/exact transcript navigator.
- [x] Reject forged calls to every disabled opt-in browser tool.

## Verification record

- 2026-09-02: `bun run check` passed 32 tests across eight files, the in-memory browser build, 58-id DOM contract validation, vendored-file checks, and a real AnyDoc WASM RTF conversion.
- 2026-09-02: real-browser fixture verified model discovery, streamed reasoning/final output, code copy, refresh recovery, multiple persisted chats and drafts, transcript editing, text/image/PDF attachments, multimodal payloads, real bundled Tesseract OCR, Firecrawl search continuation, and current stateless MCP discovery/call continuation.
- 2026-09-07: `bun run check` passed 62 tests across twelve files, the in-memory browser build, 114-id DOM contract, all-disabled baseline assertions, vendored assets, a.shel.sh round trips, and a real AnyDoc WASM RTF conversion.
- 2026-09-07: fresh-origin browser fixtures verified baseline connect/send, persisted all-disabled state, lazy highlighted code/math/Mermaid/task rendering, missing-final reasoning recovery through Continue, two simultaneous session streams, background-generation feature guards, TODOs, document revisions/diffs, reversible Normal compaction, exact long Firecrawl section projection, and zero browser warnings/errors.
- 2026-09-08: a deterministic 80-delta browser stream verified stable assistant/reasoning node identity, preserved a user-positioned nested scrollbar while reasoning grew, collapsed exact context-read request/result pairs through Soft projection, and kept only the latest of two TODOs.
- 2026-09-08: `bun run check` passed 70 tests across twelve files plus the 127-id DOM contract, all-disabled baseline, browser graph, and real AnyDoc WASM conversion. Clean browser fixtures verified response-backed `DONE` document storage, source-scoped scraped-image reads (including enabling them after an earlier scrape) and approval context, stacked Soft/Normal compactions with lower projected context and independent colors, group restore/reapply, exact and fuzzy transcript search, pointer-drag and grouped Shift selection, reasoning/tool-request editing, completed-turn Continue, complete Markdown export, and an empty browser console.
