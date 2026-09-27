import { parserLanguage } from "./lint-parsers.js";

let worker;
let sequence = 0;
const pending = new Map();
const cache = new Map();
function resetWorker(reason) {
  worker?.terminate();
  worker = null;
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(reason)); }
  pending.clear();
}
export function clearAdvancedLint() {
  resetWorker("Advanced linting was disabled.");
  cache.clear();
}
export async function advancedLint(source, language) {
  if (!parserLanguage(language)) return { supported: false, diagnostics: [] };
  if (source.length > 256_000) throw new Error("Advanced syntax checking is limited to 256,000 characters per block.");
  const key = `${language}\0${source}`;
  if (cache.has(key)) return cache.get(key);
  if (!worker) {
    worker = new Worker(new URL("./lint-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
    };
    worker.onerror = () => resetWorker("Advanced parser failed; standard diagnostics remain available.");
  }
  const id = ++sequence;
  const result = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, timer: setTimeout(() => resetWorker("Advanced parser timed out; standard diagnostics remain available."), 15_000) });
    worker.postMessage({ id, source, language });
  });
  cache.set(key, result);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  result.catch(() => cache.delete(key));
  return result;
}
