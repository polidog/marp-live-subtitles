/** spec §16 / spec2 §2, §7, §19, §34, §41 — Microphone と Translation Provider を担う Offscreen Document */
import { startAudioCapture, type AudioCapture } from "../../lib/audio/capture";
import { onMessage, send } from "../../lib/messaging/messages";
import { TranslationCommitter } from "../../lib/translation/committer";
import { micError, translationError } from "../../lib/translation/gemini/errors";
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

function reportError(error: TranslationError) {
  send("background", { type: "TRANSLATION_ERROR", error });
  send("background", {
    type: "STATUS",
    state: error.recoverable ? "RECONNECTING" : "ERROR",
    error: error.message,
  });
}

async function buildPipeline(config: {
  settings: Settings;
  apiKey: string;
}): Promise<void> {
  settings = config.settings;
  const apiKey = config.apiKey;
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

  provider.onError(reportError);

  await provider.connect({
    sourceLanguage: settings.sourceLang,
    targetLanguage: settings.targetLang,
    model: settings.model,
    inputTranscription: true,
    outputTranscription: true,
    echoTargetLanguage: settings.echoTargetLanguage,
    logEvents: settings.logProviderEvents,
  });

  if (context) await provider.updateContext?.(context);

  // spec2 §15 — setup 完了前のチャンクは Provider 側でバッファされる。
  // マイク由来の失敗だけを MIC_* として扱う（他の失敗まで「マイク未許可」と言わない）。
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

async function start(config: { settings: Settings; apiKey: string }): Promise<void> {
  if (running) return;
  running = true;
  send("background", { type: "STATUS", state: "CONNECTING" });

  try {
    await buildPipeline(config);
  } catch (e) {
    const error = isTranslationError(e)
      ? e
      : translationError("UNKNOWN", String((e as Error)?.message ?? e));
    reportError(error);
    running = false;
    await teardown();
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
      void start({ settings: msg.settings, apiKey: msg.apiKey });
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
