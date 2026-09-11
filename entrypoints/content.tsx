/** spec §8, §28, §29 / spec2 §19, §24, §28 — Marp ページ上での検出・字幕描画 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { SubtitleOverlay } from "../components/SubtitleOverlay";
import { toPresentationContext } from "../lib/marp/context";
import { detectMarp } from "../lib/marp/detector";
import { getDeckContexts, getSlideContext, watchSlideChange } from "../lib/marp/slide";
import { onMessage, send } from "../lib/messaging/messages";
import { followFullscreen } from "../lib/overlay-host";
import { trace, traceOnce } from "../lib/trace";
import { DEFAULT_SETTINGS, getSettings, watchSettings } from "../stores/settings";
import type { Settings } from "../types";

function SubtitleApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void getSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);

  return (
    <SubtitleOverlay
      settings={settings}
      connect={(feed) =>
        onMessage("content", (msg) => {
          if (msg.type === "SUBTITLE") {
            traceOnce("first-render", "最初の SUBTITLE を受信して描画", msg.text.slice(0, 40));
            feed.push(msg);
          } else if (msg.type === "CLEAR") {
            feed.clear();
          }
        })
      }
    />
  );
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  runAt: "document_idle",

  async main(ctx) {
    const detection = detectMarp();
    send("background", { type: "MARP_DETECTION", detection });

    // デッキ全体は変わらないので一度だけ抽出する (spec2 §29)
    const deck = detection.detected ? getDeckContexts() : [];

    const currentContext = () => {
      const slide = getSlideContext();
      return slide ? toPresentationContext(slide, deck) : null;
    };

    const pushContext = () => {
      const context = currentContext();
      if (context) send("background", { type: "PRESENTATION_CONTEXT", context });
    };

    // popup / background からの問い合わせに応答する
    onMessage("content", (msg, _sender, sendResponse) => {
      // background / offscreen の進捗をこのページの F12 コンソールにも並べる
      if (msg.type === "TRACE") {
        console.info(`[MLS] ${msg.context}: ${msg.line}`);
        return;
      }
      // Start 時に background が同期的に取りに来る。setup へ載せるので取りこぼせない。
      if (msg.type === "GET_CONTEXT") {
        sendResponse(currentContext());
        return true;
      }
      if (msg.type !== "DETECT") return;
      const fresh = detectMarp();
      sendResponse(fresh);
      send("background", { type: "MARP_DETECTION", detection: fresh });
      pushContext();
      return true;
    });

    if (detection.detected) {
      // spec §24 / spec2 §28 — スライド変更を Local Context State へ反映
      const unwatch = watchSlideChange((slide) =>
        send("background", {
          type: "PRESENTATION_CONTEXT",
          context: toPresentationContext(slide, deck),
        }),
      );
      ctx.onInvalidated(unwatch);
    }

    const ui = await createShadowRootUi(ctx, {
      name: "marp-live-subtitles",
      position: "inline",
      anchor: "body",
      onMount: (container) => {
        const root = createRoot(container);
        root.render(<SubtitleApp />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });

    ui.mount();
    trace(
      "overlay mount ok",
      `Marp ${detection.detected ? "検出" : "未検出"} / ${detection.slideCount} slides`,
    );

    // Marp 操作を一切奪わない (spec §29)
    const host = ui.shadowHost as HTMLElement;
    host.style.cssText =
      "position:static;pointer-events:none;display:block;width:0;height:0;overflow:visible;";

    ctx.onInvalidated(followFullscreen(host));
  },
});
