const scripts = new Map();

export function loadClassicScript(url, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (scripts.has(url)) return scripts.get(url);
  if (typeof document === "undefined") return Promise.reject(new Error(`Cannot load ${globalName} outside a browser.`));

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.addEventListener("load", () => {
      if (globalThis[globalName]) resolve(globalThis[globalName]);
      else reject(new Error(`${globalName} did not register after ${url} loaded.`));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load local browser asset ${url}.`)), { once: true });
    document.head.append(script);
  });
  scripts.set(url, promise);
  return promise;
}
