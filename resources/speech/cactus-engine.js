/* global importScripts, createCactus */
import { asset, status } from "./assets.js";
export async function load(name, options) {
  importScripts("./cactus.js");
  const r = await fetch(new URL("./cactus.wasm", import.meta.url));
  if (!r.ok) throw Error("Cactus WASM is missing.");
  const m = await createCactus({
    wasmBinary: new Uint8Array(await r.arrayBuffer()),
  });
  const error = () => Error(m.UTF8ToString(m._cactus_last_error()));
  const alloc = (n) => {
    const p = m._malloc(n);
    if (!p) throw Error("Browser memory exhausted.");
    return p;
  };
  let weights = await asset(
    name,
    name === "whistle" ? "whistle.cact" : "needle3.cact",
  );
  const p = alloc(weights.length);
  let loaded;
  try {
    m.HEAPU8.set(weights, p);
    loaded = m._cactus_load(p, BigInt(weights.length));
  } finally {
    m._free(p);
    weights = null;
  }
  if (loaded < 0) throw error();
  m._cactus_set_threads(1);
  if (!(m._cactus_models() & (name === "whistle" ? 2 : 1)))
    throw Error("Incorrect Cactus model archive.");
  const call = (fn, types, args, capacity = 1 << 20) => {
    const out = alloc(capacity);
    try {
      const n = m.ccall(
        fn,
        "number",
        [...types, "number", "number"],
        [...args, out, capacity],
      );
      if (n < 0) throw error();
      if (n >= capacity)
        throw Error("Cactus response exceeded its output buffer.");
      const raw = m
        .UTF8ToString(out, capacity)
        .replace(
          /"(?:[^"\\]|\\.)*"|(?<![\w])-?(?:nan|inf|Infinity|NaN)(?![\w])/g,
          (t) => (t.startsWith('"') ? t : "null"),
        );
      return JSON.parse(raw);
    } finally {
      m._free(out);
    }
  };
  return {
    async transcribe({ pcm, stream = false }) {
      if (!(pcm instanceof Float32Array) || !pcm.length) return { text: "" };
      const input = alloc(pcm.byteLength);
      try {
        new Float32Array(m.HEAPU8.buffer, input, pcm.length).set(pcm);
        status("Listening · Whistle");
        return stream
          ? call(
              "cactus_stream_transcribe_process",
              ["number", "number", "string", "string"],
              [
                input,
                pcm.length,
                options.language || null,
                options.keywords || null,
              ],
            )
          : call(
              "cactus_transcribe",
              ["number", "number", "string", "string", "number"],
              [
                input,
                pcm.length,
                options.language || null,
                options.keywords || null,
                1,
              ],
            );
      } finally {
        m._free(input);
      }
    },
    async finish() {
      return call("cactus_stream_transcribe_stop", [], []);
    },
    async request({ text, system, tools }) {
      if (
        m.ccall(
          "cactus_init",
          "number",
          ["string", "string", "string"],
          [system, JSON.stringify(tools), null],
        ) < 0
      )
        throw error();
      return call(
        "cactus_complete",
        ["string", "number", "number", "number"],
        [text, 0, 0, 1024],
      );
    },
  };
}
