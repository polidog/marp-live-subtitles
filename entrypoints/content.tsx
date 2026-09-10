/** spec §8, §28, §29 / spec2 §19, §24, §28 — Marp ページ上での検出・字幕描画 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { FADE_MS, Subtitle } from "../components/Subtitle";
import { toPresentationContext } from "../lib/marp/context";
import { detectMarp } from "../lib/marp/detector";
import { getSlideContext, watchSlideChange } from "../lib/marp/slide";
import { onMessage, send } from "../lib/messaging/messages";
import { DEFAULT_SETTINGS, getSettings, watchSettings } from "../stores/settings";
import type { Settings, SubtitleStatus } from "../types";

/** spec2 §24 — final 字幕を保持する時間 */
const HOLD_MS = 4000;
/** partial のまま更新が途切れた場合の保険 */
const IDLE_HIDE_MS = 8000;

function SubtitleApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [status, setStatus] = useState<SubtitleStatus>("partial");
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    void getSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);

  useEffect(() => {
    return onMessage("content", (msg) => {
      if (msg.type === "SUBTITLE") {
        // 次の字幕が来たら fade をキャンセルする (spec2 §24)
        clearTimers();
        setFading(false);
        setText(msg.text);
        setOriginal(msg.original);
        setStatus(msg.status);
        if (msg.latencyMs != null) setLatencyMs(msg.latencyMs);
        setVisible(true);

        // final -> HOLD -> FADE OUT
        const hold = msg.status === "final" ? HOLD_MS : IDLE_HIDE_MS;
        timers.current.push(
          setTimeout(() => {
            setFading(true);
            timers.current.push(setTimeout(() => setVisible(false), FADE_MS));
          }, hold),
        );
      } else if (msg.type === "CLEAR") {
        clearTimers();
        setVisible(false);
        setFading(false);
        setText("");
        setOriginal("");
        setLatencyMs(undefined);
      }
    });
  }, []);

  useEffect(() => clearTimers, []);

  return (
    <Subtitle
      settings={settings}
      text={text}
      original={original}
      status={status}
      latencyMs={latencyMs}
      visible={visible}
      fading={fading}
    />
  );
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  runAt: "document_idle",

  async main(ctx) {
    const detection = detectMarp();
    send("background", { type: "MARP_DETECTION", detection });

    const pushContext = () => {
      const slide = getSlideContext();
      if (slide) {
        send("background", {
          type: "PRESENTATION_CONTEXT",
          context: toPresentationContext(slide),
        });
      }
    };

    // popup / background からの問い合わせに応答する
    onMessage("content", (msg, _sender, sendResponse) => {
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
          context: toPresentationContext(slide),
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

    // Marp 操作を一切奪わない (spec §29)
    const host = ui.shadowHost as HTMLElement;
    host.style.cssText =
      "position:static;pointer-events:none;display:block;width:0;height:0;overflow:visible;";

    // spec §28 — fullscreen 中は fullscreen element の配下でないと描画されない
    const relocate = () => {
      const fs = document.fullscreenElement;
      // ponytail: <video> 等の非 HTMLElement が fullscreen の場合は移動できない。
      // Marp の bespoke テンプレートは div を fullscreen にするので実害なし。
      const target = fs instanceof HTMLElement ? fs : document.body;
      if (host.parentElement !== target) target.appendChild(host);
    };
    relocate();
    document.addEventListener("fullscreenchange", relocate);
    ctx.onInvalidated(() =>
      document.removeEventListener("fullscreenchange", relocate),
    );
  },
});
