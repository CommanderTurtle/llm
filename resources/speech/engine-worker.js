/* global importScripts, createCactus */
let runtime,
  queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.op === "load") {
        if (runtime) throw Error("This worker already owns a model.");
        const module = await import(
          data.engine === "whistle" || data.engine === "needle"
            ? "./cactus-engine.js"
            : data.engine.startsWith("bark")
              ? "./bark-engine.js"
              : "./tts-engine.js"
        );
        runtime = await module.load(data.engine, data.options || {});
        self.postMessage({ id: data.id, result: { ready: true } });
      } else {
        if (!runtime) throw Error("Load an engine first.");
        const result = await runtime[data.op](data);
        self.postMessage(
          { id: data.id, result },
          result?.pcm ? [result.pcm.buffer] : [],
        );
      }
    } catch (error) {
      self.postMessage({ id: data.id, error: error.message || String(error) });
    }
  });
};
