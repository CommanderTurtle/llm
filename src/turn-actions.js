// Offsets always refer to the original text, including CRLF and unclosed fences.
export function fencedBlocks(source) {
  const lines = [...String(source).matchAll(/[^\n]*(?:\n|$)/g)].filter((line) => line[0]);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index][0].replace(/\r?\n$/, "").match(/^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^\r\n]*$/);
    if (!opening) continue;
    const line = index + 1;
    const start = lines[index].index;
    const bodyStart = start + lines[index][0].length;
    const marker = opening[1];
    const closing = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`);
    index += 1;
    while (index < lines.length && !closing.test(lines[index][0].replace(/\r?\n$/, ""))) index += 1;
    const closed = index < lines.length;
    const bodyEnd = closed ? lines[index].index : source.length;
    const end = closed ? bodyEnd + lines[index][0].length : source.length;
    blocks.push({ id: blocks.length, line, start, end, marker, language: opening[2].toLowerCase() || "text",
      code: source.slice(bodyStart, bodyEnd).replace(/\r?\n$/, ""), closed });
  }
  return blocks;
}

export function applyCodeRepairs(source, targets, response) {
  const text = response.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  const result = JSON.parse(text);
  if (!Array.isArray(result.repairs) || result.repairs.length !== targets.length) throw new Error("Repair must return exactly the requested blocks.");
  const seen = new Set();
  const edits = result.repairs.map((item) => {
    const block = targets.find((target) => target.id === item.id);
    if (!block || seen.has(item.id) || typeof item.code !== "string" || !item.code.trim()) throw new Error("Invalid or duplicate repair block.");
    seen.add(item.id);
    const runs = item.code.match(/`+/g) || [];
    const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const trailing = /\n$/.test(source.slice(block.start, block.end)) ? eol : "";
    return { ...block, value: `${fence}${block.language}${eol}${item.code.replace(/\r\n?/g, "\n").replace(/\n/g, eol)}${eol}${fence}${trailing}` };
  });
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  return output;
}

export function shouldAutoContinue(result, { enabled, count, previousOutput, aborted = false }) {
  if (!enabled || aborted || count >= 3 || result.toolCalls?.length) return false;
  if (["content_filter", "refusal", "stop_sequence"].includes(result.finishReason)) return false;
  const output = `${result.content || ""}\0${result.reasoning || ""}`;
  // One empty response may recover; repeated empty/identical responses must stop.
  if (count > 0 && (output === previousOutput || !output.replace(/\0/g, "").trim())) return false;
  return result.finishReason === "length" || !result.terminal || !result.content?.trim();
}

export function expandMessageSelection(current, selection) {
  const result = new Set(selection);
  const calls = new Set();
  for (const message of current.messages) if (result.has(message.id)) {
    for (const call of message.toolCalls ?? []) calls.add(call.id);
    if (message.toolCallId) calls.add(message.toolCallId);
  }
  for (const message of current.messages) if (message.toolCalls?.some((call) => calls.has(call.id))) {
    result.add(message.id);
    for (const call of message.toolCalls) calls.add(call.id);
  }
  for (const message of current.messages) if (calls.has(message.toolCallId)) result.add(message.id);
  return result;
}

export function removeSelectedEntries(current, selection, saveUndo = false) {
  const ids = expandMessageSelection(current, selection);
  const indexed = current.messages.map((item, index) => ({ item, index })).filter(({ item }) => ids.has(item.id));
  if (!indexed.length || indexed.some(({ item }) => item.state === "streaming")) return 0;
  if (saveUndo) {
    const attachments = new Set(indexed.flatMap(({ item }) => item.attachments ?? []));
    current.undo ??= [];
    current.undo.push({ type: "delete-message", index: indexed[0].index, positions: indexed.map(({ index }) => index),
      messages: indexed.map(({ item }) => structuredClone(item)),
      attachments: (current.attachments ?? []).filter((item) => attachments.has(item.id)).map((item) => structuredClone(item)),
      createdAt: new Date().toISOString() });
    current.undo = current.undo.slice(-20);
  }
  current.messages = current.messages.filter((message) => !ids.has(message.id));
  current.compactions = (current.compactions ?? []).filter((group) => !group.messageIds.some((id) => ids.has(id)));
  return indexed.length;
}

export function restoreDeletedEntries(messages, entry) {
  const restored = [...messages];
  if (entry.positions?.length === entry.messages.length) {
    entry.messages.forEach((message, index) => restored.splice(Math.min(entry.positions[index], restored.length), 0, structuredClone(message)));
  } else restored.splice(Math.min(entry.index, restored.length), 0, ...structuredClone(entry.messages));
  return restored;
}
