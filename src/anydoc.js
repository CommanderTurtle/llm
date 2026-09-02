let runtimePromise;

export async function loadAnyDoc() {
  if (!runtimePromise) {
    runtimePromise = import("../vendor/anydoc/anydoc_wasm.js").then(async (module) => {
      await module.default();
      return module;
    });
  }
  return runtimePromise;
}

export async function documentToMarkdown(file, options = {}) {
  const runtime = options.runtime ?? await loadAnyDoc();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = runtime.formatFromPath(file.name) ?? runtime.formatFromBytes(bytes);
  if (!format) throw new Error(`AnyDoc could not detect a supported format for ${file.name}.`);
  const markdown = runtime.toMarkdownBytes(bytes, format);
  return { markdown, format };
}
