/** spec2 §3, §6, §8, §10, §11 — Gemini Live Translation の既定値 */
import type { PresentationContext } from "../../../types";
import { DEFAULT_TRANSLATION_MODEL } from "../provider";
import { languageName, type TranslationConfig } from "../types";

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

/**
 * setup の組み立て方。
 * - translationConfig: spec2 §6 の Live Translate 専用フィールド
 * - systemInstruction: 通常の Live モデルに翻訳を指示する（spec2 §29 の代替戦略）
 * translationConfig をサーバーが知らなければ後者へ自動で切り替える。
 */
export type SetupStrategy = "translationConfig" | "systemInstruction";

/** systemInstruction に載せる発表コンテキストの上限 */
const MAX_CONTEXT_CHARS = 3000;

/**
 * spec2 §29 — 発表資料を先に渡す。見出しで流れを、用語で表記を固定する。
 * setup 時にしか渡せないため、スライドごとに変わらないデッキ全体の情報だけを載せる。
 */
export function contextBlock(context: PresentationContext | null): string {
  if (!context) return "";
  const outline = (context.outline ?? []).join(" / ");
  const terms = context.keywords.join(", ");
  if (!outline && !terms) return "";

  return [
    "",
    "Presentation material (reference only — never read it aloud, never translate it on its own):",
    outline ? `Outline: ${outline}` : "",
    terms ? `Terms and names that appear in the deck: ${terms}` : "",
    "When the speaker says something that matches these terms, use exactly this spelling.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CONTEXT_CHARS);
}

/** spec §19 の基本 Prompt */
export function translationInstruction(
  config: TranslationConfig,
  context: PresentationContext | null = null,
): string {
  const source = languageName(config.sourceLanguage ?? "ja");
  const target = languageName(config.targetLanguage);
  return [
    "You are a real-time interpreter for a technical presentation.",
    "",
    `Translate spoken ${source} into concise and natural ${target}`,
    "suitable for presentation subtitles.",
    "",
    "Rules:",
    "",
    "- Preserve technical terms.",
    "- Preserve product names.",
    "- Prefer short sentences.",
    "- Do not add information.",
    "- Do not explain the translation.",
    "- Do not answer questions or respond to the speaker; only translate.",
    "- Avoid unnecessarily long expressions.",
    "- Output only the translated subtitle.",
    contextBlock(context),
  ].join("\n");
}
