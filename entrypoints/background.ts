/** spec §16, §31 / spec2 §19, §34 — lifecycle / routing / state coordination */
import { defineBackground } from "wxt/utils/define-background";
import {
  onMessage,
  send,
  sendToTab,
  type ExtensionMessage,
} from "../lib/messaging/messages";
import { getApiKey, getSettings } from "../stores/settings";
import { resetTrace, trace, traceFail, traceOnce } from "../lib/trace";
import type { TranslationErrorCode } from "../lib/translation/types";
import type { AppState, MarpDetection } from "../types";

const OFFSCREEN_URL = "offscreen.html";

const RUNNING: AppState[] = ["CONNECTING", "LISTENING", "TRANSLATING", "RECONNECTING"];

export default defineBackground(() => {
  let state: AppState = "IDLE";
  let error: string | undefined;
  let errorCode: TranslationErrorCode | undefined;
  let latencyMs: number | undefined;
  let targetTabId: number | null = null;
  let detection: MarpDetection = { detected: false, slideCount: 0 };
  let creating: Promise<void> | null = null;

  const badge = (next: AppState) => {
    void chrome.action.setBadgeText({ text: RUNNING.includes(next) ? "LIVE" : "" });
    void chrome.action.setBadgeBackgroundColor({ color: "#e11d48" });
  };

  // STATUS の error は「その時点の真実」。undefined ならエラーなし。
  // 失敗時に文言が残るかどうかは offscreen 側の送信順序（片付け → ERROR）で担保する。
  const setState = (next: AppState, err?: string, code?: TranslationErrorCode) => {
    state = next;
    error = err;
    errorCode = code;
    if (!RUNNING.includes(next)) latencyMs = undefined;
    badge(next);
    send("ui", { type: "STATUS", state, error, code: errorCode, latencyMs });
  };

  async function ensureOffscreen(): Promise<void> {
    if (await chrome.offscreen.hasDocument()) return;
    if (creating) return creating;
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "マイク音声の Gemini Live Translation へのストリーミング",
      })
      .finally(() => {
        creating = null;
      });
    return creating;
  }

  async function start(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setState("ERROR", "対象タブが見つかりません");
      return;
    }
    targetTabId = tab.id;
    resetTrace();
    trace("Start", `tab ${tab.id}: ${tab.url?.slice(0, 80)}`);

    setState("CONNECTING");
    try {
      // offscreen は chrome.storage を持たないので、ここで読んで渡す
      const [settings, apiKey] = await Promise.all([getSettings(), getApiKey()]);
      trace("設定を読み込み ok", `apiKey: ${apiKey.length}文字`);
      await ensureOffscreen();
      trace("offscreen document 用意 ok");
      send("offscreen", { type: "OFFSCREEN_START", settings, apiKey });
      // 現在のスライドを Local Context State として取り込む (spec2 §28)
      sendToTab(targetTabId, { type: "DETECT" });
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      traceFail("Start 失敗", message);
      setState("ERROR", message);
    }
  }

  async function stop(): Promise<void> {
    setState("STOPPING");
    send("offscreen", { type: "STOP" });
    if (targetTabId != null) sendToTab(targetTabId, { type: "CLEAR" });
    // offscreen 側の後始末を待ってから閉じる (spec2 §41)
    setTimeout(async () => {
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    }, 200);
    targetTabId = null;
    setState("IDLE");
  }

  onMessage("background", (msg: ExtensionMessage, _sender, sendResponse) => {
    switch (msg.type) {
      case "START":
        void start();
        break;

      case "STOP":
        void stop();
        break;

      case "GET_STATUS":
        send("ui", { type: "STATUS", state, error, code: errorCode, latencyMs });
        break;

      // popup が Marp 検出状態を問い合わせる
      case "DETECT":
        sendResponse(detection);
        return true;

      // content -> offscreen (spec2 §27: セッションは張り直さない)
      case "PRESENTATION_CONTEXT":
        send("offscreen", msg);
        break;

      case "MARP_DETECTION":
        detection = msg.detection;
        trace(
          "Marp 検出結果",
          `${msg.detection.detected ? "検出" : "未検出"} / ${msg.detection.slideCount} slides`,
        );
        send("ui", msg);
        break;

      // offscreen -> content + popup (spec2 §19)
      case "SUBTITLE":
        if (msg.latencyMs != null) latencyMs = msg.latencyMs;
        if (state !== "STOPPING" && state !== "IDLE") {
          setState(msg.status === "final" ? "LISTENING" : "TRANSLATING");
        }
        if (targetTabId != null) {
          traceOnce("first-forward", "最初の SUBTITLE を content へ転送", `tab ${targetTabId}`);
          sendToTab(targetTabId, msg);
        }
        send("ui", msg);
        break;

      case "STATUS":
        // 停止処理中に offscreen の遅れた状態で復活させない
        if (state === "STOPPING" && msg.state !== "IDLE") break;
        setState(msg.state, msg.error, msg.code);
        break;

      case "TRANSLATION_ERROR":
        send("ui", msg);
        break;

      // spec2 §31 — Log Gemini events
      case "TRANSLATION_INPUT":
      case "TRANSLATION_OUTPUT":
      case "TRANSLATION_STATUS":
        console.debug("[marp-live-subtitles]", msg);
        send("ui", msg);
        break;

      case "DEBUG_LOG":
        console.info("[marp-live-subtitles]", msg.log);
        break;

      // 各 context の進捗をここに集約する
      case "TRACE":
        console.info(`[MLS] ${msg.context}: ${msg.line}`);
        break;
    }
  });

  // 対象タブが消えたら確実に止める (spec §38 / spec2 §41)
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === targetTabId && state !== "IDLE") void stop();
  });

  chrome.runtime.onSuspend?.addListener(() => {
    void chrome.action.setBadgeText({ text: "" });
  });
});
