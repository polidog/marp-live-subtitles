/** spec2 §11, §15 — Gemini Live API との WebSocket 接続（トランスポートのみ） */
import { classify } from "./errors";
import { parseServerMessage, type GeminiServerEvent } from "./protocol";
import type { TranslationError } from "../types";

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;

  private onEventCb: (event: GeminiServerEvent) => void = () => {};
  private onCloseCb: (error?: TranslationError) => void = () => {};

  constructor(private readonly url: string) {}

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

      const onOpenError = () =>
        reject(classify("Gemini Live API へ接続できませんでした"));
      ws.addEventListener("error", onOpenError, { once: true });

      ws.addEventListener(
        "open",
        () => {
          ws.removeEventListener("error", onOpenError);
          resolve();
        },
        { once: true },
      );

      ws.addEventListener("message", (e) => void this.handle(e.data));

      ws.addEventListener("close", (e) => {
        if (this.closedByUs) return;
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
      return;
    }
    for (const event of parseServerMessage(json)) this.onEventCb(event);
  }

  send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }
}
