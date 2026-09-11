/** spec §16 / spec2 §2, §7, §19, §34, §41 — Microphone と Translation Provider を担う Offscreen Document */
import { startAudioCapture, type AudioCapture } from "../../lib/audio/capture";
import { onMessage, send } from "../../lib/messaging/messages";
import { resetTrace, trace, traceFail, traceOnce } from "../../lib/trace";
import { TranslationCommitter } from "../../lib/translation/committer";
import { formatError, micError, translationError } from "../../lib/translation/gemini/errors";
import {
  createTranslationProvider,
  type TranslationProvider,
} from "../../lib/translation/provider";
import {
  isTranslationError,
  type TranslationError,
  type TranslationStatus,
} from "../../lib/translation/types";
import type { AppState, PresentationContext, Settings } from "../../types";

let running = false;
let provider: TranslationProvider | null = null;
let capture: AudioCapture | null = null;
let committer: TranslationCommitter | null = null;
let settings: Settings | null = null;
let context: PresentationContext | null = null;

/** spec2 §11 の connection lifecycle を popup 表示用の状態へ落とす (spec2 §34) */
const APP_STATE: Record<TranslationStatus, AppState> = {
  DISCONNECTED: "IDLE",
  CONNECTING: "CONNECTING",
  CONFIGURING: "CONNECTING",
  READY: "LISTENING",
  STREAMING: "LISTENING",
  RECONNECTING: "RECONNECTING",
};

function statusWithError(state: AppState, error: TranslationError) {
  send("background", { type: "TRANSLATION_ERROR", error });
  send("background", {
    type: "STATUS",
    state,
    error: formatError(error),
    code: error.code,
  });
}

/**
 * 回復不能な失敗。先に片付けてから ERROR を送る。
 * teardown() は provider.stop() 経由で STATUS IDLE を出すので、順序を逆にすると
 * その IDLE が ERROR の文言を消して「押してもすぐ終了する」ように見える。
 */
async function fail(error: TranslationError): Promise<void> {
  running = false;
  await teardown().catch(() => {});
  traceFail("失敗", formatError(error));
  statusWithError("ERROR", error);
}

function toTranslationError(e: unknown): TranslationError {
  return isTranslationError(e)
    ? e
    : translationError("UNKNOWN", String((e as Error)?.message ?? e));
}

async function buildPipeline(config: {
  settings: Settings;
  apiKey: string;
  context?: PresentationContext;
}): Promise<void> {
  settings = config.settings;
  const apiKey = config.apiKey;
  trace(
    "設定を受信 ok",
    `model: ${settings.model}, ${settings.sourceLang}→${settings.targetLang}, apiKey: ${apiKey.length}文字`,
  );
  if (!apiKey) {
    // 拡張 ID を出す。権限も storage も拡張ごとなので、dev ビルドと本ビルドで
    // 別の場所に保存されている取り違えがここで分かる。
    throw translationError(
      "AUTH_FAILED",
      `Gemini API Key が未設定です (extension: ${chrome.runtime.id})。この拡張 ID の Options で設定してください。`,
    );
  }

  committer = new TranslationCommitter({
    emit: (out) => {
      // spec2 §19-§20 — Subtitle State Layer を通してから描画側へ送る
      traceOnce("first-subtitle", "最初の SUBTITLE を送出", out.text.slice(0, 40));
      send("background", {
        type: "SUBTITLE",
        text: out.text,
        original: out.original,
        status: out.status,
        latencyMs: out.latencyMs,
      });

      if (settings?.debug && out.status === "final") {
        send("background", {
          type: "DEBUG_LOG",
          log: {
            timestamp: Date.now(),
            slide: context?.slide?.index ?? -1,
            transcript: out.original,
            translation: out.text,
            firstSubtitleLatencyMs: out.latencyMs ?? -1,
            finalOutputLatencyMs: out.latencyMs ?? -1,
          },
        });
      }
    },
  });

  provider = await createTranslationProvider(settings.provider, apiKey);
  trace("Provider 作成 ok", settings.provider);

  provider.onInputTranscript((payload) => {
    committer?.handleInput(payload);
    if (settings?.logProviderEvents) {
      send("background", { type: "TRANSLATION_INPUT", payload });
    }
  });

  provider.onOutputTranscript((payload) => {
    committer?.handleOutput(payload);
    if (settings?.logProviderEvents) {
      send("background", { type: "TRANSLATION_OUTPUT", payload });
    }
  });

  provider.onStatus((status) => {
    send("background", { type: "TRANSLATION_STATUS", status });
    send("background", { type: "STATUS", state: APP_STATE[status] });
  });

  provider.onError((error) => {
    if (!running) return; // Stop 中に出る close 由来のエラーは報告しない
    if (error.recoverable) {
      // Provider が自分で張り直す。文言は次の READY（error なしの STATUS）で消える。
      statusWithError("RECONNECTING", error);
      return;
    }
    // 回復不能なら running を落として片付けないと、次の Start が
    // `if (running) return` で黙って捨てられる。
    void fail(error);
  });

  // spec2 §29 — setup に載せるので connect より先に渡す
  if (config.context) context = config.context;
  if (context) await provider.updateContext?.(context);

  await provider.connect({
    sourceLanguage: settings.sourceLang,
    targetLanguage: settings.targetLang,
    model: settings.model,
    inputTranscription: true,
    outputTranscription: true,
    echoTargetLanguage: settings.echoTargetLanguage,
    logEvents: settings.logProviderEvents,
  });

  // spec2 §15 — setup 完了前のチャンクは Provider 側でバッファされる。
  // マイク由来の失敗だけを MIC_* として扱う（他の失敗まで「マイク未許可」と言わない）。
  if (provider.ownsMicrophone) return;
  try {
    capture = await startAudioCapture(settings.micDeviceId, (pcm) =>
      provider?.pushAudio(pcm),
    );
  } catch (e) {
    throw isTranslationError(e) ? e : micError(e);
  }
}

async function teardown(): Promise<void> {
  capture?.stop();
  capture = null;
  await provider?.stop();
  provider = null;
  committer?.reset();
  committer = null;
}

async function start(config: {
  settings: Settings;
  apiKey: string;
  context?: PresentationContext;
}): Promise<void> {
  if (running) return;
  running = true;
  resetTrace();
  trace("Start 受信");
  send("background", { type: "STATUS", state: "CONNECTING" });

  try {
    await buildPipeline(config);
    trace("パイプライン構築完了 — 発話待ち");
  } catch (e) {
    if (!running) return; // 接続中に Stop された。ユーザー操作なので ERROR にしない
    // Start 中の失敗は再試行しないので、recoverable でも ERROR として確定させる
    await fail({ ...toTranslationError(e), recoverable: false });
  }
}

async function stop(): Promise<void> {
  running = false;
  await teardown();
  send("background", { type: "STATUS", state: "IDLE" });
}

onMessage("offscreen", (msg) => {
  switch (msg.type) {
    case "OFFSCREEN_START":
      void start({ settings: msg.settings, apiKey: msg.apiKey, context: msg.context });
      break;
    case "STOP":
      void stop();
      break;
    case "PRESENTATION_CONTEXT":
      // spec §24 / spec2 §27 — セッションは張り直さず context だけ差し替える
      context = msg.context;
      void provider?.updateContext?.(context);
      break;
  }
});
