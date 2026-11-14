const base = new URL("./", import.meta.url);
export class SpeechEngine {
  constructor({ onStatus = () => {}, timeout = 600000 } = {}) {
    this.onStatus = onStatus;
    this.timeout = timeout;
    this.pending = new Map();
    this.next = 0;
  }
  async load(engine, options = {}) {
    this.close();
    this.worker = new Worker(new URL("engine-worker.js", base));
    this.worker.onmessage = ({ data }) => {
      if (data.status) this.onStatus(data.status, data.progress);
      if (data.id) {
        const job = this.pending.get(data.id);
        if (job) {
          clearTimeout(job.timer);
          this.pending.delete(data.id);
          if (data.error) job.reject(Error(data.error));
          else job.resolve(data.result);
        }
      }
    };
    this.worker.onerror = (event) =>
      this.close(Error(event.message || "Speech worker failed."));
    try {
      await this.call("load", { engine, options });
      return this;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  call(op, data = {}, transfer = []) {
    if (!this.worker) return Promise.reject(Error("Speech engine is closed."));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.close(Error("Speech operation timed out.")),
        this.timeout,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, op, ...data }, transfer);
    });
  }
  close(reason = new DOMException("Cancelled", "AbortError")) {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(reason);
    }
    this.pending.clear();
  }
}
export function speechSegments(text) {
  // Bound phonemizer expansion, without dropping the remainder of long text.
  const words = text.match(/\S+\s*/gu) || [];
  const segments = [];
  let part = "";
  for (const word of words) {
    if (part.length + word.length > 180 && part) {
      segments.push(part);
      part = "";
    }
    if (word.length > 180) {
      if (part) {
        segments.push(part);
        part = "";
      }
      for (let i = 0; i < word.length; i += 180)
        segments.push(word.slice(i, i + 180));
    } else part += word;
    if (/[.!?…。！？।॥]\s*$/u.test(part) && part.length > 60) {
      segments.push(part);
      part = "";
    }
  }
  if (part.trim()) segments.push(part);
  return segments;
}
export function wavBlob(chunks, sampleRate = 24000) {
  const count = chunks.reduce((n, c) => n + c.length, 0),
    header = new ArrayBuffer(44),
    v = new DataView(header);
  if (count * 2 > 0xffffffff - 36)
    throw Error("WAV exceeds its 4 GB format limit. Save shorter sections.");
  const tag = (p, s) =>
    [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + count * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, count * 2, true);
  return new Blob(
    [
      header,
      ...chunks.map((c) => {
        const b = new ArrayBuffer(c.length * 2),
          d = new DataView(b);
        for (let i = 0; i < c.length; i++)
          d.setInt16(
            i * 2,
            Math.max(-1, Math.min(1, c[i])) * (c[i] < 0 ? 32768 : 32767),
            true,
          );
        return b;
      }),
    ],
    { type: "audio/wav" },
  );
}
export async function clearDownloads() {
  const { clearModelCache } = await import("./assets.js");
  return clearModelCache();
}
