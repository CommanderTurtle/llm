const DATABASE_NAME = "llm-shel-harness";
const STORE_NAME = "state";
const WORKSPACE_KEY = "workspace";

function openDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) return Promise.reject(new Error("IndexedDB is unavailable in this browser context."));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction(mode, operation, indexedDb) {
  const database = await openDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = operation(store);
      let result;
      request.onerror = () => reject(request.error ?? new Error("Browser storage operation failed."));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("Browser storage transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Browser storage transaction was aborted."));
    });
  } finally {
    database.close();
  }
}

export function loadWorkspace(indexedDb) {
  return transaction("readonly", (store) => store.get(WORKSPACE_KEY), indexedDb);
}

export function saveWorkspace(workspace, indexedDb) {
  return transaction("readwrite", (store) => store.put(workspace, WORKSPACE_KEY), indexedDb);
}

export function removeStoredWorkspace(indexedDb) {
  return transaction("readwrite", (store) => store.delete(WORKSPACE_KEY), indexedDb);
}

export function makeDebouncedSaver(save, delay = 250) {
  let timer = 0;
  let latest;
  let pending = Promise.resolve();
  const flush = () => {
    if (timer) globalThis.clearTimeout(timer);
    timer = 0;
    if (latest === undefined) return pending;
    const value = latest;
    latest = undefined;
    pending = pending.catch(() => {}).then(() => save(value));
    return pending;
  };
  const schedule = (value) => {
    latest = value;
    if (timer) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => { void flush().catch(() => {}); }, delay);
  };
  schedule.flush = flush;
  return schedule;
}
