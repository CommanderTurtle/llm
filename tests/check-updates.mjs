// Explicit maintenance command; never invoked by the app or the unit suite.
import { readFile, access } from "node:fs/promises";

export async function checkUpdates(entries, { fetchMetadata = fetch, root = new URL("../", import.meta.url) } = {}) {
  const results = [];
  for (const entry of entries) {
    const row = { package: entry.package, current: entry.version ?? "unrecorded", latest: null, status: "unknown" };
    try {
      await access(new URL(entry.file, root));
      const response = await fetchMetadata(`https://registry.npmjs.org/${encodeURIComponent(entry.package)}/latest`, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
      const metadata = await response.json();
      if (metadata.name !== entry.package || typeof metadata.version !== "string") throw new Error("Invalid registry metadata");
      row.latest = metadata.version;
      // Report differences, not compatibility: a newer major may need integration work.
      row.status = !entry.version ? "record installed version" : entry.version === metadata.version ? "current" : "review version difference";
    } catch (error) {
      row.status = "check failed";
      row.error = String(error.message ?? error);
    }
    results.push(row);
  }
  return results;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--json")) throw new Error("Usage: bun tests/check-updates.mjs [--json]");
  const entries = JSON.parse(await readFile(new URL("upstream.json", import.meta.url), "utf8"));
  const results = await checkUpdates(entries);
  if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
  else {
    console.table(results);
    console.log("Read-only registry check. No package downloads, installs, or replacements; unrecorded versions need manual identification.");
  }
  if (results.some(row => row.status === "check failed")) process.exitCode = 1;
}
