import { test, expect } from "bun:test";
import { fencedBlocks, applyCodeRepairs, shouldAutoContinue, expandMessageSelection, removeSelectedEntries, restoreDeletedEntries } from "../src/turn-actions.js";
import { createSession, createWorkspace, workspaceDocument, parseWorkspaceDocument } from "../src/workspace.js";

test("repairs only selected fenced code, preserving surrounding content and other blocks", () => {
  const source = 'Before\r\n```json\r\n{"x":1\r\n```\r\nMiddle\r\n~~~~fs\r\nlet x = 1\r\n~~~~\r\nAfter';
  const blocks = fencedBlocks(source);
  expect(blocks.map((b) => [b.id, b.language, b.closed])).toEqual([[0, "json", true], [1, "fs", true]]);
  const next = applyCodeRepairs(source, [blocks[0]], JSON.stringify({ repairs: [{ id: 0, code: '{"x":1}' }] }));
  expect(next).toBe(source.replace('{"x":1\r\n', '{"x":1}\r\n'));
  expect(() => applyCodeRepairs(source, [blocks[0]], '{"repairs":[{"id":1,"code":"oops"}]}')).toThrow();
  expect(() => applyCodeRepairs(source, blocks, '{"repairs":[{"id":0,"code":"x"},{"id":0,"code":"y"}]}')).toThrow();
});

test("unclosed fences and embedded backticks are repaired without truncating code", () => {
  const source = 'Text\n```js\nconst a = "```";';
  const blocks = fencedBlocks(source);
  expect(blocks[0].closed).toBe(false);
  const next = applyCodeRepairs(source, blocks, JSON.stringify({ repairs: [{ id: 0, code: 'const a = "```";' }] }));
  expect(next).toBe('Text\n````js\nconst a = "```";\n````');
  expect(fencedBlocks(next)[0].closed).toBe(true);
});

test("automatic continuation is terminal-evidence based and bounded", () => {
  const base = { enabled: true, count: 0 };
  expect(shouldAutoContinue({ content: "partial", finishReason: "length", terminal: true }, base)).toBe(true);
  expect(shouldAutoContinue({ content: "", reasoning: "thinking", terminal: true, finishReason: "stop" }, base)).toBe(true);
  expect(shouldAutoContinue({ content: "done", terminal: true, finishReason: "stop" }, base)).toBe(false);
  expect(shouldAutoContinue({ content: "", terminal: false }, { ...base, count: 1 })).toBe(false);
  expect(shouldAutoContinue({ content: "x", terminal: false }, { ...base, count: 1, previousOutput: "x\0" })).toBe(false);
  for (const change of [{ enabled: false }, { count: 3 }, { aborted: true }]) expect(shouldAutoContinue({ finishReason: "length" }, { ...base, ...change })).toBe(false);
  expect(shouldAutoContinue({ finishReason: "content_filter" }, base)).toBe(false);
  expect(shouldAutoContinue({ toolCalls: [{}], finishReason: "length" }, base)).toBe(false);
});

test("selected operations keep complete parallel tool exchanges together", () => {
  const messages = [
    { id: "a", toolCalls: [{ id: "c1" }, { id: "c2" }] },
    { id: "b", toolCallId: "c1" }, { id: "c", toolCallId: "c2" }, { id: "d" },
  ];
  expect([...expandMessageSelection({ messages }, new Set(["c"]))].sort()).toEqual(["a", "b", "c"]);
});

test("advanced lint, autocontinue, and noncontiguous undo indexes survive storage", () => {
  const session = createSession({ undo: [{ type: "delete-message", index: 1, positions: [1, 4], messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }] });
  const state = createWorkspace({ sessions: [session], integrations: { features: { advancedLint: true, autoContinue: true } } });
  const restored = parseWorkspaceDocument(workspaceDocument(state));
  expect(restored.integrations.features.advancedLint).toBe(true);
  expect(restored.integrations.features.autoContinue).toBe(true);
  expect(restored.sessions[0].undo[0].positions).toEqual([1, 4]);
});

test("selected deletion and undo retain noncontiguous order, attachments, and unaffected groups", () => {
  const original = [{ id: "u1", attachments: ["f"] }, { id: "a1" }, { id: "u2" }, { id: "a2" }];
  const current = { messages: structuredClone(original), attachments: [{ id: "f", dataUrl: "data:text/plain;base64,YQ==" }],
    compactions: [{ id: "old", messageIds: ["u1", "a1"], summary: "private text" }, { id: "keep", messageIds: ["u2"] }] };
  expect(removeSelectedEntries(current, new Set(["u1", "a2"]), true)).toBe(2);
  expect(current.messages.map(m => m.id)).toEqual(["a1", "u2"]);
  expect(current.compactions.map(c => c.id)).toEqual(["keep"]);
  expect(current.undo[0].attachments).toEqual(current.attachments);
  expect(restoreDeletedEntries(current.messages, current.undo[0])).toEqual(original);
  const before = structuredClone(current);
  current.messages[0].state = "streaming";
  expect(removeSelectedEntries(current, new Set(["a1"]), true)).toBe(0);
  expect(current.undo).toEqual(before.undo);
});
