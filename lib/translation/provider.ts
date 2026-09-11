/** spec2 §4, §30 — Translation Provider abstraction */
import type { PresentationContext, TranslationProviderId } from "../../types";
import type {
  TranslationConfig,
  TranslationError,
  TranslationStatus,
  TranscriptEvent,
} from "./types";
import { WebSpeechTextTranslationProvider } from "./webspeech/provider";

export interface TranslationProvider {
  connect(config: TranslationConfig): Promise<void>;

  pushAudio(chunk: ArrayBuffer): void;

  updateContext?(context: PresentationContext): Promise<void>;

  stop(): Promise<void>;

  /** true なら Provider 自身がマイクを開くので offscreen は音声を取り込まない */
  readonly ownsMicrophone?: boolean;

  onInputTranscript(callback: (event: TranscriptEvent) => void): void;
  onOutputTranscript(callback: (event: TranscriptEvent) => void): void;
  onStatus(callback: (status: TranslationStatus) => void): void;
  onError(callback: (error: TranslationError) => void): void;
}

/** spec2 §3 — モデル名はハードコードせず設定値として持つ */
export const DEFAULT_TRANSLATION_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

/**
 * spec2 §30 — MVP では Gemini のみ。
 * 追加 Provider はここに 1 行足すだけで済むようにしておく。
 */
export async function createTranslationProvider(
  id: TranslationProviderId,
  apiKey: string,
): Promise<TranslationProvider> {
  switch (id) {
    case "gemini-live-translation": {
      const { GeminiLiveTranslationProvider } = await import("./gemini/provider");
      return new GeminiLiveTranslationProvider(apiKey);
    }
    case "webspeech-gemini-text":
      // background は IIFE 1 本なので動的 import で別チャンクにさせない
      return new WebSpeechTextTranslationProvider(apiKey);
  }
}
