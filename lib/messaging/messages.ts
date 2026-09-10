/** spec §30 / spec2 §16 — Extension 内部通信 */
import type {
  TranscriptEvent,
  TranslationError,
  TranslationStatus,
} from "../translation/types";
import type {
  AppState,
  DebugLog,
  MarpDetection,
  PresentationContext,
  SubtitleStatus,
} from "../../types";

export type Target = "background" | "offscreen" | "content" | "ui";

export type ExtensionMessage =
  // popup/options -> background
  | { type: "START" }
  | { type: "STOP" }
  | { type: "GET_STATUS" }
  // background -> content (Marp 検出問い合わせ)
  | { type: "DETECT" }
  // content -> background -> offscreen (spec2 §28)
  | { type: "PRESENTATION_CONTEXT"; context: PresentationContext }
  // content -> background
  | { type: "MARP_DETECTION"; detection: MarpDetection }
  // spec2 §16 — Provider の生イベント（Log Gemini events が ON のときだけ流す）
  | { type: "TRANSLATION_INPUT"; payload: TranscriptEvent }
  | { type: "TRANSLATION_OUTPUT"; payload: TranscriptEvent }
  | { type: "TRANSLATION_STATUS"; status: TranslationStatus }
  | { type: "TRANSLATION_ERROR"; error: TranslationError }
  // spec2 §19-§20 — Subtitle State Layer を通した描画用の状態
  | {
      type: "SUBTITLE";
      text: string;
      original: string;
      status: SubtitleStatus;
      latencyMs?: number;
    }
  | { type: "CLEAR" }
  | { type: "STATUS"; state: AppState; error?: string; latencyMs?: number }
  | { type: "DEBUG_LOG"; log: DebugLog };

export type Envelope = ExtensionMessage & { target: Target };

/** 宛先付きで送る。受信側がいない場合のエラーは握りつぶす。 */
export function send(target: Target, msg: ExtensionMessage): void {
  void chrome.runtime.sendMessage({ ...msg, target } as Envelope).catch(() => {});
}

export function sendToTab(tabId: number, msg: ExtensionMessage): void {
  void chrome.tabs
    .sendMessage(tabId, { ...msg, target: "content" } as Envelope)
    .catch(() => {});
}

/** 自分宛の Envelope だけ受け取るリスナーを登録し、解除関数を返す。 */
export function onMessage(
  target: Target,
  handler: (
    msg: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean | void,
): () => void {
  const listener = (
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    const env = raw as Envelope | undefined;
    if (!env || typeof env !== "object" || env.target !== target) return;
    return handler(env, sender, sendResponse);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
