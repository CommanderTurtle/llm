import assert from "node:assert/strict";
import test from "node:test";
import { createOcrService, ocrImageAttachment } from "../src/ocr.js";
import { createWorkspace, normalizeIntegrations, parseWorkspaceDocument, workspaceDocument } from "../src/workspace.js";
import { openAiTools } from "../src/tools.js";

const image = { kind: "image", dataUrl: "data:image/png;base64,fixture" };
const result = (text) => ({ data: { text } });

test("OCR defaults and legacy workspaces keep Tesseract, including disabled OCR", () => {
  assert.deepEqual(createWorkspace().integrations.ocr, { enabled: true, engine: "tesseract" });
  assert.deepEqual(normalizeIntegrations({ ocr: { enabled: false } }).ocr, { enabled: false, engine: "tesseract" });
  assert.equal(normalizeIntegrations({ ocr: { engine: "unknown" } }).ocr.engine, "tesseract");
  for (const enabled of [true, false]) {
    const restored = parseWorkspaceDocument(workspaceDocument(createWorkspace({
      integrations: { ocr: { enabled, engine: "paddle" } },
    })));
    assert.deepEqual(restored.integrations.ocr, { enabled, engine: "paddle" });
    const tools = openAiTools(restored.integrations);
    assert.equal(tools.length, enabled ? 1 : 0);
    if (enabled) {
      assert.equal(tools[0].function.name, "ocr_attachment");
      assert.match(tools[0].function.description, /local Paddle OCR/);
    }
  }
});

test("both engines preserve the text result and blank-image fallback contract", async () => {
  for (const engine of ["tesseract", "paddle"]) {
    assert.equal(await ocrImageAttachment(image, { engine, worker: { recognize: async () => result("  Hello\nworld\n ") } }), "Hello\nworld");
    assert.equal(await ocrImageAttachment(image, { engine, worker: { recognize: async () => result(" \n") } }), "(No text was detected in the image.)");
  }
  await assert.rejects(() => ocrImageAttachment({ kind: "text" }), /OCR needs an attached image/);
  await assert.rejects(() => ocrImageAttachment(image, { engine: "unknown" }), /Unknown OCR engine/);
});

test("workers initialize lazily, reuse warm engines and terminate before switching", async () => {
  const events = [];
  const service = createOcrService({ createWorker: async (engine, logger) => {
    events.push(`create:${engine}`);
    logger({ status: "loading", progress: 0.5 });
    return {
      async recognize() { logger({ status: engine, progress: 1 }); return result(engine); },
      async terminate() { events.push(`terminate:${engine}`); },
    };
  } });
  assert.deepEqual(events, []);
  const first = [], second = [];
  await service.recognize(image, { onProgress: (...args) => first.push(args) });
  const firstLength = first.length;
  await service.recognize(image, { onProgress: (...args) => second.push(args) });
  assert.equal(first.length, firstLength, "warm progress must not go to the first caller");
  assert.deepEqual(second.at(-1), ["tesseract", 1]);
  await service.recognize(image, { engine: "paddle" });
  await service.recognize(image, { engine: "tesseract" });
  await service.terminate();
  assert.deepEqual(events, ["create:tesseract", "terminate:tesseract", "create:paddle", "terminate:paddle", "create:tesseract", "terminate:tesseract"]);
});

test("parallel chat OCR is serialized, with the engine captured per request", async () => {
  const events = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const service = createOcrService({ createWorker: async (engine) => ({
    async recognize() {
      events.push(`start:${engine}`);
      if (engine === "tesseract") { started(); await blocked; }
      events.push(`end:${engine}`);
      return result(engine);
    },
    async terminate() { events.push(`terminate:${engine}`); },
  }) });
  const first = service.recognize(image);
  await ready;
  const second = service.recognize(image, { engine: "paddle" });
  assert.deepEqual(events, ["start:tesseract"]);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["tesseract", "paddle"]);
  assert.deepEqual(events, ["start:tesseract", "end:tesseract", "terminate:tesseract", "start:paddle", "end:paddle"]);
  await service.terminate();
});

test("failed initialization and failed recognition release the worker and allow retries", async () => {
  let attempts = 0, terminations = 0;
  const service = createOcrService({ createWorker: async () => {
    const attempt = ++attempts;
    if (attempt === 1) throw Error("init failed");
    return {
      async recognize() { if (attempt === 2) throw Error("worker timed out"); return result("recovered"); },
      async terminate() { terminations++; },
    };
  } });
  await assert.rejects(() => service.recognize(image), /init failed/);
  await assert.rejects(() => service.recognize(image), /worker timed out/);
  assert.equal(await service.recognize(image), "recovered");
  assert.equal(attempts, 3);
  assert.equal(terminations, 1);
  await service.terminate();
});

test("Paddle receives cancellation on init and recognize; aborted queued calls do no work", async () => {
  const controller = new AbortController();
  let attempts = 0, terminations = 0;
  const service = createOcrService({ createWorker: async (_engine, _logger, signal) => {
    attempts++;
    assert.equal(signal, controller.signal);
    return {
      async recognize(_image, options) {
        assert.equal(options.signal, controller.signal);
        controller.abort();
        options.signal.throwIfAborted();
      },
      async terminate() { terminations++; },
    };
  } });
  await assert.rejects(() => service.recognize(image, { engine: "paddle", signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(() => service.recognize(image, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(attempts, 1);
  assert.equal(terminations, 1);
});
