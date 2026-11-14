/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(sampleRate);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = () => {
      if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset));
      this.offset = 0;
      this.stopped = true;
      this.port.postMessage({ stopped: true });
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (channels?.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let value = 0;
        for (const channel of channels) value += channel[i] / channels.length;
        this.buffer[this.offset++] = value;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(sampleRate);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("speech-capture", Capture);
