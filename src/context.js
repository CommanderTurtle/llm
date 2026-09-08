import { messageId } from "./transcript.js";

export const DEFAULT_CONTEXT_WINDOW = 131_072;
export const RESOURCE_SECTION_CHARS = 12_000;

const resourceSearchIndexes = new WeakMap();
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

function text(value) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

export function estimateTokens(value) {
  const source = text(value);
  if (!source) return 0;
  const bytes = new TextEncoder().encode(source).length;
  const words = source.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(Math.max(bytes / 4, words * 0.72)));
}

export function isContextLimitError(value) {
  const source = value && typeof value === "object"
    ? [value.message, value.detail, value.cause?.message].filter(Boolean).join("\n")
    : String(value ?? "");
  if (!/\btokens?\b/i.test(source)) return false;
  const namesContextLimit = /\b(?:context(?:\s+(?:window|length))?|maximum\s+(?:model(?:'s)?\s+)?(?:context\s+)?length|max(?:imum)?[_ -]?model[_ -]?len)\b/i.test(source);
  const describesOverflow = /\b(?:request(?:ed|ing)?|requires?|exceeds?|available|reduce|too\s+(?:many|long|large)|limit|maximum)\b/i.test(source);
  return namesContextLimit && describesOverflow;
}

export function sessionContextStats(session, projectedMessages = null) {
  const projection = projectedMessages ?? session.messages ?? [];
  const estimatedTokens = estimateTokens(projection);
  const latestUsage = [...(session.messages ?? [])].reverse()
    .find((message) => Number.isFinite(Number(message.meta?.usage?.total_tokens)))?.meta?.usage;
  const recordedTokens = Number(latestUsage?.total_tokens);
  const activeCompaction = (session.compactions ?? []).some((item) => item.active);
  const tokens = activeCompaction
    ? estimatedTokens
    : Math.max(estimatedTokens, Number.isFinite(recordedTokens) ? recordedTokens : 0);
  const contextWindow = Math.max(1, Math.trunc(Number(session.parameters?.contextWindow) || DEFAULT_CONTEXT_WINDOW));
  return {
    tokens,
    estimatedTokens,
    recordedTokens: Number.isFinite(recordedTokens) ? recordedTokens : null,
    contextWindow,
    percent: Math.min(999, (tokens / contextWindow) * 100),
  };
}

export function cleanToolMarkdown(value) {
  return text(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function segmentMarkdown(value, maxChars = RESOURCE_SECTION_CHARS) {
  const source = text(value);
  if (!source) return [""];
  const width = Math.max(64, Math.trunc(Number(maxChars) || RESOURCE_SECTION_CHARS));
  if (source.length <= width) return [source];
  const sections = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source.length - cursor <= width) {
      sections.push(source.slice(cursor));
      break;
    }
    const target = cursor + width;
    const minimum = cursor + Math.floor(width * 0.55);
    let cut = source.lastIndexOf("\n\n", target);
    if (cut >= minimum) cut += 2;
    else {
      cut = source.lastIndexOf("\n", target);
      if (cut >= minimum) cut += 1;
      else {
        cut = source.lastIndexOf(" ", target);
        if (cut >= minimum) cut += 1;
        else cut = target;
      }
    }
    sections.push(source.slice(cursor, cut));
    cursor = cut;
  }
  return sections;
}

function httpUrl(value, base = "") {
  const candidate = String(value || "").trim().replace(/^<|>$/g, "").replace(/&amp;/g, "&");
  if (!candidate || /^data:/i.test(candidate)) return "";
  try {
    const parsed = base ? new URL(candidate, base) : new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function sectionHeading(section) {
  return section.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim().replace(/\s+#+$/, "") || "";
}

function looksLikeHtmlGibberish(section) {
  if (section.length < 240) return false;
  const markupCount = section.match(/[\\/><^]/g)?.length ?? 0;
  if (markupCount < 64) return false;
  const ratio = markupCount / section.length;
  const noisyRuns = section.match(/(?:[\\/><^][\s]*){6,}/g)?.length ?? 0;
  const tagCount = section.match(/<\/?[A-Za-z][^>]*>/g)?.length ?? 0;
  return ratio >= 0.16 || noisyRuns >= 3 || (tagCount >= 24 && ratio >= 0.08);
}

export function resourceSectionTags(value) {
  const section = text(value);
  const tags = [];
  if (looksLikeHtmlGibberish(section)) tags.push("html_gibberish");
  if (/(?:^|\n)[ \t]*(?:```|~~~)|<pre\b|<code\b/i.test(section)) tags.push("code");
  if (/(?:^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m.test(section) || /<table\b/i.test(section)) tags.push("table");
  return [...new Set(tags)].slice(0, 2);
}

function addImage(images, seen, candidate, alt, sourceUrl, baseUrl) {
  const url = httpUrl(candidate, baseUrl || sourceUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  images.push({ url, alt: String(alt || "").trim().slice(0, 240), sourceUrl: httpUrl(sourceUrl) });
}

export function resourceSectionImages(value, options = {}) {
  const section = text(value);
  const images = [];
  const seen = new Set();
  let currentSource = httpUrl(options.sourceUrl);
  for (const line of section.split("\n")) {
    const standalone = line.trim();
    if (/^https?:\/\/\S+$/i.test(standalone) && !IMAGE_EXTENSION.test(standalone)) {
      currentSource = httpUrl(standalone) || currentSource;
    }

    for (const match of line.matchAll(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
      addImage(images, seen, match[2], match[1], currentSource, currentSource || options.sourceUrl);
    }
    for (const match of line.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)) {
      const tag = match[0];
      const alt = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      addImage(images, seen, match[1] || match[2] || match[3], alt?.[1] || alt?.[2] || alt?.[3], currentSource, currentSource || options.sourceUrl);
    }
    for (const match of line.matchAll(/https?:\/\/[^\s<>"'\])]+\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:\?[^\s<>"'\])]+)?/gi)) {
      addImage(images, seen, match[0], "", currentSource, currentSource || options.sourceUrl);
    }
  }
  return images;
}

export function analyzeResourceSections(sections, options = {}) {
  let sourceUrl = httpUrl(options.sourceUrl);
  return sections.map((section) => {
    const images = resourceSectionImages(section, { sourceUrl });
    const standaloneSources = section.split("\n")
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\/\S+$/i.test(line) && !IMAGE_EXTENSION.test(line))
      .map((line) => httpUrl(line))
      .filter(Boolean);
    if (standaloneSources.length) sourceUrl = standaloneSources.at(-1);
    return {
      heading: sectionHeading(section),
      tags: resourceSectionTags(section),
      images,
      sourceUrl: images.find((image) => image.sourceUrl)?.sourceUrl || sourceUrl,
    };
  });
}

export function resourceSectionMeta(resource, index) {
  const stored = resource?.sectionMeta?.[index];
  if (stored && typeof stored === "object") return stored;
  return analyzeResourceSections([resource?.sections?.[index] || ""], { sourceUrl: resource?.sourceUrl })[0];
}

export function resourceSectionImage(resource, index, value) {
  const requestedUrl = httpUrl(value);
  if (!requestedUrl) return null;
  return resourceSectionMeta(resource, index).images.find((image) => image.url === requestedUrl) ?? null;
}

export function resourceSectionAnchor(resourceId, index) {
  const safeId = String(resourceId || "resource").replace(/[^A-Za-z0-9_-]+/g, "-");
  return `resource-${safeId}-section-${index + 1}`;
}

export function resourceSectionText(resource, index) {
  const meta = resourceSectionMeta(resource, index);
  const preamble = [`# ${resource.name} · section ${index + 1}/${resource.sections.length}`];
  if (meta.heading) preamble.push(`Subsection: ${meta.heading}`);
  if (meta.tags.length) preamble.push(`Tags: ${meta.tags.join(", ")}`);
  if (meta.images.length) {
    preamble.push("Images available through view_image:");
    for (const image of meta.images) preamble.push(`- ${image.url}${image.alt ? ` — ${image.alt}` : ""}`);
  }
  return `${preamble.join("\n")}\n\n${resource.sections[index]}`;
}

export function markResourceSectionRead(resource, index) {
  const section = Math.trunc(Number(index));
  const read = new Set(Array.isArray(resource.readSections) ? resource.readSections : []);
  read.add(section);
  resource.readSections = [...read].filter((item) => item >= 0 && item < resource.sections.length).sort((a, b) => a - b);
}

function searchableText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase();
}

function searchWords(value) {
  return searchableText(value).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
}

function resourceSearchIndex(resource) {
  const signature = `${resource.sections.length}:${resource.content.length}`;
  const cached = resourceSearchIndexes.get(resource);
  if (cached?.signature === signature) return cached;
  const sections = resource.sections.map(searchableText);
  const words = new Map();
  sections.forEach((section, sectionIndex) => {
    for (const word of new Set(searchWords(section))) {
      if (!words.has(word)) words.set(word, new Set());
      words.get(word).add(sectionIndex);
    }
  });
  const indexed = { signature, sections, words };
  resourceSearchIndexes.set(resource, indexed);
  return indexed;
}

function searchExcerpt(section, query) {
  const flattened = section.replace(/\s+/g, " ").trim();
  const position = searchableText(flattened).indexOf(searchableText(query));
  const start = Math.max(0, (position < 0 ? 0 : position) - 90);
  const excerpt = flattened.slice(start, start + 260);
  return `${start ? "…" : ""}${excerpt}${start + 260 < flattened.length ? "…" : ""}`;
}

export function searchResourceSections(resource, queryValue) {
  const query = String(queryValue || "").trim();
  if (!query) throw new Error("resource_search requires a non-empty query.");
  const indexed = resourceSearchIndex(resource);
  const normalizedQuery = searchableText(query);
  const queryWords = [...new Set(searchWords(query))];
  let candidates = null;
  for (const word of queryWords) {
    const matches = indexed.words.get(word) ?? new Set();
    candidates = candidates == null ? new Set(matches) : new Set([...candidates].filter((index) => matches.has(index)));
  }
  const pool = candidates == null ? indexed.sections.map((_, index) => index) : [...candidates];
  const phraseMatches = pool.filter((index) => indexed.sections[index].includes(normalizedQuery));
  const matches = phraseMatches.length ? phraseMatches : queryWords.length ? pool : [];
  return matches.map((index) => ({
    section: index + 1,
    anchor: resourceSectionAnchor(resource.id, index),
    heading: resourceSectionMeta(resource, index).heading,
    tags: resourceSectionMeta(resource, index).tags,
    excerpt: searchExcerpt(resource.sections[index], query),
  }));
}

export function resourceSearchMarkdown(resource, query) {
  const matches = searchResourceSections(resource, query);
  if (!matches.length) return `No sections in ${resource.name} contain ${JSON.stringify(String(query))}.`;
  const lines = [`# Search: ${resource.name}`, "", `Query: ${JSON.stringify(String(query))}`, ""];
  for (const match of matches) {
    const label = `Section ${match.section}${match.heading ? ` — ${match.heading}` : ""}`;
    const tags = match.tags.length ? ` · ${match.tags.join(", ")}` : "";
    lines.push(`- [${label}](#${match.anchor})${tags}`, `  ${match.excerpt}`);
  }
  return lines.join("\n");
}

export function createContextResource(value, additions = {}) {
  const content = text(value);
  const sections = segmentMarkdown(content, additions.maxChars);
  const sourceUrl = httpUrl(additions.sourceUrl);
  return {
    id: additions.id || messageId("resource"),
    kind: additions.kind || "document",
    name: additions.name || "Browser tool result",
    sourceTool: additions.sourceTool || "",
    sourceUrl,
    content,
    sections,
    sectionMeta: analyzeResourceSections(sections, { sourceUrl }),
    readSections: [],
    createdAt: additions.createdAt || new Date().toISOString(),
  };
}

export function resourceIndex(resource, options = {}) {
  const includeFirst = options.includeFirst !== false;
  const headings = resource.sections.map((section, index) => {
    const meta = resourceSectionMeta(resource, index);
    const tags = meta.tags.length ? ` · tags: ${meta.tags.join(", ")}` : "";
    const images = meta.images.length ? ` · ${meta.images.length} image${meta.images.length === 1 ? "" : "s"}` : "";
    return `${index + 1}. section ${index + 1}${meta.heading ? ` — ${meta.heading}` : ""} (${section.length.toLocaleString()} characters${tags}${images})`;
  });
  const imageCount = resource.sections.reduce((total, _section, index) => total + resourceSectionMeta(resource, index).images.length, 0);
  const lines = [
    `# Indexed browser result: ${resource.name}`,
    "",
    `Resource id: \`${resource.id}\``,
    `${resource.sections.length} ordered section${resource.sections.length === 1 ? "" : "s"}; use \`context_read\` with this resource id and a one-based section number to open any section exactly.`,
    "",
    ...headings,
  ];
  if (imageCount) lines.push("", `${imageCount} scraped image${imageCount === 1 ? " is" : "s are"} available through \`view_image\`; pass the listed resource id, section number, and exact image URL after reviewing its source.`);
  if (includeFirst && resource.sections[0]) {
    const firstMeta = resourceSectionMeta(resource, 0);
    lines.push("", "## Open section 1", "");
    if (firstMeta.images.length) {
      lines.push("Images in section 1:", ...firstMeta.images.map((image) => `- ${image.url}${image.alt ? ` — ${image.alt}` : ""}`), "");
    }
    lines.push(resource.sections[0]);
  }
  return lines.join("\n");
}

export function compactionEnvelope(compaction, messages) {
  if (!compaction?.active || !Array.isArray(compaction.messageIds) || !compaction.messageIds.length) return "";
  const selected = new Set(compaction.messageIds);
  const ordered = messages.filter((message) => selected.has(message.id));
  const list = ordered.map((message, index) => {
    const label = message.role === "tool" ? `${message.role}:${message.name || "result"}` : message.role;
    const preview = (message.content || message.reasoning || "(empty)").replace(/\s+/g, " ").slice(0, 120);
    return `${index + 1}. \`${message.id}\` · ${label} · ${preview}${preview.length >= 120 ? "…" : ""}`;
  });
  const searchTerms = Array.isArray(compaction.searchTerms) && compaction.searchTerms.length
    ? compaction.searchTerms
    : compactionSearchTerms(messages, compaction.messageIds);
  return [
    `<compacted_context id=${JSON.stringify(compaction.id)} mode=${JSON.stringify(compaction.mode)}>`,
    compaction.summary || "Selected context was collapsed without a generated summary.",
    "",
    "Collapsed originals remain available in exact form. Call context_read with kind=message or kind=reasoning and the listed id:",
    ...list,
    ...(searchTerms.length ? ["", `Searchable values: ${searchTerms.map((term) => `\`${term}\``).join(", ")}`] : []),
    "</compacted_context>",
  ].join("\n");
}

export function compactionEnvelopes(compactions, messages) {
  return (compactions ?? []).filter((item) => item?.active)
    .map((item) => compactionEnvelope(item, messages))
    .filter(Boolean)
    .join("\n\n");
}

export function compactionSearchTerms(messages, messageIds, limit = 96) {
  const selected = new Set(messageIds ?? []);
  const counts = new Map();
  for (const message of messages ?? []) {
    if (!selected.has(message.id)) continue;
    const source = [message.name, message.content, message.reasoning]
      .filter((value) => typeof value === "string" && value)
      .join("\n");
    for (const token of source.match(/[\p{L}\p{N}_./:@#-]{3,}/gu) ?? []) {
      const normalized = token.toLocaleLowerCase();
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, Math.trunc(Number(limit) || 96)))
    .map(([term]) => term);
}

export function timelineMarkdown(session) {
  const selected = new Set((session.compactions ?? []).filter((item) => item.active).flatMap((item) => item.messageIds ?? []));
  const lines = ["# Conversation timeline", ""];
  for (const [index, message] of (session.messages ?? []).entries()) {
    const label = message.role === "tool" ? `${message.role}:${message.name || "result"}` : message.role;
    const state = message.state && message.state !== "complete" ? ` · ${message.state}` : "";
    const compacted = selected.has(message.id) ? " · compacted" : "";
    lines.push(`${index + 1}. \`${message.id}\` · ${label}${state}${compacted} · ${estimateTokens(message.content || message.reasoning)} estimated tokens`);
  }
  return lines.join("\n");
}
