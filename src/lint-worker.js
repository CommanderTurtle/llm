import { parseDiagnostics } from "./lint-parsers.js";
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { self.postMessage({ id: data.id, result: await parseDiagnostics(data.source, data.language) }); }
    catch (error) { self.postMessage({ id: data.id, error: String(error?.message || error) }); }
  });
};
