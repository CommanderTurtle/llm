const base = new URL("./", import.meta.url);
let catalog;
export const status = (text, progress) =>
  self.postMessage({ status: text, progress });
export async function asset(model, file) {
  catalog ||= await (await fetch(new URL("assets.lock.json", base))).json();
  const entry = catalog[model]?.[file];
  if (!entry) throw Error(`Unknown asset: ${model}/${file}`);
  const key = entry.url;
  let cache;
  try {
    cache = await caches.open("speakingwasm-models-v1");
  } catch {}
  let response = await cache?.match(key);
  if (!response) {
    response = await fetch(new URL(`models/${model}/${file}`, base));
    if (
      !response.ok ||
      response.headers.get("content-type")?.includes("text/html")
    )
      response = await fetch(key);
    if (!response.ok)
      throw Error(
        `Model download failed (${response.status}): ${model}/${file}`,
      );
    // CacheStorage streams its own branch; it never holds another JS model array.
    cache?.put(key, response.clone()).catch(() => {});
  }
  const data = new Uint8Array(entry.size),
    reader = response.body.getReader();
  let offset = 0,
    lastProgress = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > data.length)
        throw Error(`Unexpected asset size: ${model}/${file}`);
      data.set(value, offset);
      offset += value.length;
      if (performance.now() - lastProgress > 80 || offset === data.length) {
        status(
          `Loading ${model} · ${file.split("/").at(-1)}`,
          offset / data.length,
        );
        lastProgress = performance.now();
      }
    }
  } catch (error) {
    await reader.cancel();
    await cache?.delete(key);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== data.length) {
    await cache?.delete(key);
    throw Error(`Incomplete model: ${model}/${file}`);
  }
  return data;
}
export async function jsonAsset(model, file) {
  return JSON.parse(new TextDecoder().decode(await asset(model, file)));
}
export async function clearModelCache() {
  return caches.delete("speakingwasm-models-v1");
}
