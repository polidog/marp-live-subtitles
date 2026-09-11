/**
 * Web Speech API（Chrome 内蔵・無料）で文字起こしし、確定した文だけを
 * Gemini のテキストモデルへ投げる二段構成の Provider。
 * Live API と違い音声トークンを一切払わないので料金は桁で下がる。
 * Chrome の isFinal は 1〜2 秒黙らないと出ないので、それを待たず interim も
 * 少し落ち着くたびに翻訳へ投げる。テキスト翻訳は安いので回数は気にしない。
 */
import type { PresentationContext } from "../../../types";
import { trace } from "../../trace";
import { translationInstruction } from "../gemini/config";
import { translationError } from "../gemini/errors";
import type { TranslationProvider } from "../provider";
import type {
  TranslationConfig,
  TranslationError,
  TranslationStatus,
  TranscriptEvent,
} from "../types";

/** interim がこの時間変わらなかったら翻訳に投げる */
const INTERIM_DEBOUNCE_MS = 400;

/** 今映っているスライド本文をプロンプトに載せる上限 */
const MAX_SLIDE_CHARS = 1500;

/** Live 用のモデル名が設定に残っていたときに使うテキストモデル */
export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";

const SPEECH_LANG: Record<string, string> = {
  ja: "ja-JP",
  en: "en-US",
  ko: "ko-KR",
  zh: "zh-CN",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
};

// lib.dom には webkit 接頭辞つきの SpeechRecognition 型が無いので必要な分だけ書く
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
};

function createRecognition(): Recognition {
  const g = globalThis as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!Ctor) {
    throw translationError("PROVIDER_ERROR", "この環境では Web Speech API が使えません");
  }
  return new Ctor();
}

export class WebSpeechTextTranslationProvider implements TranslationProvider {
  readonly ownsMicrophone = true;

  private readonly apiKey: string;
  private config: TranslationConfig | null = null;
  private context: PresentationContext | null = null;
  private recognition: Recognition | null = null;
  private stopped = false;
  private model = DEFAULT_TEXT_MODEL;
  // 翻訳は文の順に出したいので直列に流す
  private queue: Promise<void> = Promise.resolve();
  private interimTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInterim = "";
  // final を投げるたびに進める。古い interim の翻訳が final の後に出ないようにする
  private generation = 0;

