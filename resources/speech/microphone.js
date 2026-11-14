import { Resampler, AudioSegments } from "./media.js";
export class Microphone {
  constructor({
    context,
    onWave = () => {},
    onResult = () => {},
    onError = () => {},
    onEnd = () => {},
  } = {}) {
    this.context = context;
    this.onWave = onWave;
    this.onResult = onResult;
    this.onError = onError;
    this.onEnd = onEnd;
    this.queue = Promise.resolve();
    this.buffered = 0;
    this.closed = false;
  }
  async start(engine, { stream = false } = {}) {
    this.engine = engine;
    this.streaming = stream;
    this.segments = new AudioSegments(6);
    this.context ||= new AudioContext();
    await this.context.resume();
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (this.closed) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      this.media = media;
      await this.context.audioWorklet.addModule(
        new URL("./capture-worklet.js", import.meta.url),
      );
      if (this.closed) return;
      this.resampler = new Resampler(this.context.sampleRate);
      this.source = this.context.createMediaStreamSource(media);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.node = new AudioWorkletNode(this.context, "speech-capture");
      this.mute = this.context.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.analyser);
      this.source.connect(this.node);
      this.node.connect(this.mute);
      this.mute.connect(this.context.destination);
      this.node.port.onmessage = ({ data }) => {
        if (data.stopped) {
          this.flushed?.();
          return;
        }
        if (this.closed) return;
        const pcm = this.resampler.push(data);
        for (const part of stream ? [pcm] : this.segments.push(pcm))
          this.enqueue(part);
        if (this.buffered > 60 && !this.stopping) {
          this.onError(
            Error(
              "Transcription is falling behind. Recording stopped; captured audio is still being processed.",
            ),
          );
          void this.stop().catch(() => {});
        }
      };
      const wave = new Float32Array(512),
        draw = () => {
          if (this.closed || this.stopping) return;
          this.analyser.getFloatTimeDomainData(wave);
          this.onWave(wave);
          this.animation = requestAnimationFrame(draw);
        };
      draw();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  enqueue(pcm) {
    if (!pcm.length) return;
    const seconds = pcm.length / 16000;
    this.buffered += seconds;
    this.queue = this.queue
      .then(async () => {
        if (this.closed) return;
        try {
          const result = await this.engine.call(
            "transcribe",
            { pcm, stream: this.streaming },
            [pcm.buffer],
          );
          this.onResult(result);
        } finally {
          this.buffered -= seconds;
        }
      })
      .catch((error) => {
        if (!this.closed) {
          this.cancel();
          this.onError(error);
        }
      });
  }
  async stop() {
    if (this.stopping) return this.finished;
    this.stopping = true;
    this.finished = (async () => {
      try {
        cancelAnimationFrame(this.animation);
        if (this.node) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1000);
            this.flushed = () => {
              clearTimeout(timer);
              resolve();
            };
            this.node.port.postMessage("stop");
          });
        }
        if (this.closed) return;
        const tail =
          this.resampler?.push(new Float32Array(), true) || new Float32Array();
        for (const pcm of this.streaming
          ? [tail]
          : this.segments.push(tail, true))
          this.enqueue(pcm);
        this.releaseAudio();
        await this.queue;
        if (this.streaming && !this.closed)
          this.onResult(await this.engine.call("finish"));
        this.closed = true;
      } catch (error) {
        this.cancel();
        this.onError(error);
        throw error;
      } finally {
        this.releaseAudio();
        this.notifyEnd();
      }
    })();
    return this.finished;
  }
  notifyEnd() {
    if (!this.ended) {
      this.ended = true;
      this.onEnd();
    }
  }
  releaseAudio() {
    this.media?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.mute?.disconnect();
    if (this.context?.state !== "closed") void this.context?.close();
    cancelAnimationFrame(this.animation);
  }
  cancel() {
    this.closed = true;
    this.flushed?.();
    this.releaseAudio();
    this.notifyEnd();
  }
}
export function paintWave(canvas, data, color = "#83d6ba") {
  const ctx = canvas.getContext("2d"),
    dpr = devicePixelRatio || 1,
    w = canvas.clientWidth * dpr,
    h = canvas.clientHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w,
      y = h / 2 - data[i] * h * 0.43;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
}
