import { combineZip } from "./archive.js";
import { documentToMarkdown } from "./anydoc.js";
import { messageId } from "./transcript.js";

export const MAX_ATTACHMENT_BYTES = 128 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "asm", "bat", "c", "cc", "cfg", "clj", "cljs", "cmd", "conf", "cpp", "cs", "css", "csv", "cxx",
  "dart", "env", "ex", "exs", "fs", "fsx", "go", "graphql", "gql", "h", "hpp", "htm", "html", "ini",
  "java", "js", "json", "json5", "jsx", "kt", "kts", "less", "log", "lua", "md", "markdown", "mjs", "php",
  "pl", "properties", "ps1", "py", "r", "rb", "rs", "sass", "scala", "scss", "sh", "sql", "svelte", "svg",
  "swift", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml", "zig",
]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odt", "pdf", "ppt", "pptx", "rtf", "epub", "xlsx", "ods", "odp"]);

function extension(name) {
  const leaf = String(name).toLowerCase().split(/[\\/]/).at(-1) || "";
  return leaf.includes(".") ? leaf.split(".").at(-1) || "" : "";
}

export function fileToDataUrl(file) {
  if (typeof FileReader === "undefined") {
    return file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function prepareAttachment(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function") throw new TypeError("Choose a browser File to attach.");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} exceeds the 128 MiB attachment limit.`);
  options.onProgress?.(`Reading ${file.name}…`);
  const dataUrlPromise = fileToDataUrl(file);
  const ext = extension(file.name);
  let kind;
  let text = "";
  let sourceFormat = ext;
  let meta = {};

  if (file.type.startsWith("image/") || ["avif", "bmp", "gif", "heic", "jpeg", "jpg", "png", "tif", "tiff", "webp"].includes(ext)) {
    kind = "image";
  } else if (ext === "zip" || file.type === "application/zip") {
    options.onProgress?.(`Combining ${file.name} into Markdown…`);
    const combined = await combineZip(file, options);
    kind = "archive";
    text = combined.markdown;
    sourceFormat = "zip";
    meta = { included: combined.included, omitted: combined.omitted, entries: combined.entries.length };
  } else if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/")) {
    kind = "text";
    text = await file.text();
  } else if (DOCUMENT_EXTENSIONS.has(ext)) {
    options.onProgress?.(`Converting ${file.name} to Markdown…`);
    const converted = await documentToMarkdown(file, options);
    kind = "document";
    text = converted.markdown;
    sourceFormat = converted.format;
  } else {
    throw new Error(`${file.name} is not a supported image, text/source file, ZIP archive, or AnyDoc document.`);
  }

  return {
    id: messageId("attachment"),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    kind,
    dataUrl: await dataUrlPromise,
    text,
    sourceFormat,
    createdAt: new Date().toISOString(),
    meta,
  };
}

export function formatAttachmentSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
