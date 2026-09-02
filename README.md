# llm

`llm` is a static, ephemeral browser harness for local OpenAI-compatible language models. It has no backend, database, account, API-key field, service worker, analytics, or browser storage. The page can be hosted at `llm.shel.sh` (base `/`) and talks directly from the browser to a model server on the same machine or private LAN.

Refresh means reset. Export the conversation JSON first if you want to keep it.

## Use it

1. Run an OpenAI-compatible local server such as vLLM. The default endpoint in the page is `http://localhost:8000/v1`.
2. Open the hosted page.
3. Click **Connect to local model** and approve the browser's local-network prompt if it appears.
4. Pick one of the model ids discovered from `GET /v1/models`, or type the id manually.
5. Chat. `Ctrl+Enter` / `Cmd+Enter` sends; **Stop** aborts the active request.

The page streams `POST /v1/chat/completions`, renders ordinary Markdown, gives every fenced code block a copy button, and separates common DeepSeek reasoning fields (`reasoning_content`, `reasoning`, or `thinking`) from the final answer.

There is no authentication configuration because the intended target is an unauthenticated local inference server. No request is made until the connect button or Send is pressed.

## Endpoints

The endpoint field is deliberately fail-closed. It accepts:

- `localhost`, `*.localhost`, and `*.local`
- IPv4 loopback, private LAN, and link-local ranges
- IPv6 loopback, unique-local, and link-local ranges
- `host.docker.internal` and `gateway.docker.internal`

Any supplied path, query, or fragment is normalized to `/v1`. Public hosts, URL credentials, non-HTTP protocols, and wildcard listen addresses are rejected in the browser before a request is made.

This is a normal browser `fetch`, not a CORS bypass or proxy. A browser may show a local-network permission dialog. If a request is blocked, the UI leaves the conversation intact and shows the browser/server reachability error under **Connection help**.

## Conversation files

**Export JSON** downloads a readable, versioned document containing:

- endpoint and selected model
- system prompt and generation parameters
- user and assistant messages
- reasoning text and response metadata when available

It contains no credential because the app has no credential surface. **Import JSON** accepts that format as well as a plain OpenAI-style text-message array. Importing is inert: it never connects automatically.

## Architecture

The project stays deliberately small:

- `src/local-endpoint.js` — local-address policy and canonical `/v1` URLs
- `src/openai.js` — model discovery, HTTP errors, SSE framing, and streaming aggregation
- `src/transcript.js` — message contract and versioned JSON interchange
- `src/markdown.js` — DOM-native Markdown subset and clipboard utilities; model text is never inserted as raw HTML
- `src/app.js` — in-memory UI state and orchestration

The separation borrows the useful part of DeepSeek Harness/Cordis: capabilities meet through narrow seams and presentation does not own transport state. It does not reproduce the server runtime or plugin kernel. The static page has no privileged core, tool executor, filesystem access, or persistent session store.

## Develop and verify

No install step or runtime dependency is required.

```bash
bun run dev
bun test
```

`npm run test:browser` starts the static site at `http://127.0.0.1:4173` and a mock OpenAI-compatible endpoint at `http://127.0.0.1:4174/v1`. It is intended for the browser smoke test documented by its console output; stop it with `Ctrl+C`.

For deployment, publish the repository contents as static files. Do not add a restrictive host-level `connect-src` policy unless it explicitly permits the local endpoints the page must reach.
