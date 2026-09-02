import { loadClassicScript } from "./resources-loader.js";

function validateRequest(attachment, engine = "tesseract") {
  if (!attachment || attachment.kind !== "image" || !attachment.dataUrl) {
    throw new Error("OCR needs an attached image with locally stored bytes.");
  }
  if (engine !== "tesseract" && engine !== "paddle") throw new Error(`Unknown OCR engine: ${engine}`);
  return engine;
}

async function createBrowserWorker(engine, logger, signal) {
  if (engine === "paddle") {
    const Paddle = await import("../resources/ppocr/ppocr.js");
    return Paddle.createWorker({ backend: "wasm", numThreads: 1, logger, signal });
  }
  const Tesseract = await loadClassicScript(
    new URL("../resources/tesseract/tesseract.min.js", import.meta.url).href,
    "Tesseract",
  );
  return Tesseract.createWorker("eng", undefined, {
    workerPath: new URL("../resources/tesseract/worker.min.js", import.meta.url).href,
    corePath: new URL("../resources/tesseract/core/", import.meta.url).href,
    langPath: new URL("../resources/tesseract/lang/", import.meta.url).href,
    logger,
  });
}

async function recognize(worker, attachment, options, engine) {
  const { signal } = options;
  signal?.throwIfAborted();
  options.onProgress?.("recognizing text", 0);
  let onAbort;
  try {
    const cancelled = signal && new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const operation = Promise.resolve().then(() => engine === "paddle"
      ? worker.recognize(attachment.dataUrl, { signal })
      : worker.recognize(attachment.dataUrl));
    const result = await (cancelled ? Promise.race([operation, cancelled]) : operation);
    signal?.throwIfAborted();
    const text = result?.data?.text?.trim() ?? "";
    return text || "(No text was detected in the image.)";
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function createOcrService({ createWorker = createBrowserWorker } = {}) {
  let worker, workerEngine, onProgress;
  let queue = Promise.resolve();
  const logger = (message) => {
    if (message?.status) onProgress?.(message.status, Number(message.progress) || 0);
  };
  const enqueue = (operation) => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  const release = async () => {
    const previous = worker;
    worker = workerEngine = undefined;
    await previous?.terminate?.();
  };
  return {
    async recognize(attachment, options = {}) {
      const engine = validateRequest(attachment, options.engine);
      // One worker serves the queue; switching engines waits for its current call.
      return enqueue(async () => {
        options.signal?.throwIfAborted();
        onProgress = options.onProgress;
        try {
          if (workerEngine !== engine) await release();
          if (!worker) {
            worker = await createWorker(engine, logger, options.signal);
            workerEngine = engine;
          }
          return await recognize(worker, attachment, options, engine);
        } catch (error) {
          await release().catch(() => {});
          throw error;
        } finally {
          onProgress = undefined;
        }
      });
    },
    terminate() { return enqueue(release); },
  };
}

const service = createOcrService();

export async function ocrImageAttachment(attachment, options = {}) {
  const engine = validateRequest(attachment, options.engine);
  if (options.worker) return recognize(options.worker, attachment, options, engine);
  return service.recognize(attachment, options);
}

export async function terminateOcrWorker() {
  await service.terminate();
}
