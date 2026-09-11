/** Marp Live Subtitles — 共有型定義 (spec §9/§22/§30/§31, spec2 §20/§34) */

export type SubtitleMode = "translation" | "both" | "original";

/** spec2 §20 */
export type SubtitleStatus = "partial" | "stable" | "final";

/** spec §31 / spec2 §34 */
export type AppState =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "CONNECTING"
  | "LISTENING"
  | "TRANSLATING"
  | "ERROR"
  | "RECONNECTING"
  | "STOPPING";

/** spec §9 */
export type MarpDetection = {
  detected: boolean;
  slideCount: number;
};

/** spec §22 */
export type SlideContext = {
  index: number;
  title?: string;
  text: string;
  codeBlocks: string[];
};

/** spec2 §27-§29 — Provider とは疎結合に保つ発表コンテキスト */
export type PresentationContext = {
  slide?: SlideContext;
  /** デッキ全体から拾った固有名詞・技術用語 */
  keywords: string[];
  /** 全スライドの見出し。発表の流れを先に渡すための粗い要約 */
  outline?: string[];
};

/** spec2 §30 */
export type TranslationProviderId = "gemini-live-translation" | "webspeech-gemini-text";

/** spec §27 / spec2 §31-§33 */
export type Settings = {
  sourceLang: string;
  targetLang: string;
  micDeviceId: string;

  fontSize: number;
  position: "bottom" | "top";
  opacity: number;
  width: number;
  maxLines: number;
  mode: SubtitleMode;
  /** 更新が途切れてから字幕を消すまでの間 (spec2 §24) */
  holdMs: number;

  provider: TranslationProviderId;
  model: string;
  /** spec2 §5 — 翻訳音声で原文言語をエコーするか */
  echoTargetLanguage: boolean;
  /** spec2 §26 — MVP では常に false */
  enableTranslatedAudio: boolean;

  debug: boolean;
  showLatency: boolean;
  logProviderEvents: boolean;
};

/** spec §36 / spec2 §36 */
export type DebugLog = {
  timestamp: number;
  slide: number;
  transcript: string;
  translation: string;
  firstSubtitleLatencyMs: number;
  finalOutputLatencyMs: number;
};
