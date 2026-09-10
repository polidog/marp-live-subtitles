/** spec2 §4, §11, §17-§18, §36, §39, §40 — Gemini Live Translation Provider */
import type { PresentationContext } from "../../../types";
import type { TranslationProvider } from "../provider";
import type {
  TranscriptEvent,
  TranslationConfig,
  TranslationError,
  TranslationStatus,
} from "../types";
import { pcm16ToBase64 } from "./audio";
import { GeminiLiveClient } from "./client";
import {
  endpointUrl,
  PENDING_CHUNK_LIMIT,
  RECONNECT_DELAYS_MS,
  RECONNECT_MAX_MS,
} from "./config";
import { classify } from "./errors";
import { buildAudioChunk, buildSetup, type GeminiServerEvent } from "./protocol";

export class GeminiLiveTranslationProvider implements TranslationProvider {
  private readonly apiKey: string;
  private client: GeminiLiveClient | null = null;
  private config: TranslationConfig | null = null;

  /** setup 完了までは音声を送らない (spec2 §15) */
  private ready = false;
  private pending: ArrayBuffer[] = [];

  private context: PresentationContext | null = null;

  private inputText = "";
  private outputText = "";
  /** 現ターン最初の音声チャンクを掴んだ時刻 (spec2 §36 audioCaptureTime) */
  private turnStartedAt: number | null = null;
  private firstOutputAt: number | null = null;

  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  private onInput: (e: TranscriptEvent) => void = () => {};
  private onOutput: (e: TranscriptEvent) => void = () => {};
  private onStatusCb: (s: TranslationStatus) => void = () => {};
  private onErrorCb: (e: TranslationError) => void = () => {};

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(config: TranslationConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    await this.open();
  }

  private async open(): Promise<void> {
    const config = this.config!;
    this.ready = false;
    this.onStatusCb("CONNECTING");

    const client = new GeminiLiveClient(endpointUrl(this.apiKey));
    this.client = client;

    client.onEvent((event) => this.handle(event));
    client.onClose((error) => {
      this.ready = false;
      if (error) this.onErrorCb(error);
      this.scheduleReconnect();
    });

    await client.connect();

    this.onStatusCb("CONFIGURING");
    client.send(buildSetup(config));
  }

  private handle(event: GeminiServerEvent): void {
    switch (event.kind) {
      case "setupComplete":
        this.ready = true;
        this.attempt = 0;
        this.onStatusCb("READY");
        this.flush();
        break;

      // spec2 §17 — 入力 transcript は Debug / latency 計測用
      case "inputTranscription":
        this.inputText += event.text;
        this.onInput({
          text: this.inputText,
          final: false,
          timestamp: Date.now(),
        });
        break;

      // spec2 §18 — これが字幕になる
      case "outputTranscription": {
        this.outputText += event.text;
        const now = Date.now();
        if (this.firstOutputAt == null) {
          this.firstOutputAt = now;
        }
        this.onOutput({
          text: this.outputText,
          final: false,
          timestamp: now,
          latencyMs:
            this.turnStartedAt != null ? this.firstOutputAt - this.turnStartedAt : undefined,
        });
        break;
      }

      case "turnComplete":
        this.finalizeTurn();
        break;

      case "interrupted":
        this.resetTurn();
        break;

      case "goAway":
        // spec2 §40 — セッション境界で張り直す。close イベントの再接続に委ねる。
        break;

      case "error": {
        const error = classify(event.message);
        this.onErrorCb(error);
        if (!error.recoverable) void this.stop();
        break;
      }
    }
  }

  private finalizeTurn(): void {
    const now = Date.now();
    // generationComplete と turnComplete が続けて来ても二重確定しない
    if (this.inputText) {
      this.onInput({ text: this.inputText, final: true, timestamp: now });
    }
    if (this.outputText) {
      this.onOutput({
        text: this.outputText,
        final: true,
        timestamp: now,
        latencyMs:
          this.turnStartedAt != null ? now - this.turnStartedAt : undefined,
      });
    }
    this.resetTurn();
  }

  private resetTurn(): void {
    this.inputText = "";
    this.outputText = "";
    this.turnStartedAt = null;
    this.firstOutputAt = null;
  }

  pushAudio(chunk: ArrayBuffer): void {
    // ponytail: ターン開始 = 前ターン終了後の最初のチャンク。
    // 発話直前の無音ぶん latency を過大評価するが、VAD を持たない構成での実用近似。
    if (this.turnStartedAt == null) this.turnStartedAt = Date.now();

    if (!this.ready) {
      this.pending.push(chunk);
      if (this.pending.length > PENDING_CHUNK_LIMIT) this.pending.shift();
      return;
    }
    this.client?.send(buildAudioChunk(pcm16ToBase64(chunk)));
  }

  private flush(): void {
    const queued = this.pending;
    this.pending = [];
    for (const chunk of queued) {
      this.client?.send(buildAudioChunk(pcm16ToBase64(chunk)));
    }
    if (queued.length) this.onStatusCb("STREAMING");
  }

  /**
   * spec2 §27-§29 — 翻訳専用モデルは context injection を前提にできない。
   * ここでは保持のみ行い、Provider を差し替えたときに使えるようにしておく。
   */
  async updateContext(context: PresentationContext): Promise<void> {
    this.context = context;
  }

  /** spec2 §39 — 1, 2, 4, 8 sec（上限 10 sec） */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.config) return;

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.onStatusCb("RECONNECTING");

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.client?.close();
      try {
        await this.open();
      } catch (e) {
        this.onErrorCb(classify(String((e as Error)?.message ?? e)));
        this.scheduleReconnect();
      }
    }, Math.min(delay, RECONNECT_MAX_MS));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.client?.close();
    this.client = null;
    this.ready = false;
    this.pending = [];
    this.resetTurn();
    this.onStatusCb("DISCONNECTED");
  }

  onInputTranscript(cb: (e: TranscriptEvent) => void) {
    this.onInput = cb;
  }
  onOutputTranscript(cb: (e: TranscriptEvent) => void) {
    this.onOutput = cb;
  }
  onStatus(cb: (s: TranslationStatus) => void) {
    this.onStatusCb = cb;
  }
  onError(cb: (e: TranslationError) => void) {
    this.onErrorCb = cb;
  }
}
