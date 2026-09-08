import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanToolMarkdown,
  compactionEnvelope,
  compactionEnvelopes,
  compactionSearchTerms,
  createContextResource,
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
