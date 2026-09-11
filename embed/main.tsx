/**
 * Marp の HTML に直接読み込む版。拡張を入れずに同じ字幕を出す。
 *
 *   <script src="live-subtitles.js" data-api-key="..." data-target-lang="en"></script>
 *
 * Shift+S で開始 / 停止。window.liveSubtitles からも叩ける。
 * マイクは file:// では開けないので、http://localhost 経由で配ること（`marp -s` など）。
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SubtitleOverlay, type SubtitleFeed } from "../components/SubtitleOverlay";
import { toPresentationContext } from "../lib/marp/context";
import { getDeckContexts, getSlideContext, watchSlideChange } from "../lib/marp/slide";
import { followFullscreen } from "../lib/overlay-host";
import { trace } from "../lib/trace";
import { formatError } from "../lib/translation/gemini/errors";
import { TranslationPipeline } from "../lib/translation/pipeline";
import { DEFAULT_SETTINGS } from "../stores/settings";
import type { AppState, PresentationContext, Settings } from "../types";

/** 拡張の chrome.storage の代わり。デッキに API Key を書かずに済ませるための置き場 */
const API_KEY_STORAGE = "mls:apiKey";

const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>('script[src*="live-subtitles"]');

/**
 * data-* を Settings に流し込む。data-font-size → fontSize のように
 * dataset のキーがそのまま Settings のキーになる。型は既定値に合わせる。
 */
function settingsFromDataset(dataset: DOMStringMap): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const raw = dataset[key];
    if (raw == null) continue;
    out[key] =
      typeof fallback === "number"
        ? Number(raw)
        : typeof fallback === "boolean"
          ? raw !== "false"
          : raw;
  }
  return out as Settings;
}

const settings = settingsFromDataset(script?.dataset ?? {});
const apiKey = script?.dataset.apiKey ?? localStorage.getItem(API_KEY_STORAGE) ?? "";

let feed: SubtitleFeed | null = null;
let unwatchSlide: (() => void) | null = null;
let setStatus: (state: AppState, error?: string) => void = () => {};

const pipeline = new TranslationPipeline({
  onSubtitle: (out) => feed?.push(out),
  onState: (state, error) => setStatus(state, error ? formatError(error) : undefined),
  onTranscript: (direction, payload) => console.info(`[MLS] ${direction}`, payload),
});

function currentContext(deck: ReturnType<typeof getDeckContexts>): PresentationContext | null {
  const slide = getSlideContext();
  return slide ? toPresentationContext(slide, deck) : null;
}

async function start(): Promise<void> {
  if (pipeline.isRunning) return;
  // デッキ全体は変わらないので一度だけ抽出する (spec2 §29)
  const deck = getDeckContexts();
  await pipeline.start({
    settings,
    apiKey,
    context: currentContext(deck) ?? undefined,
  });
  // spec §24 / spec2 §28 — スライド変更は張り直さず context だけ差し替える
  unwatchSlide?.();
  unwatchSlide = watchSlideChange((slide) =>
    void pipeline.updateContext(toPresentationContext(slide, deck)),
  );
}

async function stop(): Promise<void> {
  unwatchSlide?.();
  unwatchSlide = null;
  await pipeline.stop();
  feed?.clear();
}

/** 接続中・エラーだけ小さく出す。字幕が出ている間は何も被せない。 */
function StatusBadge({ state, error }: { state: AppState; error?: string }) {
  if (state === "IDLE" && !error) return null;
  const label =
    error ??
    { CONNECTING: "接続中…", LISTENING: "字幕 ON", RECONNECTING: "再接続中…" }[
      state as string
    ] ??
    state;
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 2147483647,
        pointerEvents: "none",
        maxWidth: "40vw",
        padding: "4px 10px",
        borderRadius: 999,
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: 13,
        color: "#fff",
        background: error ? "rgba(180,30,30,0.85)" : "rgba(0,0,0,0.55)",
      }}
    >
      {label}
    </div>
  );
}

function App() {
  const [state, setState] = useState<AppState>("IDLE");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setStatus = (next, message) => {
      setState(next);
      setError(message);
    };
    return () => {
      setStatus = () => {};
    };
  }, []);

  return (
    <>
      <SubtitleOverlay
        settings={settings}
        connect={(f) => {
          feed = f;
          return () => {
            feed = null;
          };
        }}
      />
      <StatusBadge state={state} error={error} />
    </>
  );
}

function mount(): void {
  const host = document.createElement("div");
  // Marp 操作を一切奪わない (spec §29)。ページの CSS も届かせない。
  host.style.cssText =
    "position:static;pointer-events:none;display:block;width:0;height:0;overflow:visible;";
  document.body.appendChild(host);
  const container = document.createElement("div");
  host.attachShadow({ mode: "open" }).appendChild(container);
  createRoot(container).render(<App />);
  followFullscreen(host);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "S" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;
    e.preventDefault();
    void (pipeline.isRunning ? stop() : start());
  });

  addEventListener("pagehide", () => void stop());

  trace(
    "overlay mount ok",
    `${getDeckContexts().length} slides / Shift+S で開始${apiKey ? "" : " — API Key 未設定"}`,
  );

  if (script?.dataset.autoStart != null) void start();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}

(window as unknown as Record<string, unknown>).liveSubtitles = { start, stop, settings };
