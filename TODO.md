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

## Verification record

- 2026-09-02: `bun run check` passed 32 tests across eight files, the in-memory browser build, 58-id DOM contract validation, vendored-file checks, and a real AnyDoc WASM RTF conversion.
- 2026-09-02: real-browser fixture verified model discovery, streamed reasoning/final output, code copy, refresh recovery, multiple persisted chats and drafts, transcript editing, text/image/PDF attachments, multimodal payloads, real bundled Tesseract OCR, Firecrawl search continuation, and current stateless MCP discovery/call continuation.
