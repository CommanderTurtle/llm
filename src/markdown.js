import { lintCode } from "./documents.js";
import { loadClassicScript } from "./vendor-loader.js";

const HIGHLIGHT_URL = new URL("../vendor/markdown/highlight.min.js", import.meta.url).href;
const MERMAID_URL = new URL("../vendor/markdown/mermaid.min.js", import.meta.url).href;
const TEMML_URL = new URL("../vendor/markdown/temml.min.mjs", import.meta.url).href;
let temmlPromise;
let mermaidInitialized = false;

function safeLink(value) {
  if (/^#[A-Za-z0-9_-]+$/.test(value)) return { href: value, protocol: "fragment:" };
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url : null;
  } catch {
    return null;
  }
}

export async function copyText(value) {
  const text = String(value);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("The browser did not grant clipboard access.");
}

async function renderMath(element, source, displayMode = false) {
  element.classList.add(displayMode ? "math-display" : "math-inline");
  element.textContent = source;
  try {
    temmlPromise ??= import(TEMML_URL);
    const temml = (await temmlPromise).default;
    temml.render(source, element, { displayMode, throwOnError: false, strict: false });
  } catch (error) {
    element.classList.add("math-error");
    element.title = error instanceof Error ? error.message : "Math rendering failed";
  }
}

function appendInline(parent, text, options = {}) {
  const pattern = options.rich
    ? /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\((?:https?:\/\/|mailto:|#)[^)\n]+\)|<https?:\/\/[^>\n]+>|\$(?!\s)(?:\\.|[^$\n])+(?<!\s)\$)/g
    : /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\((?:https?:\/\/|mailto:|#)[^)\n]+\)|<https?:\/\/[^>\n]+>)/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index)));

    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("~~")) {
      const strike = document.createElement("s");
      strike.textContent = token.slice(2, -2);
      parent.append(strike);
    } else if (token.startsWith("[")) {
      const closing = token.indexOf("](");
      const label = token.slice(1, closing);
      const href = token.slice(closing + 2, -1);
      const url = safeLink(href);
      if (!url) {
        parent.append(document.createTextNode(token));
      } else {
        const anchor = document.createElement("a");
        anchor.href = url.href;
        anchor.textContent = label;
        if (url.protocol === "http:" || url.protocol === "https:") {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        } else if (url.protocol === "fragment:") {
          anchor.addEventListener("click", (event) => {
            const target = document.getElementById(url.href.slice(1));
            if (!target) return;
            event.preventDefault();
            if (target instanceof HTMLDetailsElement) target.open = true;
            target.scrollIntoView({ block: "start" });
          });
        }
        parent.append(anchor);
      }
    } else if (token.startsWith("<")) {
      const href = token.slice(1, -1);
      const url = safeLink(href);
      if (!url) {
        parent.append(document.createTextNode(token));
      } else {
        const anchor = document.createElement("a");
        anchor.href = url.href;
        anchor.textContent = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        parent.append(anchor);
      }
    } else {
      const math = document.createElement("span");
      void renderMath(math, token.slice(1, -1), false);
      parent.append(math);
    }
    cursor = index + token.length;
  }

  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function appendLines(parent, lines, options = {}) {
  lines.forEach((line, index) => {
    if (index) parent.append(document.createElement("br"));
    appendInline(parent, line, options);
  });
}

async function highlightCode(codeElement, code, language, diagnostics) {
  try {
    const hljs = await loadClassicScript(HIGHLIGHT_URL, "hljs");
    const normalized = String(language || "").toLowerCase();
    const languageName = normalized && hljs.getLanguage(normalized) ? normalized : "";
    const errorLines = new Map(diagnostics.map((item) => [item.line, item]));
    const fragment = document.createDocumentFragment();
    for (const [index, line] of code.split("\n").entries()) {
      const wrapper = document.createElement("span");
      wrapper.className = "code-line";
      const diagnostic = errorLines.get(index + 1);
      if (diagnostic) {
        wrapper.classList.add("code-line-error");
        wrapper.title = diagnostic.message;
      }
      const highlighted = languageName
        ? hljs.highlight(line || " ", { language: languageName, ignoreIllegals: true }).value
        : hljs.highlightAuto(line || " ").value;
      wrapper.innerHTML = highlighted;
      fragment.append(wrapper);
    }
    codeElement.replaceChildren(fragment);
  } catch {
    // Exact source text is already visible; presentation enhancement is optional.
  }
}

async function drawMermaid(container, code) {
  try {
    const mermaid = await loadClassicScript(MERMAID_URL, "mermaid");
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
      });
      mermaidInitialized = true;
    }
    const id = `mermaid-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9_-]/g, "");
    const rendered = await mermaid.render(id, code);
    container.innerHTML = rendered.svg;
    rendered.bindFunctions?.(container);
  } catch (error) {
    container.classList.add("diagram-error");
    container.textContent = `Mermaid could not render: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function codeBlock(code, language, onCopy, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-header";
  const label = document.createElement("span");
  label.textContent = language || "code";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy";
  button.addEventListener("click", async () => {
    try {
      await copyText(code);
      button.textContent = "Copied";
      onCopy?.(true);
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1_200);
    } catch (error) {
      onCopy?.(false, error);
    }
  });
  header.append(label, button);

  const pre = document.createElement("pre");
  const codeElement = document.createElement("code");
  if (language) codeElement.dataset.language = language;
  codeElement.textContent = code;
  pre.append(codeElement);
  if (!options.rich) {
    wrapper.append(header, pre);
    return wrapper;
  }
  const diagnostics = lintCode(code, language || "text");
  const normalizedLanguage = language.toLowerCase();
  if (["math", "latex", "tex"].includes(normalizedLanguage)) {
    const math = document.createElement("div");
    void renderMath(math, code, true);
    wrapper.classList.add("math-block");
    wrapper.append(header, math);
  } else if (normalizedLanguage === "mermaid" && options.diagrams !== false) {
    const diagram = document.createElement("div");
    diagram.className = "mermaid-diagram";
    diagram.textContent = "Rendering diagram…";
    wrapper.classList.add("diagram-block");
    wrapper.append(header, diagram);
    void drawMermaid(diagram, code);
  } else {
    wrapper.append(header, pre);
    void highlightCode(codeElement, code, language, diagnostics);
  }
  if (diagnostics.length) {
    const diagnosticList = document.createElement("div");
    diagnosticList.className = "code-diagnostics";
    for (const diagnostic of diagnostics) {
      const item = document.createElement("p");
      item.textContent = `L${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;
      diagnosticList.append(item);
    }
    wrapper.append(diagnosticList);
  }
  return wrapper;
}

function splitTableRow(line) {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return value.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableDelimiter(line) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function startsBlock(lines, index) {
  const line = lines[index] ?? "";
  if (!line.trim()) return true;
  if (/^\s*(```|~~~)/.test(line)) return true;
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
  if (/^\s{0,3}>\s?/.test(line)) return true;
  if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) return true;
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  return index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1]);
}

