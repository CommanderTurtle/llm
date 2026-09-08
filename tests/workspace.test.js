import assert from "node:assert/strict";
import test from "node:test";

import {
  activeSession,
  createSession,
  createWorkspace,
  defaultFeatures,
  FEATURE_KEYS,
  parseWorkspaceDocument,
  sessionFromConversation,
  touchSession,
  workspaceDocument,
  WORKSPACE_SCHEMA,
  WORKSPACE_VERSION,
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
  assert.throws(() => parseWorkspaceDocument({ schema: WORKSPACE_SCHEMA, version: WORKSPACE_VERSION + 1, sessions: [{}] }), /newer/);
});

test("the feature matrix is wholly opt-in and derives no baseline tools", () => {
  const workspace = createWorkspace();
  assert.deepEqual(workspace.integrations.features, defaultFeatures());
  assert.deepEqual(Object.keys(workspace.integrations.features), [...FEATURE_KEYS]);
  assert.ok(Object.values(workspace.integrations.features).every((value) => value === false));
  assert.deepEqual(workspace.integrations.localTools, { context: false, images: false, read: false, write: false, todos: false });
  assert.equal(workspace.sessions[0].parameters.maxTokens, 8192);
});

test("legacy v1 workspaces migrate with enhancements disabled", () => {
  const restored = parseWorkspaceDocument({
    schema: "https://llm.shel.sh/schemas/workspace-v1.json",
    version: 1,
    activeSessionId: "legacy",
    sessions: [{ id: "legacy", messages: [] }],
  });
  assert.equal(restored.version, WORKSPACE_VERSION);
  assert.equal(activeSession(restored).id, "legacy");
  assert.ok(Object.values(restored.integrations.features).every((value) => value === false));
});

test("enabled feature state persists and write tools imply the required reads", () => {
  const restored = parseWorkspaceDocument(workspaceDocument(createWorkspace({
    integrations: { features: { writeTools: true, richMarkdown: true, parallelSessions: true } },
  })));
  assert.equal(restored.integrations.features.writeTools, true);
  assert.equal(restored.integrations.features.readTools, true);
  assert.equal(restored.integrations.features.richMarkdown, true);
  assert.equal(restored.integrations.features.parallelSessions, true);
  assert.deepEqual(restored.integrations.localTools, { context: true, images: false, read: true, write: true, todos: false });
});

test("multiple active compaction groups and image reads survive workspace round trips", () => {
  const messages = [createMessage("user", "one", { id: "one" }), createMessage("assistant", "two", { id: "two" })];
  const restored = parseWorkspaceDocument(workspaceDocument(createWorkspace({
    integrations: { features: { compaction: true, imageReads: true } },
    sessions: [{
      messages,
      compactions: [
        { id: "c1", mode: "soft", messageIds: ["one"], summary: "one index", searchTerms: ["one"], active: true },
        { id: "c2", mode: "normal", messageIds: ["two"], summary: "two summary", searchTerms: ["two"], active: true },
      ],
    }],
  })));
  assert.equal(restored.integrations.localTools.images, true);
  assert.deepEqual(restored.sessions[0].compactions.map((item) => [item.id, item.active, item.searchTerms]), [
    ["c1", true, ["one"]],
    ["c2", true, ["two"]],
  ]);
  assert.equal(restored.sessions[0].activeCompactionId, "c2");
});

test("Auto output allowance is globally consistent with its feature checkbox", () => {
  const automatic = createWorkspace({
    sessions: [{ parameters: { maxTokens: 1234 } }, { parameters: { maxTokens: 5678 } }],
    integrations: { features: { autoMaxTokens: true } },
  });
  assert.deepEqual(automatic.sessions.map((session) => session.parameters.maxTokens), [null, null]);
  const baseline = createWorkspace({ sessions: [{ parameters: { maxTokens: null } }] });
  assert.equal(baseline.sessions[0].parameters.maxTokens, 8192);
});

test("imported resource sections cannot diverge from their exact stored content", () => {
  const workspace = createWorkspace({ sessions: [{ resources: [{
    id: "resource-1", content: "![Image](./image.webp)", sections: ["different projection"],
    sourceUrl: "https://example.test/report/", readSections: [0, 8, -1],
  }] }] });
  const resource = workspace.sessions[0].resources[0];
  assert.deepEqual(resource.sections, ["![Image](./image.webp)"]);
  assert.deepEqual(resource.readSections, [0]);
  assert.equal(resource.sectionMeta[0].images[0].url, "https://example.test/report/image.webp");
});

test("undo snapshots retain attachment bytes needed by restored turns", () => {
  const attachment = {
    id: "image-1", name: "fixture.png", type: "image/png", size: 3, kind: "image",
    dataUrl: "data:image/png;base64,AAEC", text: "", sourceFormat: "png", createdAt: new Date().toISOString(), meta: {},
  };
  const workspace = createWorkspace({
    sessions: [{
      attachments: [attachment],
      messages: [createMessage("user", "image", { id: "message-1", attachments: [attachment.id] })],
      undo: [{ type: "delete-message", index: 0, messages: [createMessage("user", "image", { attachments: [attachment.id] })], attachments: [attachment] }],
    }],
  });
  assert.equal(workspace.sessions[0].undo[0].attachments[0].dataUrl, attachment.dataUrl);
});
