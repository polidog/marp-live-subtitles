/** spec2 §11, §15 — Gemini Live API との WebSocket 接続（トランスポートのみ） */
import { classify, translationError } from "./errors";
import { parseServerMessage, type GeminiServerEvent } from "./protocol";
import type { TranslationError } from "../types";

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;

  private onEventCb: (event: GeminiServerEvent) => void = () => {};
  private onCloseCb: (error?: TranslationError) => void = () => {};

  /** logEvents が true なら生の送受信を offscreen のコンソールへ出す */
  constructor(
    private readonly url: string,
    private readonly logEvents = false,
  ) {}

  onEvent(cb: (event: GeminiServerEvent) => void) {
    this.onEventCb = cb;
  }

  onClose(cb: (error?: TranslationError) => void) {
    this.onCloseCb = cb;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      let opened = false;

      ws.addEventListener(
        "open",
        () => {
          opened = true;
          resolve();
        },
        { once: true },
      );

      // error イベントには理由が載らない。必ず続く close の code/reason を使う。
      ws.addEventListener("message", (e) => void this.handle(e.data));

      ws.addEventListener("close", (e) => {
        if (this.logEvents) {
          console.debug(`[gemini] close code=${e.code} reason=${e.reason || "(なし)"}`);
        }
        // Stop / 張り直しで自分から閉じた場合。open 前なら connect() を宙に浮かせず
        // 中断として reject する（呼び出し側は stopped / running で無視する）。
        if (this.closedByUs) {
          if (!opened) reject(translationError("UNKNOWN", "接続を中断しました"));
          return;
        }
        if (!opened) {
          reject(
            classify(
              e.reason || `接続が確立できませんでした (close ${e.code})`,
              e.code,
            ),
          );
          return;
        }
        this.onCloseCb(e.code === 1000 ? undefined : classify(e.reason, e.code));
      });
    });
  }

  private async handle(data: unknown): Promise<void> {
    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof Blob) text = await data.text();
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else return;

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (this.logEvents) console.debug("[gemini] 解釈できない受信:", text.slice(0, 500));
      return;
    }

    const events = parseServerMessage(json);
    if (this.logEvents) {
      // 解釈できなかったメッセージを黙って捨てない。フィールド名が変わると
      // 「エラーも字幕も出ない」状態になり、ここを見ないと気づけない。
      console.debug(
        events.length ? "[gemini] 受信:" : "[gemini] 受信(未解釈):",
        events.length ? events : json,
      );
    }
    for (const event of events) this.onEventCb(event);
  }

  send(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      if (this.logEvents) console.debug("[gemini] 未接続のため送信スキップ");
      return;
    }
    // 音声チャンクは毎秒 10 件流れるのでログから除く
    if (this.logEvents && !(payload as any)?.realtimeInput) {
      console.debug("[gemini] 送信:", payload);
    }
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }
}
