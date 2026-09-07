import assert from "node:assert/strict";
import test from "node:test";

import { outputAlphabetASCII } from "../src/lnkr/alphabets.js";
import { decompressText } from "../src/lnkr/text-compress.js";
import { markdownShareUrl } from "../src/share.js";

test("a.shel.sh sharing round-trips both small and deflate-sized Markdown", async () => {
  for (const markdown of ["# Small\n\nHello.", `# Large\n\n${"repeatable markdown words ".repeat(400)}`]) {
    const url = await markdownShareUrl(markdown);
    assert.match(url, /^https:\/\/a\.shel\.sh\/#m:/);
    const payload = url.slice(url.indexOf("#m:") + 3);
    assert.equal(decompressText(payload, outputAlphabetASCII).text, markdown);
  }
});
