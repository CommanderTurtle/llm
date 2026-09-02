function safeLink(value) {
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

function appendInline(parent, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\n]+\)|<https?:\/\/[^>\n]+>)/g;
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
        }
        parent.append(anchor);
      }
    } else {
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
    }
    cursor = index + token.length;
  }

  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function appendLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index) parent.append(document.createElement("br"));
    appendInline(parent, line);
  });
}

function codeBlock(code, language, onCopy) {
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
  wrapper.append(header, pre);
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
      fragment.append(codeBlock(body.join("\n"), language, options.onCopy));
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
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
        appendInline(cell, value);
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
          appendInline(cell, value);
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
      appendLines(quote, values);
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
        appendInline(item, match[2]);
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
    appendLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}
