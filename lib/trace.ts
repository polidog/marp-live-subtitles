/**
 * パイプラインがどこまで進んだかを 1 本のコンソールに集める。
 *
 * 処理は background / offscreen / content script にまたがっていて、
 * それぞれ別のコンソールを持つ。「エラーは出ないが字幕も出ない」ときに
 * 3 つ開いて見比べるのは辛いので、すべて background へ送って並べる。
 *
 * 出るのはライフサイクル上の節目だけ（Start 1 回につき十数行）。
 * 生の送受信や音声チャンク数は Options の "Log Gemini events" 側。
 */
import { isExtensionAlive } from "./extension";
import { send } from "./messaging/messages";

function contextName(): string {
  if (typeof document === "undefined") return "background";
  if (location.protocol === "chrome-extension:") {
    return location.pathname.replace(/^\//, "").replace(/\.html$/, "") || "extension";
  }
  // 拡張が居ないページ = embed/ で読み込まれた埋め込みスクリプト
  return isExtensionAlive() ? "content" : "page";
}

const CONTEXT = contextName();
const seen = new Set<string>();

/** background だけが使う。集めた行を Marp ページの F12 コンソールへも流す。 */
let sink: ((context: string, line: string) => void) | null = null;
export function setTraceSink(cb: typeof sink): void {
  sink = cb;
}

function line(step: string, detail?: string): string {
  return detail ? `${step} — ${detail}` : step;
}

export function trace(step: string, detail?: string): void {
  const text = line(step, detail);
  console.info(`[MLS] ${CONTEXT}: ${text}`);
  // background は自分の送信を受け取らないので二重には出ない
  if (CONTEXT === "background") {
    sink?.(CONTEXT, text);
  } else if (isExtensionAlive()) {
    // 孤児になった content script では sendMessage が同期的に throw する
    send("background", { type: "TRACE", context: CONTEXT, line: text });
  }
}

export function traceFail(step: string, detail?: string): void {
  trace(`✗ ${step}`, detail);
}

/** 同じ key は 1 回だけ。毎チャンク・毎イベント出さないため。 */
export function traceOnce(key: string, step: string, detail?: string): void {
  if (seen.has(key)) return;
  seen.add(key);
  trace(step, detail);
}

/** Start / Stop のたびに「最初の 1 回」を出し直せるようにする */
export function resetTrace(): void {
  seen.clear();
}
