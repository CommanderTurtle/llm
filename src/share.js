export async function markdownShareUrl(markdown) {
  const [{ compressTextV1, compressTextV4 }, { outputAlphabetASCII }] = await Promise.all([
    import("./lnkr/text-compress.js"),
    import("./lnkr/alphabets.js"),
  ]);
  const source = String(markdown);
  const encode = source.length > 4_096 ? compressTextV4 : compressTextV1;
  const encoded = encode(source, outputAlphabetASCII, "markdown");
  return `https://a.shel.sh/#m:${encoded.payload}`;
}
