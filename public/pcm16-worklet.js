/**
 * spec2 §8, §9, §10 — マイク音声を 16 kHz / PCM16 / mono の 100 ms チャンクにする AudioWorklet。
 *
 * リサンプリングを main thread ではなく worklet 内で行う。§9 の狙い（main thread の負荷低減 /
 * UI rendering からの分離 / latency 安定化）を満たすうえで、そのほうが素直なため。
 */
class Pcm16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions ?? {};
    this.chunkSamples = opts.chunkSamples ?? 1600;
    // AudioContext を 16 kHz で開ければ ratio は 1（実質パススルー）。
    // 端末都合で 44.1/48 kHz になった場合はここで間引く。
    this.ratio = sampleRate / (opts.targetSampleRate ?? 16000);
    this.buffer = new Float32Array(this.chunkSamples);
    this.filled = 0;
    this.cursor = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    let i = this.cursor;
    while (i < channel.length) {
      const index = Math.floor(i);
      const frac = i - index;
      const a = channel[index];
      const b = index + 1 < channel.length ? channel[index + 1] : a;
      this.buffer[this.filled++] = a + (b - a) * frac;

      if (this.filled === this.chunkSamples) this.emit();
      i += this.ratio;
    }
    // ponytail: ブロック境界の 1 サンプルぶんは補間せず持ち越す。音声認識では可聴差なし。
    this.cursor = i - channel.length;

    return true;
  }

  emit() {
    const pcm = new Int16Array(this.chunkSamples);
    for (let n = 0; n < this.chunkSamples; n++) {
      const s = Math.max(-1, Math.min(1, this.buffer[n]));
      pcm[n] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    this.filled = 0;
  }
}

registerProcessor("pcm16-processor", Pcm16Processor);