  private onInputCb: (e: TranscriptEvent) => void = () => {};
  private onOutputCb: (e: TranscriptEvent) => void = () => {};
  private onStatusCb: (s: TranslationStatus) => void = () => {};
  private onErrorCb: (e: TranslationError) => void = () => {};

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(config: TranslationConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    this.model = /live|audio/i.test(config.model) ? DEFAULT_TEXT_MODEL : config.model;
    this.onStatusCb("CONNECTING");

    const rec = createRecognition();
    const source = config.sourceLanguage ?? "ja";
    rec.lang = SPEECH_LANG[source] ?? source;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      trace("Web Speech 開始", `lang: ${rec.lang}, 翻訳モデル: ${this.model}`);
      this.onStatusCb("READY");
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        const timestamp = Date.now();
        if (r.isFinal) {
          this.clearInterim();
          this.onInputCb({ text, final: true, timestamp });
          this.generation += 1;
          this.enqueue(text, timestamp, true, this.generation);
        } else {
          interim += text;
        }
      }
      if (!interim) return;
      this.onInputCb({ text: interim, final: false, timestamp: Date.now() });
      this.pendingInterim = interim;
      if (this.interimTimer) clearTimeout(this.interimTimer);
      this.interimTimer = setTimeout(() => {
        this.interimTimer = null;
        this.enqueue(interim, Date.now(), false, this.generation);
      }, INTERIM_DEBOUNCE_MS);
    };
    rec.onerror = (e) => {
      // no-speech / aborted は onend で勝手に再開するので報告しない
      if (e.error === "no-speech" || e.error === "aborted") return;
      const detail = `${e.error}${e.message ? `: ${e.message}` : ""}`;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.onErrorCb(
          translationError(
            "MIC_PERMISSION_DENIED",
            `マイクが許可されていません (${detail})。拡張 ${chrome.runtime.id} の Options で許可してください。`,
          ),
        );
      } else if (e.error === "audio-capture") {
        this.onErrorCb(translationError("MIC_UNAVAILABLE", `マイクを利用できません (${detail})`));
      } else {
        this.onErrorCb(translationError("PROVIDER_ERROR", `Web Speech: ${detail}`, true));
      }
    };
    rec.onend = () => {
      // Chrome は無音や一定時間で勝手に止めるので、Stop されるまで張り直す
      if (this.stopped) return this.onStatusCb("DISCONNECTED");
      try {
        rec.start();
      } catch (e) {
        this.onErrorCb(translationError("PROVIDER_ERROR", String(e), true));
      }
    };

    this.recognition = rec;
    rec.start();
  }

  /** マイクは SpeechRecognition が自分で開くので PCM は受け取らない */
  pushAudio(): void {}

  async updateContext(context: PresentationContext): Promise<void> {
    this.context = context;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearInterim();
    this.recognition?.abort();
    this.recognition = null;
    this.onStatusCb("DISCONNECTED");
  }

  onInputTranscript(cb: (e: TranscriptEvent) => void): void {
    this.onInputCb = cb;
  }
  onOutputTranscript(cb: (e: TranscriptEvent) => void): void {
    this.onOutputCb = cb;
  }
  onStatus(cb: (s: TranslationStatus) => void): void {
    this.onStatusCb = cb;
  }
  onError(cb: (e: TranslationError) => void): void {
    this.onErrorCb = cb;
  }

  private clearInterim(): void {
    if (this.interimTimer) clearTimeout(this.interimTimer);
    this.interimTimer = null;
    this.pendingInterim = "";
  }

  private enqueue(text: string, spokenAt: number, final: boolean, gen: number): void {
    this.queue = this.queue
      .then(async () => {
        if (this.stopped) return;
        // 順番待ちの間に final が来た、またはもっと新しい interim がある interim は捨てる
        if (!final && (gen !== this.generation || text !== this.pendingInterim)) return;
        const { source, translation } = await this.translate(text);
        if (this.stopped || !translation) return;
        if (!final && gen !== this.generation) return;
        // 誤認識を直した原文で日本語字幕も差し替える
        if (source) this.onInputCb({ text: source, final, timestamp: Date.now() });
        this.onOutputCb({
          text: translation,
          final,
          timestamp: Date.now(),
          latencyMs: Date.now() - spokenAt,
        });
      })
      .catch((e) => {
        if (this.stopped) return;
        this.onErrorCb(translationError("PROVIDER_ERROR", `翻訳に失敗: ${String((e as Error)?.message ?? e)}`, true));
      });
  }

  /**
   * Live の setup と違って毎回投げるので、いま映っているスライドの本文も載せる。
   * 音声認識の誤りをスライドの語で直してから訳させる。
   */
  private instruction(): string {
    const slide = this.context?.slide;
    const slideText = slide
      ? [slide.title, slide.text, ...slide.codeBlocks].filter(Boolean).join("\n").slice(0, MAX_SLIDE_CHARS)
      : "";
    return [
      translationInstruction(this.config!, this.context),
      "",
      "The input is raw speech-recognition output and may contain misrecognized words.",
      "First fix obvious recognition errors using the presentation material and the current slide,",
      "then translate the corrected text.",
      slideText ? `\nCurrent slide (reference only):\n${slideText}` : "",
      "",
      'Respond as JSON: {"source": corrected transcript in the source language, "translation": the subtitle}.',
    ].join("\n");
  }

  private async translate(text: string): Promise<{ source: string; translation: string }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: this.instruction() }] },
        contents: [{ role: "user", parts: [{ text }] }],
        // 3.5 flash-lite は既定で thinking が minimal。字幕は速さ優先なので上げない
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { source: { type: "STRING" }, translation: { type: "STRING" } },
            required: ["source", "translation"],
          },
        },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    const parts: Array<{ text?: string }> = json.candidates?.[0]?.content?.parts ?? [];
    const raw = parts.map((p) => p.text ?? "").join("").trim();
    try {
      const out = JSON.parse(raw) as { source?: string; translation?: string };
      return { source: (out.source ?? "").trim(), translation: (out.translation ?? "").trim() };
    } catch {
      // JSON で返ってこなかったら本文をそのまま訳として使う
      return { source: "", translation: raw };
    }
  }
}
