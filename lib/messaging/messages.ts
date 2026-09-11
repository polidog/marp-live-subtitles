/** spec §30 / spec2 §16 — Extension 内部通信 */
import { isExtensionAlive } from "../extension";
import type {
  TranscriptEvent,
  TranslationError,
  TranslationErrorCode,
  TranslationStatus,
} from "../translation/types";
import type {
  AppState,
  DebugLog,
  Settings,
  MarpDetection,
  PresentationContext,
  SubtitleStatus,
} from "../../types";

export type Target = "background" | "offscreen" | "content" | "ui";

export type ExtensionMessage =
  // popup/options -> background
  | { type: "START" }
  | { type: "STOP" }
  // background -> offscreen。offscreen document は chrome.runtime 以外の拡張 API を
  // 使えない（chrome.storage が無い）ため、設定は background が読んで渡す。
  | {
      type: "OFFSCREEN_START";
      settings: Settings;
      apiKey: string;
      /** setup の systemInstruction に載せる発表コンテキスト (spec2 §29) */
      context?: PresentationContext;
    }
  | { type: "GET_STATUS" }
  // background -> content (Marp 検出問い合わせ)
  | { type: "DETECT" }
  // background -> content (Start 時に発表コンテキストを同期的に取る)
  | { type: "GET_CONTEXT" }
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
  | {
      type: "STATUS";
      state: AppState;
      /** 表示用文言。undefined なら「エラーなし」を意味する（前の文言を消す） */
      error?: string;
      /** popup が MIC_PERMISSION_DENIED の導線などを出すための構造化コード */
      code?: TranslationErrorCode;
      latencyMs?: number;
    }
  | { type: "DEBUG_LOG"; log: DebugLog }
  // 各 context の進捗を background のコンソールに集める
  | { type: "TRACE"; context: string; line: string };

export type Envelope = ExtensionMessage & { target: Target };

/** 宛先付きで送る。受信側がいない場合のエラーは握りつぶす。 */
export function send(target: Target, msg: ExtensionMessage): void {
  // 孤児 content script では sendMessage が同期的に throw するので try で囲う
  if (!isExtensionAlive()) return;
  try {
    void chrome.runtime.sendMessage({ ...msg, target } as Envelope).catch(() => {});
  } catch {
    /* 拡張リロードで context が失効した */
  }
}

export function sendToTab(tabId: number, msg: ExtensionMessage): void {
  void chrome.tabs
    .sendMessage(tabId, { ...msg, target: "content" } as Envelope)
    // content script が居ないと字幕は黙って消える。理由を残す。
    .catch((e: unknown) =>
      console.debug(
        `[marp-live-subtitles] tab ${tabId} へ ${msg.type} を送れません:`,
        (e as Error)?.message ?? e,
      ),
    );
}

/**
 * content script に問い合わせて応答を待つ。届かなければ undefined。
 * 応答が返らないケース（孤児 content script など）で呼び出し側を止めないよう、
 * 必ず timeout で打ち切る。
 */
export async function askTab<T>(
  tabId: number,
  msg: ExtensionMessage,
  timeoutMs = 500,
): Promise<T | undefined> {
  const answer = chrome.tabs
    .sendMessage(tabId, { ...msg, target: "content" } as Envelope)
    .catch(() => undefined) as Promise<T | undefined>;
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(resolve, timeoutMs, undefined),
  );
  return Promise.race([answer, timeout]);
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
  if (!isExtensionAlive()) return () => {};
  try {
    chrome.runtime.onMessage.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {
      /* context 失効後は解除する対象もない */
    }
  };
}
