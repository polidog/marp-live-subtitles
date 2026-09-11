/** spec2 §7, §9, §41 — マイク取得と AudioWorklet パイプライン */
import { AUDIO_CHUNK_SAMPLES, GEMINI_SAMPLE_RATE } from "../translation/gemini/config";
import { translationError } from "../translation/gemini/errors";

const WORKLET_URL = "pcm16-worklet.js";

export const AUDIO_FORMAT_LABEL = `${GEMINI_SAMPLE_RATE / 1000}kHz PCM16 Mono`;

export type AudioCapture = {
  stream: MediaStream;
  stop: () => void;
};

/**
 * マイクを開き、16 kHz / PCM16 / mono の 100 ms チャンクを onChunk へ流す。
 * ScriptProcessorNode は使わない (spec2 §9)。
 */
export async function startAudioCapture(
  deviceId: string,
  onChunk: (pcm16: ArrayBuffer) => void,
): Promise<AudioCapture> {
  // offscreen document は権限プロンプトを出せない。未許可のまま getUserMedia すると
  // 素の NotAllowedError になって理由が分からないので、先に状態を確かめて言い切る。
  const permission = await micPermissionState();
  if (permission === "denied" || permission === "prompt") {
    throw translationError(
      "MIC_PERMISSION_DENIED",
      `マイクが未許可です (permission: ${permission} / extension: ${chrome.runtime.id})。` +
        `この拡張 ID の Options で「マイクを許可する」を実行してください。` +
        `pnpm dev と pnpm build では拡張 ID が変わるため、許可はそれぞれ必要です。`,
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // 16 kHz で開ければブラウザ側がリサンプルしてくれる。駄目でも worklet 側で間引く。
  const ctx = new AudioContext({ sampleRate: GEMINI_SAMPLE_RATE });
  await ctx.resume();
  await ctx.audioWorklet.addModule(chrome.runtime.getURL(WORKLET_URL));

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm16-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      targetSampleRate: GEMINI_SAMPLE_RATE,
      chunkSamples: AUDIO_CHUNK_SAMPLES,
    },
  });

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);

  // 出力を destination まで繋がないとノードが駆動されないため、無音 gain を経由させる
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(worklet);
  worklet.connect(silent);
  silent.connect(ctx.destination);

  return {
    stream,
    // spec2 §41 — Stop 時に MediaStream / AudioContext / AudioWorklet をすべて止める
    stop: () => {
      worklet.port.onmessage = null;
      source.disconnect();
      worklet.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

/** "granted" | "prompt" | "denied" | "unknown"（Permissions API が使えない場合） */
export async function micPermissionState(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

export async function hasMicPermission(): Promise<boolean> {
  return (await micPermissionState()) === "granted";
}

/** options ページ（タブ context）から一度だけ呼ぶ。offscreen ではプロンプトを出せない。 */
export async function requestMicPermission(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
