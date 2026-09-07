import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanToolMarkdown,
  compactionEnvelope,
  createContextResource,
  resourceIndex,
  segmentMarkdown,
  sessionContextStats,
  timelineMarkdown,
} from "../src/context.js";
import { createMessage } from "../src/transcript.js";

test("long browser results become ordered lossless Markdown sections", () => {
  const source = `# Start  \n\n${"alpha ".repeat(18)}\n\n## End\n${"omega ".repeat(18)}`;
  assert.equal(cleanToolMarkdown("a   \n\n\n\n b"), "a\n\n\n b");
  const sections = segmentMarkdown(source, 80);
  assert.ok(sections.length > 1);
  assert.equal(sections.join(""), source);
  const resource = createContextResource(source, { id: "resource-1", name: "Fixture", maxChars: 80 });
  assert.equal(resource.content, source);
  assert.equal(resource.sections.join(""), source);
  assert.match(resourceIndex(resource), /Resource id: `resource-1`/);
  assert.match(resourceIndex(resource), /Open section 1/);
});

test("compaction projections retain summary, ids, and an exact timeline", () => {
  const messages = [
    createMessage("user", "original question", { id: "u" }),
    createMessage("assistant", "original answer", { id: "a", reasoning: "reasoning" }),
  ];
  const compact = { id: "c", mode: "normal", active: true, summary: "Faithful summary", messageIds: ["u", "a"] };
  const envelope = compactionEnvelope(compact, messages);
  assert.match(envelope, /Faithful summary/);
  assert.match(envelope, /`u`/);
  assert.match(envelope, /`a`/);
  const timeline = timelineMarkdown({ messages, activeCompactionId: "c", compactions: [compact] });
  assert.match(timeline, /`u` · user · compacted/);
  assert.match(timeline, /`a` · assistant · compacted/);
});

test("context estimates report a bounded percentage", () => {
  const stats = sessionContextStats({ messages: [], parameters: { contextWindow: 10 } }, [{ role: "user", content: "one two three four" }]);
  assert.ok(stats.tokens > 0);
  assert.equal(stats.contextWindow, 10);
  assert.ok(stats.percent > 0);
});

test("an active lossless compaction reports its projected context instead of stale server usage", () => {
  const session = {
    messages: [{ meta: { usage: { total_tokens: 80_000 } } }],
    parameters: { contextWindow: 131_072 },
    activeCompactionId: "c",
    compactions: [{ id: "c", active: true }],
  };
  const stats = sessionContextStats(session, [{ role: "user", content: "small projection" }]);
  assert.equal(stats.tokens, stats.estimatedTokens);
  assert.equal(stats.recordedTokens, 80_000);
});
