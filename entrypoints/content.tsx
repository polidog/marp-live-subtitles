/** spec §8, §28, §29 / spec2 §19, §24, §28 — Marp ページ上での検出・字幕描画 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { FADE_MS, Subtitle } from "../components/Subtitle";
import { toPresentationContext } from "../lib/marp/context";
import { detectMarp } from "../lib/marp/detector";
import { getDeckContexts, getSlideContext, watchSlideChange } from "../lib/marp/slide";
import { type ExtensionMessage, onMessage, send } from "../lib/messaging/messages";
import { RollupQueue } from "../lib/subtitle/rollup";
import { trace, traceOnce } from "../lib/trace";
import { DEFAULT_SETTINGS, getSettings, watchSettings } from "../stores/settings";
import type { Settings, SubtitleStatus } from "../types";

type SubtitleMsg = Extract<ExtensionMessage, { type: "SUBTITLE" }>;

/**
 * spec2 §24 — 最後の字幕を保持する時間は settings.holdMs（既定 1.0 秒）。
 * partial のまま更新が途切れた場合はその倍まで待つ。
 */
const IDLE_FACTOR = 1.5;
/**
 * 画面に残す確定文の数。ロールアップ表示では maxLines で切られるので、
 * ここは「切られる前の在庫」。多すぎても無駄なので少しだけ持つ。
 */
const MAX_FINALS = 3;

function SubtitleApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  /** 確定済みの直近の文（古い順）。新しい文は下に流れ込み、古い文は上に消える */
  const [finals, setFinals] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [original, setOriginal] = useState("");
  const [status, setStatus] = useState<SubtitleStatus>("partial");
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // onMessage の購読は初回だけ張るので、設定は ref 経由で読む
  const holdMs = useRef(DEFAULT_SETTINGS.holdMs);
  const dwellMs = useRef(DEFAULT_SETTINGS.dwellMs);
  useEffect(() => {
    holdMs.current = settings.holdMs;
    dwellMs.current = settings.dwellMs;
  }, [settings.holdMs, settings.dwellMs]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    void getSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);

  // 行送りの最短間隔を挟んで反映する。購読は初回だけなので中身は ref 経由で呼ぶ。
  const applyRef = useRef((_msg: SubtitleMsg) => {});
  const [rollup] = useState(
    () => new RollupQueue<SubtitleMsg>((msg) => applyRef.current(msg), () => dwellMs.current),
  );
  applyRef.current = (msg) => {
    if (msg.status === "final") {
      // 確定した文は下段へ積む。表示枠から溢れたぶんは CSS 側で上に消える。
      setFinals((prev) =>
        prev[prev.length - 1] === msg.text
          ? prev
          : [...prev, msg.text].slice(-MAX_FINALS),
      );
      setCurrent("");
    } else {
      setCurrent(msg.text);
    }

    setOriginal(msg.original);
    setStatus(msg.status);
    if (msg.latencyMs != null) setLatencyMs(msg.latencyMs);
    setVisible(true);

    // 更新が途切れたら HOLD -> FADE OUT (spec2 §24)
    const hold =
      msg.status === "final" ? holdMs.current : holdMs.current * IDLE_FACTOR;
    timers.current.push(
      setTimeout(() => {
        setFading(true);
        timers.current.push(
          setTimeout(() => {
            setVisible(false);
            // 消えたあとは在庫も捨てる。次の発話は 1 行目から始まる。
            setFinals([]);
            setCurrent("");
          }, FADE_MS),
        );
      }, hold),
    );
  };

  useEffect(() => {
    return onMessage("content", (msg) => {
      if (msg.type === "SUBTITLE") {
        traceOnce("first-render", "最初の SUBTITLE を受信して描画", msg.text.slice(0, 40));
        // 次の字幕が来たら fade をキャンセルする (spec2 §24)。
        // 行送り待ちの間も、前の行を消さずに置いておく。
        clearTimers();
        setFading(false);
        rollup.push(msg);
      } else if (msg.type === "CLEAR") {
        rollup.clear();
        clearTimers();
        setVisible(false);
        setFading(false);
        setFinals([]);
        setCurrent("");
        setOriginal("");
        setLatencyMs(undefined);
      }
    });
  }, []);

  useEffect(
    () => () => {
      rollup.clear();
      clearTimers();
    },
    [],
  );

  return (
    <Subtitle
      settings={settings}
      finals={finals}
      current={current}
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
