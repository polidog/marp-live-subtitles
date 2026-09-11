/**
 * spec §16 / spec2 §7, §41 — Start / Stop のライフサイクル。
 *
 * マイク → Provider → Committer までを 1 本にまとめたもの。外への通知は events 経由なので
 * chrome.runtime には依存しない。offscreen document（拡張）と embed/（ページ埋め込み）が
 * これを共有する。
 */
import type { AppState, PresentationContext, Settings } from "../../types";
import { startAudioCapture, type AudioCapture } from "../audio/capture";
import { extensionId, isExtensionAlive } from "../extension";
import { resetTrace, trace, traceFail, traceOnce } from "../trace";
import { TranslationCommitter, type CommitterOutput } from "./committer";
import { formatError, micError, translationError } from "./gemini/errors";
import { createTranslationProvider, type TranslationProvider } from "./provider";
import {
  isTranslationError,
  type TranscriptEvent,
  type TranslationError,
  type TranslationStatus,
} from "./types";

/** spec2 §11 の connection lifecycle を popup 表示用の状態へ落とす (spec2 §34) */
const APP_STATE: Record<TranslationStatus, AppState> = {
  DISCONNECTED: "IDLE",
  CONNECTING: "CONNECTING",
  CONFIGURING: "CONNECTING",
  READY: "LISTENING",
  STREAMING: "LISTENING",
  RECONNECTING: "RECONNECTING",
};

export type PipelineConfig = {
  settings: Settings;
  apiKey: string;
  context?: PresentationContext;
};

export type PipelineEvents = {
  /** spec2 §19-§20 — Subtitle State Layer を通った字幕。slideIndex は Debug ログ用 */
  onSubtitle: (out: CommitterOutput, slideIndex: number) => void;
  onState: (state: AppState, error?: TranslationError) => void;
  onProviderStatus?: (status: TranslationStatus) => void;
  /** settings.logProviderEvents が true のときだけ呼ばれる (spec2 §31) */
  onTranscript?: (direction: "input" | "output", event: TranscriptEvent) => void;
};

export class TranslationPipeline {
  private readonly events: PipelineEvents;

  private running = false;
  private provider: TranslationProvider | null = null;
  private capture: AudioCapture | null = null;
  private committer: TranslationCommitter | null = null;
  private context: PresentationContext | null = null;

  constructor(events: PipelineEvents) {
    this.events = events;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(config: PipelineConfig): Promise<void> {
    if (this.running) return;
    this.running = true;
    resetTrace();
    trace("Start 受信");
    this.events.onState("CONNECTING");

    try {
      await this.build(config);
      trace("パイプライン構築完了 — 発話待ち");
    } catch (e) {
      if (!this.running) return; // 接続中に Stop された。ユーザー操作なので ERROR にしない
      // Start 中の失敗は再試行しないので、recoverable でも ERROR として確定させる
      await this.fail({ ...toTranslationError(e), recoverable: false });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.teardown();
    this.events.onState("IDLE");
  }

  /** spec §24 / spec2 §27 — セッションは張り直さず context だけ差し替える */
  async updateContext(context: PresentationContext): Promise<void> {
    this.context = context;
    await this.provider?.updateContext?.(context);
  }

  private async build(config: PipelineConfig): Promise<void> {
    const settings = config.settings;
    const apiKey = config.apiKey;
    trace(
      "設定を受信 ok",
      `model: ${settings.model}, ${settings.sourceLang}→${settings.targetLang}, apiKey: ${apiKey.length}文字`,
    );
    if (!apiKey) {
      // 拡張なら ID を出す。権限も storage も拡張ごとなので、dev ビルドと本ビルドで
      // 別の場所に保存されている取り違えがここで分かる。
      throw translationError(
        "AUTH_FAILED",
        isExtensionAlive()
          ? `Gemini API Key が未設定です (extension: ${extensionId()})。この拡張 ID の Options で設定してください。`
          : "Gemini API Key が未設定です。script タグの data-api-key か localStorage の mls:apiKey に入れてください。",
      );
    }

    this.committer = new TranslationCommitter({
      emit: (out) => {
        traceOnce("first-subtitle", "最初の SUBTITLE を送出", out.text.slice(0, 40));
        this.events.onSubtitle(out, this.context?.slide?.index ?? -1);
      },
    });

    this.provider = await createTranslationProvider(settings.provider, apiKey);
    trace("Provider 作成 ok", settings.provider);

    this.provider.onInputTranscript((payload) => {
      this.committer?.handleInput(payload);
      if (settings.logProviderEvents) this.events.onTranscript?.("input", payload);
    });

    this.provider.onOutputTranscript((payload) => {
      this.committer?.handleOutput(payload);
      if (settings.logProviderEvents) this.events.onTranscript?.("output", payload);
    });

    this.provider.onStatus((status) => {
      this.events.onProviderStatus?.(status);
      this.events.onState(APP_STATE[status]);
    });

    this.provider.onError((error) => {
      if (!this.running) return; // Stop 中に出る close 由来のエラーは報告しない
      if (error.recoverable) {
        // Provider が自分で張り直す。文言は次の READY（error なしの STATUS）で消える。
        this.events.onState("RECONNECTING", error);
        return;
      }
      // 回復不能なら running を落として片付けないと、次の Start が
      // `if (this.running) return` で黙って捨てられる。
      void this.fail(error);
    });

    // spec2 §29 — setup に載せるので connect より先に渡す
    if (config.context) this.context = config.context;
    if (this.context) await this.provider.updateContext?.(this.context);

    await this.provider.connect({
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
    if (this.provider.ownsMicrophone) return;
    try {
      this.capture = await startAudioCapture(settings.micDeviceId, (pcm) =>
        this.provider?.pushAudio(pcm),
      );
    } catch (e) {
      throw isTranslationError(e) ? e : micError(e);
    }
  }

  /**
   * 回復不能な失敗。先に片付けてから ERROR を出す。
   * teardown() は provider.stop() 経由で STATUS IDLE を出すので、順序を逆にすると
   * その IDLE が ERROR の文言を消して「押してもすぐ終了する」ように見える。
   */
  private async fail(error: TranslationError): Promise<void> {
    this.running = false;
    await this.teardown().catch(() => {});
    traceFail("失敗", formatError(error));
    this.events.onState("ERROR", error);
  }

  private async teardown(): Promise<void> {
    this.capture?.stop();
    this.capture = null;
    await this.provider?.stop();
    this.provider = null;
    this.committer?.reset();
    this.committer = null;
  }
}

function toTranslationError(e: unknown): TranslationError {
  return isTranslationError(e)
    ? e
    : translationError("UNKNOWN", String((e as Error)?.message ?? e));
}
