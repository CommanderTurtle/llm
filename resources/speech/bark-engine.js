import { ort, session, dispose } from "./ort.js";
import { asset, status } from "./assets.js";
import { JsPreprocessor } from "./mel.js";
const argmax = (a, start, end) => {
  let best = start;
  for (let i = start + 1; i < end; i++) if (a[i] > a[best]) best = i;
  return best - start;
};
export async function load(name) {
  const encoder = await session(await asset(name, "encoder.int8.onnx"));
  const decoder = await session(await asset(name, "decoder.int8.onnx"));
  const joiner = await session(await asset(name, "joiner.int8.onnx"));
  const tokens = [];
  for (const line of new TextDecoder()
    .decode(await asset(name, "tokens.txt"))
    .split("\n")) {
    const match = /^(.*)\s+(\d+)\s*$/.exec(line);
    if (match) tokens[Number(match[2])] = match[1];
  }
  const mel = new JsPreprocessor({ nMels: 128 });
  const predict = async (token, h, c) => {
    const feeds = {
      targets: new ort.Tensor("int32", Int32Array.of(token), [1, 1]),
      target_length: new ort.Tensor("int32", Int32Array.of(1), [1]),
      "states.1": h,
      "states.2": c,
    };
    try {
      return await decoder.run(feeds);
    } finally {
      feeds.targets.dispose();
      feeds.target_length.dispose();
    }
  };
  return {
    async transcribe({ pcm }) {
      const pad = name === "bark-clean" ? 0 : 4000,
        audio = new Float32Array(pcm.length + pad);
      audio.set(pcm, pad);
      const { features, length } = mel.process(audio);
      if (!length) return { text: "" };
      const frames = features.length / 128;
      const feeds = {
        audio_signal: new ort.Tensor("float32", features, [1, 128, frames]),
        length: new ort.Tensor("int64", BigInt64Array.of(BigInt(length)), [1]),
      };
      let encoded,
        prediction,
        h = new ort.Tensor("float32", new Float32Array(1280), [2, 1, 640]),
        c = new ort.Tensor("float32", new Float32Array(1280), [2, 1, 640]);
      const pieces = [];
      try {
        status("Transcribing · " + name);
        encoded = await encoder.run(feeds);
        const tensor = encoded.outputs,
          count = Number(encoded.encoded_lengths.data[0]),
          width = tensor.dims[2];
        prediction = await predict(8192, h, c);
        h.dispose();
        c.dispose();
        h = c = null;
        let frame = 0,
          stationary = 0;
        while (frame < count) {
          const data = new Float32Array(1024);
          for (let j = 0; j < 1024; j++)
            data[j] = tensor.data[j * width + frame];
          const enc = new ort.Tensor("float32", data, [1, 1024, 1]);
          let logits;
          try {
            logits = await joiner.run({
              encoder_outputs: enc,
              decoder_outputs: prediction.outputs,
            });
          } finally {
            enc.dispose();
          }
          const scores = logits.outputs.data,
            token = argmax(scores, 0, 8193),
            duration = argmax(scores, 8193, 8198);
          dispose(logits);
          if (token !== 8192) {
            pieces.push(tokens[token] || "");
            const next = await predict(
              token,
              prediction.states,
              prediction["states.2_out"],
            );
            dispose(prediction);
            prediction = next;
          }
          const advance = token === 8192 ? Math.max(1, duration) : duration;
          stationary = advance ? 0 : stationary + 1;
          if (stationary > 10)
            throw Error(
              "Bark decoder stopped advancing. Try a shorter audio segment.",
            );
          frame += advance;
        }
        return {
          text: pieces
            .join("")
            .replaceAll("▁", " ")
            .replaceAll("<unk>", "")
            .trim(),
          language: "en",
        };
      } finally {
        dispose(feeds);
        if (encoded) dispose(encoded);
        if (prediction) dispose(prediction);
        h?.dispose();
        c?.dispose();
      }
    },
  };
}
