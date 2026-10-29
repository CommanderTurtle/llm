# Browser PP-OCR feasibility

omarchy-ppocr runs PP-OCRv6 small through RapidOCR and native ONNX Runtime on CPU. Its Python/socket daemon exists to keep native sessions warm; it is not required by the model format. A browser worker can hold equivalent detection and recognition sessions warm in ONNX Runtime Web instead.

PaddleOCR already publishes an official browser SDK, `@paddleocr/paddleocr-js`. Version 0.4.2 contains built-in v6 small and tiny asset definitions, even though the browser quick-start documentation still demonstrates v5. This project uses the official v6 small ONNX archives, including their preprocessing configuration and recognition dictionary. It does not run Python/PaddlePaddle, compile the full Paddle framework into WASM, or substitute a generative VLM.

The adapter owns worker transport, input decoding, deployment URLs, the Tesseract-like result envelope and the Omarchy-derived screen-text line reconstruction. Upstream owns detection, polygon expansion, perspective cropping, CTC decoding and inference-provider selection. All installed dependency files are unmodified. The build pins one OpenCV instance and the matching local ORT JS/WASM assets.

## Verified locally

- GPU-disabled Edge: both inference sessions reported `wasm`; all three generated text lines matched exactly.
- WebGPU-enabled Edge: both sessions reported `webgpu` and recognized the same fixture. This verifies the API/provider path, not a claim of hardware speedup on other machines.
- Auto mode with WebGPU disabled: both sessions fell back to WASM.
- Two-thread WASM under COOP/COEP and nested `/tools/ocr/` hosting passed.
- Warm reuse, cropped images with original-coordinate boxes, blank images, initialization cancellation, termination and unsupported-parameter errors passed.
- The demo read all five lines of the Omarchy plugin's small-text example correctly. This is a spot check, not its 100-image benchmark.
- Runtime request logs contained only same-origin static GETs. No OCR API, CDN, proxy or image upload was used.
- Nine pure unit checks cover local data-URL decoding, option validation, layout, punctuation, coordinates, empty results and score handling. Detailed browser artifacts are generated under ignored `artifacts/`.

The current complete dist is approximately 100 MB, including runtime variants and 31 MB of model archives. OpenCV's generated bindings require unsafe-eval in the OCR worker's CSP; single-thread WASM does not require cross-origin isolation. 

## Primary references

- [Omarchy plugin source](https://github.com/devrahulbanjara/omarchy-ppocr), inspected at `7d0e7e39bafd74850cd86b01d703427de4f569ef`.
- [PaddleOCR browser SDK source](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js), inspected at `dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf`; installed package 0.4.2.
- [Official model asset definitions](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/src/resources/model-asset.ts).
- [Official browser deployment documentation](https://www.paddleocr.ai/main/en/version3.x/inference_deployment/cross_platform/browser.html).
- [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html) and [runtime flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).
