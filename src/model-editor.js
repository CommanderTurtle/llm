const token = new URL(location.href).searchParams.get("editor");
export const ephemeral = Boolean(token && window.parent !== window);
const channel = "llm-snippet-editor";
let replaceEnabled = false;

export function receiveEditor() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Editor parent did not respond.")); }, 15_000);
    function receive(event) {
      if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== channel || event.data.token !== token || event.data.action !== "initialize") return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      replaceEnabled = event.data.replace === true;
      resolve(event.data.workspace);
    }
    window.addEventListener("message", receive);
    parent.postMessage({ channel, token, action: "ready" }, location.origin);
  });
}

export function editorReplacement() {
  return ephemeral && replaceEnabled ? (code, language) => {
    parent.postMessage({ channel, token, action: "replace", code, language }, location.origin);
  } : null;
}

export function openModelEditor({ workspace, title, onReplace }) {
  const id = crypto.randomUUID();
  const dialog = document.createElement("dialog");
  dialog.className = "model-editor";
  dialog.setAttribute("aria-label", "Open with the model");
  const header = document.createElement("header");
  header.className = "model-editor-header";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const status = document.createElement("span");
  status.className = "hint";
  status.setAttribute("role", "status");
  status.textContent = onReplace ? "Ephemeral · edit the draft before sending" : "Ephemeral · read-only source preview · edit the draft before sending";
  const close = document.createElement("button");
  close.type = "button"; close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  header.append(heading, status, close);
  const frame = document.createElement("iframe");
  frame.title = "Ephemeral model chat";
  frame.allow = "microphone 'self'; clipboard-write 'self'";
  const url = new URL(location.href);
  url.hash = ""; url.search = ""; url.searchParams.set("editor", id);
  frame.src = url.href;
  let initialized = false, replacing = false, closed = false;
  const receive = async (event) => {
    const data = event.data;
    if (event.origin !== location.origin || event.source !== frame.contentWindow || data?.channel !== channel || data.token !== id) return;
    if (data.action === "ready" && !initialized) {
      initialized = true;
      frame.contentWindow.postMessage({ channel, token: id, action: "initialize", workspace, replace: Boolean(onReplace) }, location.origin);
      workspace = null;
    } else if (data.action === "replace" && initialized && !replacing && onReplace && typeof data.code === "string") {
      replacing = true;
      try { await onReplace(data.code, data.language); if (!closed) status.textContent = "Original updated · this chat remains ephemeral"; }
      catch (error) { status.textContent = error.message; }
      finally { replacing = false; }
    }
  };
  window.addEventListener("message", receive);
  dialog.addEventListener("close", () => {
    closed = true;
    window.removeEventListener("message", receive);
    // Dispose while the frame is still alive: requests, audio, and OCR own workers.
    try { frame.contentWindow?.dispatchEvent(new Event("pagehide")); } catch { /* Navigation may have changed the frame origin. */ }
    frame.src = "about:blank";
    dialog.remove(); workspace = null;
  }, { once: true });
  dialog.append(header, frame);
  document.body.append(dialog); dialog.showModal();
}
