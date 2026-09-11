/** spec2 §6, §15, §16 — Gemini Live API BidiGenerateContent のメッセージ組み立てと解釈 */
import type { TranslationConfig } from "../types";
import {
  GEMINI_SAMPLE_RATE,
  translationInstruction,
  type SetupStrategy,
} from "./config";

/** spec2 §15 — WebSocket OPEN 直後に送る setup message */
export function buildSetup(
  config: TranslationConfig,
  strategy: SetupStrategy = "translationConfig",
): unknown {
  return {
    setup: {
      model: config.model.startsWith("models/")
        ? config.model
        : `models/${config.model}`,

      // spec2 §6 — AUDIO のままで outputAudioTranscription から翻訳文を取る
      generationConfig: { responseModalities: ["AUDIO"] },

      ...(config.inputTranscription ? { inputAudioTranscription: {} } : {}),
      ...(config.outputTranscription ? { outputAudioTranscription: {} } : {}),

      ...(strategy === "translationConfig"
        ? {
            // spec2 §6。v1beta の BidiGenerateContent には無いフィールドなので、
            // サーバーに弾かれたら systemInstruction へ切り替える。
            translationConfig: {
              targetLanguageCode: config.targetLanguage,
              echoTargetLanguage: config.echoTargetLanguage,
            },
          }
        : {
            // spec2 §29 の代替戦略。通常の Live モデルに翻訳役を指示する。
            systemInstruction: {
              parts: [{ text: translationInstruction(config) }],
            },
          }),
      // sourceLanguage は Gemini 側で自動判定されるため送らない。
      // 設定値は Debug 表示と将来の Provider のために保持しておく (spec2 §5)。
    },
  };
}

/** サーバーが setup のフィールドを知らないときの close reason / error message */
export function unknownSetupField(message: string): string | null {
  const m = /Unknown name "([^"]+)" at 'setup'/.exec(message ?? "");
  return m ? m[1] : null;
}

export function buildAudioChunk(base64: string): unknown {
  return {
    realtimeInput: {
      audio: { data: base64, mimeType: `audio/pcm;rate=${GEMINI_SAMPLE_RATE}` },
    },
  };
}

export type GeminiServerEvent =
  | { kind: "setupComplete" }
  | { kind: "inputTranscription"; text: string }
  | { kind: "outputTranscription"; text: string }
  | { kind: "turnComplete" }
  | { kind: "interrupted" }
  | { kind: "goAway" }
  | { kind: "error"; message: string };

/** 1 メッセージに複数の意味が載るため配列で返す */
export function parseServerMessage(raw: unknown): GeminiServerEvent[] {
  const msg = raw as any;
  if (!msg || typeof msg !== "object") return [];

  const events: GeminiServerEvent[] = [];

  if (msg.setupComplete) events.push({ kind: "setupComplete" });
  if (msg.goAway) events.push({ kind: "goAway" });

  const error = msg.error ?? msg.serverContent?.error;
  if (error) {
    events.push({
      kind: "error",
      message: error.message ?? JSON.stringify(error).slice(0, 300),
    });
  }

  const content = msg.serverContent;
  if (content) {
    const input = content.inputTranscription?.text;
    if (input) events.push({ kind: "inputTranscription", text: input });

    const output = content.outputTranscription?.text;
    if (output) events.push({ kind: "outputTranscription", text: output });

    // responseModalities が TEXT のモデルでは翻訳が modelTurn の text で来る。
    // AUDIO のときは inlineData だけなのでここは空になる。
    const parts: Array<{ text?: string }> = content.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.text) events.push({ kind: "outputTranscription", text: part.text });
    }

    if (content.interrupted) events.push({ kind: "interrupted" });
    // generationComplete と turnComplete の両方が来ることがある。
    // Provider 側で二重確定しないよう空文字なら無視する。
    if (content.turnComplete || content.generationComplete) {
      events.push({ kind: "turnComplete" });
    }
  }

  return events;
}
