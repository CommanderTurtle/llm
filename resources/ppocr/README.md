# ppocr-wasm

Self-hosted PP-OCRv6 small with a Tesseract.js-style interface. Uses the [official PaddleOCR browser SDK](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js), ONNX Runtime Web and OpenCV.js. OCR runs in a browser worker, not on a server. CPU/WASM is the default; WebGPU is optional.

## Build

```sh
bun install --frozen-lockfile
bun run dev
```

First build downloads and SHA-256 verifies the two official model archives (about 31 MB). `bun run build` writes `dist/` without starting a server. `bun start` serves an existing build at `http://127.0.0.1:8198/`.

Deploy the complete `dist/` on any HTTP(S) static host, preserving relative paths. Nested paths work without a base-path rebuild. No inference server, CDN, Python, PaddlePaddle installation or API key is needed. Serve over HTTP(S), not `file://`. WebGPU needs HTTPS or localhost and a compatible browser/device.

All model/runtime requests are to the deployed bundle by default. The demo's CSP prevents external connections. A remote image URL explicitly supplied by an application still needs CORS and an appropriate host CSP. Files, image bytes and text are not uploaded.

This is a self-contained directory, not a single inline HTML file. A wrapper must preserve the worker, runtime `.mjs`/`.wasm` files and model URLs, not just inline `ppocr.js`.

## API

```js
import { createWorker } from './ppocr.js';

const worker = await createWorker('eng', undefined, {
  backend: 'wasm',
  logger: ({ status, progress }) => console.log(status, progress)
});
const { data } = await worker.recognize(file);
console.log(data.text, data.confidence, data.lines);
await worker.terminate();
```

`createWorker({ backend: 'wasm' })` is also accepted. Keep a worker warm for repeat calls; `terminate()` releases its worker and runtime memory. `recognize(image, 'eng', options)` is a one-shot convenience export.

Inputs: File/Blob, image/canvas/ImageBitmap/ImageData, ArrayBuffer/typed bytes, data URL, or a CORS-readable image URL. Encoded inputs are capped at 32 MiB; processed images default to 16 million pixels. `maxPixels` can raise this to 64 million.

Recognition options:

```js
const result = await worker.recognize(image, {
  rectangle: { left: 20, top: 30, width: 600, height: 200 },
  signal: controller.signal,
  asciiPunctuation: true,
  parameters: { textRecScoreThresh: 0.5 }
});
```

Bounding boxes remain in original-image coordinates after a crop. Aborting or timing out terminates that worker, including queued calls; create a new one afterward. `createWorker({ signal })` also supports cancellation during initialization. Default operation timeout is 120 seconds (`timeoutMs`).

`setParameters()` accepts Paddle settings only: `textDetLimitSideLen`, `textDetLimitType`, `textDetMaxSideLimit`, `textDetThresh`, `textDetBoxThresh`, `textDetUnclipRatio`, `textRecScoreThresh`. Defaults follow the Omarchy screen-text profile: short-side minimum 320, thresholds 0.3/0.5, unclip 1.6, recognition score 0.5. Upstream still owns resize, detection, polygon expansion, perspective crop and recognition.

`getInitializationSummary()` reports the actual detection and recognition providers. Backend `auto` tries WebGPU and falls back to WASM during session creation; `webgpu` is strict. The default `wasm` performs CPU inference. The upstream SDK may still probe WebGPU availability during initialization.

One WASM thread works without special hosting headers. Opt-in `numThreads: 2` through `8` requires cross-origin isolation. For the local server use `OCR_ISOLATED=1`; on a host set COOP `same-origin` and COEP `require-corp`. Each worker owns its runtime settings; workers do not share ORT globals.

With a strict CSP, the OCR worker needs `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'` for OpenCV's generated bindings and WASM. The page can omit `unsafe-eval`. The local server applies this exception only on the OCR worker response. This requirement belongs to the pinned upstream OpenCV build, not to execution of recognized text.

Advanced deployment: `modelPath`, `runtimePath`, and `workerPath` override the local URLs. The pinned runtime JS and WASM must stay together.

## Compatibility boundaries

- Supports the common `createWorker('eng', undefined, { logger })`, `recognize`, `setParameters`, and `terminate` flow. 
- `eng`, `en` and `multi` select the same multilingual v6 small bundle, not English-only inference. Unsupported settings fail explicitly.
- `data.text`, `confidence` (0-100 model scores), `lines`, line-level `blocks`, original detection `items`, polygons, runtime and timing metadata are returned. Word arrays are empty: line boxes are not falsely presented as word boxes. 
- Screen-style indentation, column gaps and paragraph gaps use the Omarchy plugin's line reconstruction. This is not full document layout/table analysis. Upright screenshots are the target; no document orientation model is loaded.
