/** spec §10-§13 / spec2 §20, §22, §24 — 字幕 Overlay（ロールアップ表示） */
import type { CSSProperties } from "react";
import type { Settings, SubtitleStatus } from "../types";

export type SubtitleProps = {
  settings: Settings;
  /** 確定済みの直近の文（古い順）。表示枠から溢れたぶんは上に消える */
  finals: string[];
  /** いま翻訳中の文 (spec2 §18) */
  current: string;
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
  partial: 0.7,
  stable: 0.85,
  final: 1,
};

export const FADE_MS = 500;
const LINE_HEIGHT = 1.3;

export function Subtitle({
  settings,
  finals,
  current,
  original,
  status,
  latencyMs,
  visible,
  fading,
}: SubtitleProps) {
  const showOriginal = settings.mode === "original" || settings.mode === "both";
  const showTranslation = settings.mode !== "original";
  const hasTranslation = finals.length > 0 || current.length > 0;

  if (!visible) return null;
  if (!(showTranslation && hasTranslation) && !(showOriginal && original)) return null;

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
    lineHeight: LINE_HEIGHT,
    opacity: fading ? 0 : 1,
    transition: `opacity ${FADE_MS}ms ease-out`,
  };

  const box: CSSProperties = {
    background: `rgba(0, 0, 0, ${settings.opacity})`,
    color: "#fff",
    borderRadius: 12,
    padding: "0.4em 0.7em",
    textShadow: "0 2px 6px rgba(0,0,0,0.9)",
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  // ロールアップ: 中身を maxLines 行で切り、下揃えにする。
  // 溢れた古い行は上にはみ出して clip される = 新しい文が下から押し上げる動きになる。
  // box ではなく内側で切る。box で切ると padding の分だけ古い行が半分見えてしまう。
  const rollupFor = (lines: number): CSSProperties => ({
    maxHeight: `${lines * LINE_HEIGHT}em`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
  });

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
          {/* 原文は 1 文だけなので行数を抑える */}
          <div style={rollupFor(2)}>
            <div>{original}</div>
          </div>
        </div>
      ) : null}

      {showTranslation && hasTranslation ? (
        <div
          className="subtitle"
          style={{
            ...box,
            fontSize: settings.fontSize,
            fontWeight: 600,
          }}
        >
          <div style={rollupFor(settings.maxLines)}>
            <div>
              {finals.join(" ")}
              {finals.length > 0 && current ? " " : ""}
              {current ? (
                <span
                  style={{
                    opacity: STATUS_OPACITY[status],
                    // 暫定は破線で示す (spec2 §22)
                    borderBottom:
                      status === "final"
                        ? undefined
                        : "2px dashed rgba(255,255,255,0.45)",
                  }}
                >
                  {current}
                </span>
              ) : null}
            </div>
          </div>
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
