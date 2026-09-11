/** spec2 §3, §6, §8, §10, §11 — Gemini Live Translation の既定値 */
import { DEFAULT_TRANSLATION_MODEL } from "../provider";
import type { TranslationConfig } from "../types";

export const GEMINI_WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** spec2 §8 — PCM signed 16-bit LE / 16 kHz / mono */
export const GEMINI_SAMPLE_RATE = 16000;

/** spec2 §10 — 100 ms 相当 = 1600 samples = 3200 bytes */
export const AUDIO_CHUNK_SAMPLES = GEMINI_SAMPLE_RATE / 10;

/** spec2 §39 — 指数バックオフ 1, 2, 4, 8 sec（上限 10 sec） */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];
export const RECONNECT_MAX_MS = 10000;

/** setup 応答が来ないまま無音で音声を捨て続けないための上限 (spec2 §15) */
export const SETUP_TIMEOUT_MS = 10000;

/** setup 完了前の音声を捨てないための保持上限 (spec2 §15) */
export const PENDING_CHUNK_LIMIT = 20;

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  sourceLanguage: "ja",
  targetLanguage: "en",
  model: DEFAULT_TRANSLATION_MODEL,

  inputTranscription: true,
  outputTranscription: true,

  echoTargetLanguage: false,
};

export function endpointUrl(apiKey: string): string {
  return `${GEMINI_WS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
}
