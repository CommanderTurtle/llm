import assert from "node:assert/strict";
import test from "node:test";

import {
  activeSession,
  createSession,
  createWorkspace,
  parseWorkspaceDocument,
  sessionFromConversation,
  touchSession,
  workspaceDocument,
  WORKSPACE_SCHEMA,
} from "../src/workspace.js";
import { createMessage } from "../src/transcript.js";

test("workspace preserves multiple resumable sessions and active selection", () => {
  const first = createSession({ id: "one", title: "One", draft: "unfinished" });
  const second = createSession({ id: "two", title: "Two", model: "model-b" });
  const workspace = createWorkspace({ sessions: [first, second], activeSessionId: "two" });
  const restored = parseWorkspaceDocument(workspaceDocument(workspace));
  assert.equal(restored.schema, WORKSPACE_SCHEMA);
  assert.equal(restored.sessions.length, 2);
  assert.equal(activeSession(restored).id, "two");
  assert.equal(restored.sessions[0].draft, "unfinished");
});

test("persisted in-flight responses recover as interrupted instead of streaming forever", () => {
  const session = createSession({
    id: "chat",
    messages: [createMessage("assistant", "partial", { state: "streaming" })],
  });
  const stored = workspaceDocument(createWorkspace({ sessions: [session] }));
  assert.equal(stored.sessions[0].messages[0].state, "stopped");
  assert.equal(stored.sessions[0].messages[0].meta.finishReason, "interrupted");
});

test("session titles derive from the first user turn unless manually locked", () => {
  const automatic = createSession({ messages: [createMessage("user", "A useful first question")], title: "New chat" });
  touchSession(automatic);
  assert.equal(automatic.title, "A useful first question");
  const locked = createSession({ title: "Pinned title", titleLocked: true, messages: automatic.messages });
  touchSession(locked);
  assert.equal(locked.title, "Pinned title");
});

test("legacy conversation imports become isolated sessions with their attachments", () => {
  const imported = sessionFromConversation({
    title: "Import",
    attachments: [{ id: "note", name: "note.md", kind: "document", text: "# Note" }],
    messages: [{ role: "user", content: "Read it", attachments: ["note"] }],
  });
  assert.equal(imported.title, "Import");
  assert.equal(imported.attachments[0].text, "# Note");
  assert.deepEqual(imported.messages[0].attachments, ["note"]);
});

test("workspace rejects unknown schemas and future versions", () => {
  assert.throws(() => parseWorkspaceDocument({ schema: "elsewhere", sessions: [{}] }), /not an llm workspace/);
  assert.throws(() => parseWorkspaceDocument({ schema: WORKSPACE_SCHEMA, version: 2, sessions: [{}] }), /newer/);
});
