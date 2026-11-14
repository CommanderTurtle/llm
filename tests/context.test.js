import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanToolMarkdown,
  compactionEnvelope,
  compactionEnvelopes,
  compactionSearchTerms,
  createContextResource,
  firecrawlExportProjection,
  isContextLimitError,
  markResourceSectionRead,
  resourceIndex,
  resourceSearchMarkdown,
  resourceSectionImage,
  resourceSectionImages,
  resourceSectionTags,
  segmentMarkdown,
  sessionContextStats,
  timelineMarkdown,
} from "../src/context.js";
import { conversationMarkdown, createMessage } from "../src/transcript.js";
import { fencedBlocks } from "../src/turn-actions.js";

test("collapsed export keeps the first Firecrawl section and all other originals without mutating the chat", () => {
  const first = "https://example.com/source\n\n```js\nfirst();\n";
  const later = "laterRawOnly();\n```\n";
  const raw = first + later;
  const session = {
    title: "Export fixture",
    resources: [{ id: "r", content: raw, sections: [first, later] }],
    messages: [
      createMessage("tool", raw, { id: "scrape", name: "web_scrape", toolCallId: "s", meta: { resourceId: "r" } }),
      createMessage("tool", later, { id: "read", name: "context_read", toolCallId: "r", meta: { resourceId: "r" } }),
      createMessage("tool", raw, { id: "search", name: "web_search", toolCallId: "q", meta: { resourceId: "r" } }),
      createMessage("assistant", "Final response", { reasoning: "Reasoning preserved" }),
      createMessage("tool", raw, { name: "other_tool", toolCallId: "o" }),
    ],
    compactions: [{ id: "c", active: true, mode: "soft", summary: "Collapsed reads", messageIds: ["scrape", "read"] }],
  };
  const saved = structuredClone(session);
  const normal = conversationMarkdown(session);
  const projected = firecrawlExportProjection(session);
  assert.deepEqual(session, saved);
  assert.equal(conversationMarkdown(session), normal);
  for (const index of [0, 2]) {
    assert.match(projected.messages[index].content, /section 1 of 2/);
    assert.match(projected.messages[index].content, /Section 2.*omitted from this copy/);
    assert.ok(projected.messages[index].content.includes(first));
    assert.ok(!projected.messages[index].content.includes(later));
    const blocks = fencedBlocks(projected.messages[index].content);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].closed, true);
  }
  for (const index of [1, 3, 4]) assert.equal(projected.messages[index], session.messages[index]);
  assert.equal(projected.compactions, session.compactions);
  const markdown = conversationMarkdown(projected);
  assert.ok(markdown.includes(later));
  assert.match(markdown, /Final response|Reasoning preserved/);
  assert.match(markdown, /Collapsed reads/);
});

test("collapsed export sections unindexed and edited results but leaves short results intact", () => {
  const raw = "FIRST ".repeat(2_000) + "TAIL_RAW_ONLY";
  const stale = { id: "stale", sections: ["obsolete", "content"] };
  const session = { resources: [stale], messages: [
    createMessage("tool", raw, { name: "web_scrape", toolCallId: "s" }),
    createMessage("tool", raw, { name: "web_search", toolCallId: "q", meta: { resourceId: "stale" } }),
    createMessage("tool", "Small complete result", { name: "web_search", toolCallId: "short" }),
  ] };
  const projected = firecrawlExportProjection(session);
  for (const message of projected.messages.slice(0, 2)) {
    assert.ok(message.content.includes(segmentMarkdown(raw)[0]));
    assert.doesNotMatch(message.content, /TAIL_RAW_ONLY|obsolete/);
    assert.match(message.content, /section 1 of 2/);
  }
  assert.equal(projected.messages[2], session.messages[2]);
});

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

test("multiple active compactions compose and retain searchable values", () => {
  const messages = [
    createMessage("user", "Alpha contract needs the orchard checksum", { id: "u" }),
    createMessage("assistant", "Beta result preserves the orchard checksum", { id: "a" }),
  ];
  const compactions = [
    { id: "c1", mode: "soft", active: true, summary: "Alpha index", messageIds: ["u"], searchTerms: ["orchard"] },
    { id: "c2", mode: "normal", active: true, summary: "Beta summary", messageIds: ["a"], searchTerms: ["checksum"] },
  ];
  const combined = compactionEnvelopes(compactions, messages);
  assert.match(combined, /id="c1"/);
  assert.match(combined, /id="c2"/);
  assert.match(combined, /Searchable values: `orchard`/);
  assert.deepEqual(compactionSearchTerms(messages, ["u", "a"], 2), ["checksum", "orchard"]);
});

test("context estimates report a bounded percentage", () => {
  const stats = sessionContextStats({ messages: [], parameters: { contextWindow: 10 } }, [{ role: "user", content: "one two three four" }]);
  assert.ok(stats.tokens > 0);
  assert.equal(stats.contextWindow, 10);
  assert.ok(stats.percent > 0);
});

test("context-limit errors are distinguished from ordinary endpoint failures", () => {
  assert.equal(isContextLimitError(new Error("This model's maximum context length is 32768 tokens, but you requested 40960 tokens.")), true);
  assert.equal(isContextLimitError({ message: "You requested 8192 output tokens but have 2048 context tokens available." }), true);
  assert.equal(isContextLimitError(new Error("Local model endpoint returned HTTP 500.")), false);
  assert.equal(isContextLimitError(new Error("The request timed out after 300 seconds.")), false);
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

test("resource sections expose at most two deterministic comma-ready tags", () => {
  const markedUp = `${"<div>\\/^</div>".repeat(30)}\n\n\`\`\`js\nalert(1)\n\`\`\`\n\n| A | B |\n| --- | --- |`;
  assert.deepEqual(resourceSectionTags(markedUp), ["html_gibberish", "code"]);
  assert.deepEqual(resourceSectionTags("| A | B |\n| --- | --- |\n| 1 | 2 |"), ["table"]);
});

test("scraped image metadata retains its page source and resolves relative URLs", () => {
  const images = resourceSectionImages("![Chart](./media/chart.webp)\n<img src='https://cdn.example/other.png' alt='Other'>", {
    sourceUrl: "https://example.test/report/index.html",
  });
  assert.deepEqual(images.map((image) => image.url), [
    "https://example.test/report/media/chart.webp",
    "https://cdn.example/other.png",
  ]);
  assert.equal(images[0].sourceUrl, "https://example.test/report/index.html");

  const resource = createContextResource("![Chart](./media/chart.webp)", {
    sourceUrl: "https://example.test/report/index.html",
  });
  assert.equal(resourceSectionImage(resource, 0, "https://example.test/report/media/chart.webp")?.alt, "Chart");
  assert.equal(resourceSectionImage(resource, 0, "https://example.test/report/media/elsewhere.webp"), null);
});

test("resource search uses the local index and returns section anchors only after read state can be recorded", () => {
  const resource = createContextResource(`# Alpha\nneedle first ${"alpha ".repeat(10)}\n\n# Beta\nneedle second ${"beta ".repeat(10)}`, {
    id: "resource-search",
    name: "Search fixture",
    maxChars: 80,
  });
  assert.deepEqual(resource.readSections, []);
  markResourceSectionRead(resource, 0);
  assert.deepEqual(resource.readSections, [0]);
  const result = resourceSearchMarkdown(resource, "needle");
  assert.match(result, /#resource-resource-search-section-1/);
  assert.match(result, /#resource-resource-search-section-2/);
  assert.match(resourceSearchMarkdown(resource, "@missing"), /^No sections/);
});
