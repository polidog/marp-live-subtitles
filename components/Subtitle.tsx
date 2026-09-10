/** spec §10-§13 / spec2 §20, §22, §24 — 字幕 Overlay */
import type { CSSProperties } from "react";
import type { Settings, SubtitleStatus } from "../types";

export type SubtitleProps = {
  settings: Settings;
  /** 翻訳字幕 (spec2 §18) */
  text: string;
  /** 入力 transcript (spec2 §17) */
  original: string;
  status: SubtitleStatus;
  latencyMs?: number;
  visible: boolean;
  /** spec2 §24 — hold 後の fade out 中 */
  fading: boolean;
};

/** spec2 §22 — partial は少し薄く、final は通常表示 */
const STATUS_OPACITY: Record<SubtitleStatus, number> = {
  partial: 0.72,
  stable: 0.88,
  final: 1,
};

export const FADE_MS = 500;

export function Subtitle({
  settings,
  text,
  original,
  status,
  latencyMs,
  visible,
  fading,
}: SubtitleProps) {
  const showOriginal = settings.mode === "original" || settings.mode === "both";
  const showTranslation = settings.mode !== "original";
  const main = showTranslation ? text : original;

  if (!visible || (!main && !showOriginal)) return null;

  const root: CSSProperties = {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    ...(settings.position === "top" ? { top: "5vh" } : { bottom: "5vh" }),
    zIndex: 2147483647,
    pointerEvents: "none",
    width: `${settings.width}vw`,
    maxWidth: 1400,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: "0.25em",
    alignItems: "center",
    fontFamily:
      '"Helvetica Neue", Helvetica, Arial, "Hiragino Sans", "Noto Sans JP", sans-serif',
    textAlign: "center",
    lineHeight: 1.3,
    opacity: fading ? 0 : 1,
    transition: `opacity ${FADE_MS}ms ease-out`,
  };

  const box: CSSProperties = {
    background: `rgba(0, 0, 0, ${settings.opacity})`,
    color: "#fff",
    borderRadius: 12,
    padding: "0.4em 0.7em",
    textShadow: "0 2px 6px rgba(0,0,0,0.9)",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as CSSProperties["WebkitBoxOrient"],
    WebkitLineClamp: settings.maxLines,
    maxWidth: "100%",
  };

  return (
    <div id="marp-live-subtitles-root" style={root}>
      {showOriginal && original ? (
        <div
          className="subtitle-original"
          style={{
            ...box,
            fontSize: Math.round(settings.fontSize * 0.55),
            opacity: 0.85,
            fontWeight: 400,
          }}
        >
          {original}
        </div>
      ) : null}

      {main ? (
        <div
          className="subtitle"
          style={{
            ...box,
            fontSize: settings.fontSize,
            fontWeight: 600,
            opacity: STATUS_OPACITY[status],
            borderBottom:
              status === "partial"
                ? "2px dashed rgba(255,255,255,0.45)"
                : "2px solid transparent",
          }}
        >
          {main}
        </div>
      ) : null}

      {settings.showLatency && latencyMs != null ? (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.75)",
            background: "rgba(0,0,0,0.5)",
            borderRadius: 6,
            padding: "1px 6px",
          }}
        >
          {(latencyMs / 1000).toFixed(1)}s
        </div>
      ) : null}
    </div>
  );
}
