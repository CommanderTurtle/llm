import { ort, session, dispose } from "./ort.js";
import { asset, jsonAsset, status } from "./assets.js";
import { toMisaki } from "./misaki.js";
const langs = {
  a: "en-us",
  b: "en-gb",
  e: "es",
  f: "fr-fr",
  h: "hi",
  i: "it",
  p: "pt-br",
};
const paradeeVoices = [
  "af_heart",
  "bf_isabella",
  "am_puck",
  "bm_fable",
  "hf_alpha",
  "hm_omega",
  "ff_siwis",
  "em_alex",
];
export async function load(name, options) {
  const voice = options.voice || "af_heart",
    language = langs[voice[0]];
  if (!options.phonemes && !language)
    throw Error(
      "This voice requires Misaki phoneme input. Choose phonemes or a text-supported language.",
    );
  if (name === "paradee" && !paradeeVoices.includes(voice))
    throw Error("Unknown Paradee voice.");
  const synth = await session(
    await asset(
      name,
      name === "paradee" ? "onnx/paradee_int8.onnx" : "onnx/model.onnx",
    ),
  );
  const vocab = (await jsonAsset(name, "tokenizer.json")).model.vocab;
  let style;
  if (name === "kokoro")
    style = new Float32Array((await asset(name, `voices/${voice}.bin`)).buffer);
  let espeak;
  if (!options.phonemes) {
    const { default: factory } = await import("./espeak-ng.js");
    const module = await factory();
    espeak = new module.eSpeakNGWorker();
    espeak.set_voice(language);
  }
  const phonemize = (text) => {
    if (options.phonemes) return text;
    // Keep punctuation outside eSpeak so sentence boundaries survive its trace.
    return text
      .split(/([;:,.!?—…।॥\n]+)/u)
      .map((part) => {
        if (/^[;:,.!?—…।॥\n]+$/u.test(part))
          return part.replace(/[।॥]/gu, ".").replaceAll("\n", " ");
        if (!part.trim()) return "";
        const result = espeak.synthesize_ipa(part);
        if (result.code) throw Error("Phonemization failed.");
        let ps = result.ipa
          .trim()
          .replaceAll("_", "")
          .replaceAll("͡", "")
          .replace(/\([^)]*\)/g, "");
        if (voice[0] === "a" || voice[0] === "b")
          return toMisaki(ps, voice[0] === "b");
        for (const [a, b] of [
          ["aɪ", "I"],
          ["aʊ", "W"],
          ["dʒ", "ʤ"],
          ["dz", "ʣ"],
          ["eɪ", "A"],
          ["oʊ", "O"],
          ["əʊ", "Q"],
          ["ts", "ʦ"],
          ["tʃ", "ʧ"],
          ["ɔɪ", "Y"],
        ])
          ps = ps.replaceAll(a, b);
        return ps.replaceAll("͡", "").replaceAll("-", "");
      })
      .join(" ");
  };
  return {
    async speak({ text }) {
      const phonemes = phonemize(text);
      const unknown = [
        ...new Set(
          [...phonemes].filter((c) => vocab[c] === undefined && !/\s/u.test(c)),
        ),
      ];
      if (unknown.length)
        throw Error(
          `Unsupported phonemes: ${unknown.join(" ")}. Edit the text or supply model phonemes.`,
        );
      const tokens = [...phonemes]
        .map((c) => vocab[c])
        .filter((t) => t !== undefined);
      if (tokens.length > 510)
        throw Error(
          "Speech segment exceeds 510 phonemes. Split this sentence into shorter phrases.",
        );
      if (!tokens.length) return { pcm: new Float32Array(), sampleRate: 24000 };
      const ids = BigInt64Array.from([0, ...tokens, 0], BigInt);
      const feeds = {
        input_ids: new ort.Tensor("int64", ids, [1, ids.length]),
        speed: new ort.Tensor("float32", Float32Array.of(options.speed || 1), [
          1,
        ]),
      };
      if (name === "paradee")
        feeds.voice = new ort.Tensor(
          "int64",
          BigInt64Array.of(BigInt(paradeeVoices.indexOf(voice))),
          [1],
        );
      else {
        const offset = Math.min(509, tokens.length) * 256;
        feeds.style = new ort.Tensor(
          "float32",
          style.slice(offset, offset + 256),
          [1, 256],
        );
      }
      let output;
      try {
        status("Speaking · " + name);
        output = await synth.run(feeds);
        const waveform = output.waveform || Object.values(output)[0];
        return { pcm: Float32Array.from(waveform.data), sampleRate: 24000 };
      } finally {
        dispose(feeds);
        if (output) dispose(output);
      }
    },
  };
}