export function renderMarkdown(markdown, options = {}) {
  const fragment = document.createDocumentFragment();
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*(```|~~~)\s*([^\s`]*)?.*$/);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] ?? "";
      const body = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      fragment.append(codeBlock(body.join("\n"), language, options.onCopy, options));
      continue;
    }

    if (options.rich && /^\s*\$\$\s*$/.test(line)) {
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const math = document.createElement("div");
      void renderMath(math, body.join("\n"), true);
      fragment.append(math);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2], options);
      fragment.append(element);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1])) {
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const value of splitTableRow(line)) {
        const cell = document.createElement("th");
        appendInline(cell, value, options);
        headRow.append(cell);
      }
      head.append(headRow);
      table.append(head);
      index += 2;

      const body = document.createElement("tbody");
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const row = document.createElement("tr");
        for (const value of splitTableRow(lines[index])) {
          const cell = document.createElement("td");
          appendInline(cell, value, options);
          row.append(cell);
        }
        body.append(row);
        index += 1;
      }
      table.append(body);
      fragment.append(table);
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const values = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        values.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      appendLines(quote, values, options);
      fragment.append(quote);
      continue;
    }

    const listItem = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const match = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!match || /^\d/.test(match[1]) !== ordered) break;
        const item = document.createElement("li");
        const task = match[2].match(/^\[([ xX])\]\s+(.+)$/);
        if (options.rich && task) {
          item.className = "task-list-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = task[1].toLowerCase() === "x";
          checkbox.disabled = true;
          item.append(checkbox);
          appendInline(item, task[2], options);
        } else appendInline(item, match[2], options);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      fragment.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendLines(paragraph, paragraphLines, options);
    fragment.append(paragraph);
  }

  return fragment;
}
