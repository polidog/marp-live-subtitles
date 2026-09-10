/**
 * spec2 §20-§23 — Translation Committer
 *
 * Gemini がストリーミングで返す翻訳 transcript を、そのまま DOM に流さず一度ここで整える。
 *
 * - partial の保持
 * - final の確定
 * - duplicate suppression（同じ内容を送り直さない）
 * - stale subtitle の破棄（確定より古いイベントを捨てる）
 * - flicker reduction（空文字で字幕を消さない）
 */
import type { SubtitleStatus } from "../../types";
import type { TranscriptEvent } from "./types";

export type CommitterOutput = {
  /** 字幕に出す翻訳文 (spec2 §18) */
  text: string;
  /** 入力 transcript。Original 表示モードと Debug UI 用 (spec2 §17) */
  original: string;
  status: SubtitleStatus;
  /** First Subtitle Latency (spec2 §36) */
  latencyMs?: number;
};

export type CommitterDeps = {
  emit: (out: CommitterOutput) => void;
};

export class TranslationCommitter {
  private readonly deps: CommitterDeps;

  private text = "";
  private original = "";
  private status: SubtitleStatus = "partial";
  private latencyMs: number | undefined;

  private lastPartialText = "";
  private lastEmitted = "";
  private finalizedAt = 0;

  constructor(deps: CommitterDeps) {
    this.deps = deps;
  }

  /** spec2 §17 — 入力（原文）transcript */
  handleInput(event: TranscriptEvent): void {
    if (event.timestamp < this.finalizedAt) return;
    const text = event.text.trim();
    if (!text) return;

    this.original = text;
    this.emit();
  }

  /** spec2 §18 — 翻訳 transcript。これが字幕になる。 */
  handleOutput(event: TranscriptEvent): void {
    // 確定より古いイベントは捨てる（再接続時に届く取りこぼしなど）
    if (event.timestamp < this.finalizedAt) return;

    const text = event.text.trim();
    if (!text) return; // 空文字で字幕を消さない

    if (event.latencyMs != null) this.latencyMs = event.latencyMs;

    if (event.final) {
      this.finalizedAt = event.timestamp;
      this.lastPartialText = "";
      this.text = text;
      this.status = "final";
      this.emit();
      return;
    }

    // 同じ partial が 2 回続いたら STABLE とみなす
    this.status = text === this.lastPartialText ? "stable" : "partial";
    this.lastPartialText = text;
    this.text = text;
    this.emit();
  }

  private emit(): void {
    // duplicate suppression: 中身が 1 文字も変わっていなければ送らない
    const key = `${this.status} ${this.text} ${this.original}`;
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;

    this.deps.emit({
      text: this.text,
      original: this.original,
      status: this.status,
      latencyMs: this.latencyMs,
    });
  }

  /** 停止・再接続時 */
  reset(): void {
    this.text = "";
    this.original = "";
    this.status = "partial";
    this.latencyMs = undefined;
    this.lastPartialText = "";
    this.lastEmitted = "";
    this.finalizedAt = 0;
  }
}
