import * as ort from "./ort.wasm.min.mjs";
ort.env.wasm.wasmPaths = new URL("./", import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
export { ort };
export const session = (bytes) =>
  ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
export function dispose(tensors) {
  for (const value of Object.values(tensors)) value?.dispose?.();
}
