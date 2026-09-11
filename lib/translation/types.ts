/** spec2 §5, §11, §16, §38 — Translation Provider 共通型 */

/** spec2 §5 */
export type TranslationConfig = {
  sourceLanguage?: string;
  targetLanguage: string;
  model: string;

  inputTranscription: boolean;
  outputTranscription: boolean;

  echoTargetLanguage: boolean;

  /** spec2 §31 Log Gemini events — 生の送受信を offscreen のコンソールへ出す */
  logEvents?: boolean;
};

/** spec2 §16。latencyMs は Provider が算出する First Subtitle Latency (spec2 §36) */
export type TranscriptEvent = {
  text: string;
  final: boolean;
  timestamp: number;
  latencyMs?: number;
};

/** spec2 §11 — connection lifecycle */
export type TranslationStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONFIGURING"
  | "READY"
  | "STREAMING"
  | "RECONNECTING";

/** spec2 §38 */
export type TranslationErrorCode =
  | "MIC_PERMISSION_DENIED"
  | "MIC_UNAVAILABLE"
  | "AUTH_FAILED"
  | "TOKEN_EXPIRED"
  | "WEBSOCKET_FAILED"
  | "SESSION_FAILED"
  | "AUDIO_ENCODING_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "UNKNOWN";

export type TranslationError = {
  code: TranslationErrorCode;
  message: string;
  /** 再接続で回復しうるか (spec2 §39) */
  recoverable: boolean;
};

export function isTranslationError(e: unknown): e is TranslationError {
  // DOMException は prototype に code / message を持つため "in" では判別できない。
  // code が文字列であること（DOMException.code は数値）と recoverable の有無で見る。
  if (typeof e !== "object" || e === null) return false;
  const candidate = e as Partial<TranslationError>;
  return typeof candidate.code === "string" && typeof candidate.recoverable === "boolean";
}

const LANG_NAME: Record<string, string> = {
  ja: "Japanese",
  en: "English",
  ko: "Korean",
  zh: "Chinese",
  fr: "French",
  de: "German",
  es: "Spanish",
};

/** spec2 §5 — BCP-47 language code */
export const LANGUAGES = Object.keys(LANG_NAME);

export function languageName(code: string): string {
  return LANG_NAME[code] ?? code;
}
