/**
 * spec2 §19, §24, §28 — 字幕の表示状態（ロールアップ・hold・fade out）。
 *
 * 字幕の届き方は context によって違う（拡張は runtime message、embed/ は直接呼び出し）ので、
 * 供給口だけ connect() に外出ししてある。
 */
import { useEffect, useRef, useState } from "react";
import { RollupQueue } from "../lib/subtitle/rollup";
import type { Settings, SubtitleStatus } from "../types";
import { FADE_MS, Subtitle } from "./Subtitle";

export type SubtitleEvent = {
  text: string;
  original: string;
  status: SubtitleStatus;
  latencyMs?: number;
};

export type SubtitleFeed = {
  push: (event: SubtitleEvent) => void;
  /** CLEAR — 表示も待ち行列も捨てる */
  clear: () => void;
};

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

export type SubtitleOverlayProps = {
  settings: Settings;
  /** マウント時に一度だけ呼ばれる。解除関数を返せば unmount 時に呼ぶ。 */
  connect: (feed: SubtitleFeed) => (() => void) | void;
};

export function SubtitleOverlay({ settings, connect }: SubtitleOverlayProps) {
  /** 確定済みの直近の文（古い順）。新しい文は下に流れ込み、古い文は上に消える */
  const [finals, setFinals] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [original, setOriginal] = useState("");
  const [status, setStatus] = useState<SubtitleStatus>("partial");
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // connect は初回だけ張るので、設定は ref 経由で読む
  const holdMs = useRef(settings.holdMs);
  const dwellMs = useRef(settings.dwellMs);
  useEffect(() => {
    holdMs.current = settings.holdMs;
    dwellMs.current = settings.dwellMs;
  }, [settings.holdMs, settings.dwellMs]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // 行送りの最短間隔を挟んで反映する。購読は初回だけなので中身は ref 経由で呼ぶ。
  const applyRef = useRef((_event: SubtitleEvent) => {});
  const [rollup] = useState(
    () =>
      new RollupQueue<SubtitleEvent>(
        (event) => applyRef.current(event),
        () => dwellMs.current,
      ),
  );
  applyRef.current = (event) => {
    if (event.status === "final") {
      // 確定した文は下段へ積む。表示枠から溢れたぶんは CSS 側で上に消える。
      setFinals((prev) =>
        prev[prev.length - 1] === event.text
          ? prev
          : [...prev, event.text].slice(-MAX_FINALS),
      );
      setCurrent("");
    } else {
      setCurrent(event.text);
    }

    setOriginal(event.original);
    setStatus(event.status);
    if (event.latencyMs != null) setLatencyMs(event.latencyMs);
    setVisible(true);

    // 更新が途切れたら HOLD -> FADE OUT (spec2 §24)
    const hold =
      event.status === "final" ? holdMs.current : holdMs.current * IDLE_FACTOR;
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
    const feed: SubtitleFeed = {
      push: (event) => {
        // 次の字幕が来たら fade をキャンセルする (spec2 §24)。
        // 行送り待ちの間も、前の行を消さずに置いておく。
        clearTimers();
        setFading(false);
        rollup.push(event);
      },
      clear: () => {
        rollup.clear();
        clearTimers();
        setVisible(false);
        setFading(false);
        setFinals([]);
        setCurrent("");
        setOriginal("");
        setLatencyMs(undefined);
      },
    };

    const disconnect = connect(feed);
    return () => {
      disconnect?.();
      rollup.clear();
      clearTimers();
    };
  }, []);

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
