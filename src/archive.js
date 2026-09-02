import { loadClassicScript } from "./vendor-loader.js";

export const MAX_ARCHIVE_ENTRIES = 20_000;
export const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_INFLATED_BYTES = 512 * 1024 * 1024;
export const MAX_COMBINED_TEXT_BYTES = 64 * 1024 * 1024;

const BINARY_EXTENSIONS = new Set([
  "7z", "a", "apk", "appimage", "avi", "avif", "bin", "bmp", "bz2", "class", "db", "dll", "dmg",
  "doc", "docx", "dylib", "eot", "exe", "flac", "gif", "gz", "heic", "ico", "iso", "jar", "jpeg",
  "jpg", "lib", "m4a", "m4v", "mkv", "mov", "mp3", "mp4", "o", "obj", "ogg", "otf", "pdf", "png",
  "ppt", "pptx", "pyc", "rar", "so", "sqlite", "sqlite3", "tar", "tif", "tiff", "ttf", "wav", "webm",
  "webp", "woff", "woff2", "xls", "xlsx", "xz", "zip", "zst",
]);

const LANGUAGE_BY_EXTENSION = {
  asm: "asm", bat: "bat", c: "c", cc: "cpp", clj: "clojure", cljs: "clojure", cmd: "bat",
  coffee: "coffeescript", cpp: "cpp", cs: "csharp", css: "css", csv: "csv", cxx: "cpp", dart: "dart",
  dockerfile: "dockerfile", ex: "elixir", exs: "elixir", fs: "fsharp", fsx: "fsharp", go: "go",
  graphql: "graphql", gql: "graphql", h: "c", hpp: "cpp", htm: "html", html: "html", ini: "ini",
  java: "java", js: "javascript", json: "json", json5: "json5", jsx: "jsx", kt: "kotlin", kts: "kotlin",
  less: "less", lua: "lua", md: "markdown", markdown: "markdown", mjs: "javascript", php: "php", pl: "perl",
  ps1: "powershell", py: "python", r: "r", rb: "ruby", rs: "rust", sass: "sass", scala: "scala",
  scss: "scss", sh: "bash", sql: "sql", svelte: "svelte", swift: "swift", toml: "toml", ts: "typescript",
  tsx: "tsx", txt: "text", vue: "vue", xml: "xml", yaml: "yaml", yml: "yaml", zig: "zig",
};

function extensionFor(path) {
  const leaf = path.split("/").at(-1)?.toLowerCase() || "";
  if (leaf === "dockerfile" || leaf === "makefile") return leaf;
  return leaf.includes(".") ? leaf.split(".").at(-1) || "" : "";
}

export function languageForPath(path) {
  const extension = extensionFor(path);
  if (extension === "makefile") return "makefile";
  return LANGUAGE_BY_EXTENSION[extension] || "text";
}

export function normalizeArchivePath(input) {
  const normalized = String(input)
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replaceAll("\\", "/")
    .replace(/^[A-Za-z]:/, "");
  const parts = normalized.split("/").filter((part) => part && part !== ".").map((part) => part === ".." ? "_parent_" : part);
  return parts.join("/") || "unnamed";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function binaryReason(path, bytes) {
  if (BINARY_EXTENSIONS.has(extensionFor(path))) return "binary file";
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return "";
  if (bytes.includes(0)) return "binary data";
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  let suspicious = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  return sample.length && suspicious / sample.length > 0.02 ? "binary data" : "";
}

function decodeText(bytes) {
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = new Uint8Array(bytes.length - 2);
      for (let index = 2; index + 1 < bytes.length; index += 2) {
        swapped[index - 2] = bytes[index + 1];
        swapped[index - 1] = bytes[index];
      }
      return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    }
    const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return undefined;
  }
}

function longestBacktickRun(text) {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    current = char === "`" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function renderCombinedMarkdown(entries) {
  const body = entries.map((entry) => {
    const heading = `## File: ./${entry.path}`;
    if (entry.omittedReason) return `${heading}\n\n(omitted — ${entry.omittedReason}, ${formatBytes(entry.size)})\n\n***`;
    const text = entry.text || "";
    const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
    return `${heading}\n\n${fence}${entry.language}\n${text}${text.endsWith("\n") || !text ? "" : "\n"}${fence}\n\n***`;
  }).join("\n\n");
  return body ? `${body}\n` : "";
}

async function defaultZip() {
  return loadClassicScript(new URL("../vendor/jszip/jszip.min.js", import.meta.url).href, "JSZip");
}

export async function combineZip(file, options = {}) {
  if (file.size > MAX_TOTAL_INFLATED_BYTES) throw new Error(`The archive itself exceeds ${formatBytes(MAX_TOTAL_INFLATED_BYTES)}.`);
  const JSZip = options.JSZip ?? await defaultZip();
  const archive = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
  const rawEntries = [];
  archive.forEach((path, value) => {
    if (value.dir) return;
    rawEntries.push({ path, size: value._data?.uncompressedSize ?? -1, read: () => value.async("uint8array") });
  });
  if (rawEntries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`The archive contains more than ${MAX_ARCHIVE_ENTRIES.toLocaleString()} files.`);
  rawEntries.sort((left, right) => normalizeArchivePath(left.path).localeCompare(normalizeArchivePath(right.path)));

  const entries = [];
  let inflatedBytes = 0;
  let combinedTextBytes = 0;
  for (const raw of rawEntries) {
    const path = normalizeArchivePath(raw.path);
    const knownSize = Math.max(0, raw.size);
    inflatedBytes += knownSize;
    if (inflatedBytes > MAX_TOTAL_INFLATED_BYTES) throw new Error(`The expanded archive exceeds ${formatBytes(MAX_TOTAL_INFLATED_BYTES)}.`);
    if (knownSize > MAX_TEXT_FILE_BYTES) {
      entries.push({ path, size: knownSize, language: languageForPath(path), omittedReason: "file exceeds text limit" });
      continue;
    }
    if (BINARY_EXTENSIONS.has(extensionFor(path))) {
      entries.push({ path, size: knownSize, language: languageForPath(path), omittedReason: "binary file" });
      continue;
    }
    const bytes = await raw.read();
    if (raw.size < 0) inflatedBytes += bytes.length;
    if (inflatedBytes > MAX_TOTAL_INFLATED_BYTES) throw new Error(`The expanded archive exceeds ${formatBytes(MAX_TOTAL_INFLATED_BYTES)}.`);
    if (bytes.length > MAX_TEXT_FILE_BYTES) {
      entries.push({ path, size: bytes.length, language: languageForPath(path), omittedReason: "file exceeds text limit" });
      continue;
    }
    const reason = binaryReason(path, bytes);
    const text = reason ? undefined : decodeText(bytes);
    if (reason || text === undefined) {
      entries.push({ path, size: bytes.length, language: languageForPath(path), omittedReason: reason || "unsupported text encoding" });
      continue;
    }
    const textBytes = new TextEncoder().encode(text).length;
    if (combinedTextBytes + textBytes > MAX_COMBINED_TEXT_BYTES) {
      entries.push({ path, size: bytes.length, language: languageForPath(path), omittedReason: "combined document limit reached" });
      continue;
    }
    combinedTextBytes += textBytes;
    entries.push({ path, size: bytes.length, language: languageForPath(path), text });
  }
  return {
    markdown: renderCombinedMarkdown(entries),
    entries,
    included: entries.filter((entry) => entry.text !== undefined).length,
    omitted: entries.filter((entry) => entry.omittedReason !== undefined).length,
  };
}
