import { loadClassicScript } from "./vendor-loader.js";

let workerPromise;

async function loadWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = loadClassicScript(
      new URL("../vendor/tesseract/tesseract.min.js", import.meta.url).href,
      "Tesseract",
    ).then((Tesseract) => Tesseract.createWorker("eng", undefined, {
      workerPath: new URL("../vendor/tesseract/worker.min.js", import.meta.url).href,
      corePath: new URL("../vendor/tesseract/core/", import.meta.url).href,
      langPath: new URL("../vendor/tesseract/lang/", import.meta.url).href,
      logger(message) {
        if (message?.status) onProgress?.(message.status, Number(message.progress) || 0);
      },
    }));
  }
  return workerPromise;
}

export async function ocrImageAttachment(attachment, options = {}) {
  if (!attachment || attachment.kind !== "image" || !attachment.dataUrl) {
    throw new Error("OCR needs an attached image with locally stored bytes.");
  }
  const worker = options.worker ?? await loadWorker(options.onProgress);
  options.onProgress?.("recognizing text", 0);
  const result = await worker.recognize(attachment.dataUrl);
  const text = result?.data?.text?.trim() ?? "";
  return text || "(No text was detected in the image.)";
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = undefined;
  await worker?.terminate?.();
}
