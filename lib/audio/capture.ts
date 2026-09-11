/** spec2 §7, §9, §41 — マイク取得と AudioWorklet パイプライン */
import { AUDIO_CHUNK_SAMPLES, GEMINI_SAMPLE_RATE } from "../translation/gemini/config";
import { translationError } from "../translation/gemini/errors";
import { trace, traceOnce } from "../trace";

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
  // Permissions API の状態は参考値。"prompt" でもポリシーや別経路で許可済みのことが
  // あるので決め打ちで失敗させず、実際に試してから理由づけに使う。
  const permission = await micPermissionState();
  trace("マイク権限", `permission: ${permission} / extension: ${chrome.runtime.id}`);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    // offscreen document は権限プロンプトを出せないので、未許可なら Options へ誘導する
    if (permission !== "granted" && /NotAllowedError|SecurityError/i.test(name)) {
      throw translationError(
        "MIC_PERMISSION_DENIED",
        `マイクが未許可です (permission: ${permission} / ${name} / extension: ${chrome.runtime.id})。` +
          `この拡張 ID の Options で「マイクを許可する」を実行してください。` +
          `pnpm dev と pnpm build では拡張 ID が変わるため、許可はそれぞれ必要です。`,
      );
    }
    throw e;
  }
  trace(
    "getUserMedia ok",
    stream.getAudioTracks()[0]?.label || "(デバイス名なし)",
  );

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

  trace("AudioWorklet 起動 ok", `AudioContext ${ctx.sampleRate}Hz`);

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    traceOnce("first-chunk", "最初の音声チャンク", `${e.data.byteLength} bytes`);
    onChunk(e.data);
  };

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
