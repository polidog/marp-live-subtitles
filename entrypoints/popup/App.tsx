/** spec §26 / spec2 §34, §35, §41 — Popup UI */
import { useEffect, useState } from "react";
import {
  AUDIO_FORMAT_LABEL,
  hasMicPermission,
  listMicrophones,
  openMicSiteSettings,
} from "../../lib/audio/capture";
import { onMessage, send } from "../../lib/messaging/messages";
import { languageName, type TranslationErrorCode } from "../../lib/translation/types";
import { DEFAULT_SETTINGS, getSettings, patchSettings } from "../../stores/settings";
import type { AppState, MarpDetection, Settings } from "../../types";

/** spec2 §34 */
const STATE_LABEL: Record<AppState, string> = {
  IDLE: "Idle",
  REQUESTING_PERMISSION: "マイク許可待ち",
  CONNECTING: "Connecting",
  LISTENING: "Listening",
  TRANSLATING: "Translating",
  RECONNECTING: "Reconnecting",
  ERROR: "Error",
  STOPPING: "停止中…",
};

const DOT: Record<AppState, string> = {
  IDLE: "",
  REQUESTING_PERMISSION: "warn",
  CONNECTING: "warn",
  LISTENING: "live",
  TRANSLATING: "live",
  RECONNECTING: "warn",
  ERROR: "danger",
  STOPPING: "",
};

const RUNNING: AppState[] = ["CONNECTING", "LISTENING", "TRANSLATING", "RECONNECTING"];

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<AppState>("IDLE");
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<TranslationErrorCode>();
  const [latencyMs, setLatencyMs] = useState<number>();
  const [detection, setDetection] = useState<MarpDetection | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micGranted, setMicGranted] = useState(true);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  useEffect(() => {
    void getSettings().then(setSettings);
    send("background", { type: "GET_STATUS" });

    const off = onMessage("ui", (msg) => {
      switch (msg.type) {
        case "STATUS":
          // background が持つ状態をそのまま映す。エラーの有無もここが唯一の根拠。
          setState(msg.state);
          setError(msg.error);
          setErrorCode(msg.code);
          if (msg.latencyMs != null) setLatencyMs(msg.latencyMs);
          break;
        case "SUBTITLE":
          setInput(msg.original);
          setOutput(msg.text);
          if (msg.latencyMs != null) setLatencyMs(msg.latencyMs);
          break;
        case "MARP_DETECTION":
          setDetection(msg.detection);
          break;
      }
    });

    void (async () => {
      setMicGranted(await hasMicPermission());
      setMics(await listMicrophones().catch(() => []));

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return setDetection({ detected: false, slideCount: 0 });
      try {
        const res = (await chrome.tabs.sendMessage(tab.id, {
          target: "content",
          type: "DETECT",
        })) as MarpDetection | undefined;
        setDetection(res ?? { detected: false, slideCount: 0 });
      } catch {
        setDetection({ detected: false, slideCount: 0 });
      }
    })();

    return off;
  }, []);

  const running = RUNNING.includes(state);

  /**
   * Gemini を経由せず content script の描画だけを確かめる (Debug Mode 専用)。
   * ロールアップ（古い行が上へ流れる動き）も見えるよう数文を順に送る。
   */
  const sendTestSubtitle = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return setError("対象タブが見つかりません");

    const script: Array<[string, string, "final" | "partial"]> = [
      ["今日は新しいサービスを紹介します", "Today, I'd like to introduce our new service.", "final"],
      ["このサービスは Redis を使っています", "This service uses Redis.", "final"],
      ["まず全体の構成から説明します", "Let me start with the overall architecture", "partial"],
    ];

    try {
      for (const [original, text, status] of script) {
        await chrome.tabs.sendMessage(tab.id, {
          target: "content",
          type: "SUBTITLE",
          status,
          original,
          text,
          latencyMs: 840,
        });
        await new Promise((r) => setTimeout(r, 900));
      }
      setError(undefined);
    } catch (e) {
      setError(`content script に届きません: ${(e as Error)?.message ?? e}`);
    }
  };

  return (
    <div className="pop">
      <div className="pop-head">
        <span className="title">Live Subtitles</span>
        <span className="pill">
          <span className={`dot ${DOT[state]}`} />
          {running && state !== "CONNECTING" ? "LIVE" : STATE_LABEL[state]}
        </span>
      </div>

      <div className="pop-card">
        <div className="row">
          <span className={`dot ${detection?.detected ? "ok" : ""}`} />
          <span style={{ fontSize: 12 }}>
            {detection == null
              ? "検出中…"
              : detection.detected
                ? `Marp detected · ${detection.slideCount} slides`
                : "Marp presentation not detected"}
          </span>
        </div>

        {!micGranted && (
          <div className="warn">
            Microphone permission is required.
            <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
              Options で許可
            </button>
            <button className="link" onClick={openMicSiteSettings}>
              Chrome のサイト設定でマイクを「許可」にする
            </button>
          </div>
        )}

        <div>
          <div className="label">Microphone</div>
          <select
            value={settings.micDeviceId}
            disabled={running}
            onChange={async (e) => {
              setSettings(await patchSettings({ micDeviceId: e.target.value }));
            }}
          >
            <option value="">Default Microphone</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || m.deviceId.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>

        <div className="lang-pair">
          <span>{languageName(settings.sourceLang)}</span>
          <span className="arrow">→</span>
          <span>{languageName(settings.targetLang)}</span>
        </div>
      </div>

      <button
        className={`btn btn-block ${running ? "btn-danger" : "btn-primary"}`}
        onClick={() => send("background", { type: running ? "STOP" : "START" })}
      >
        {running ? "Stop" : "Start Subtitles"}
      </button>

      {/* spec2 §41 — 開始前に送信先を明示する */}
      {!running && (
        <div className="privacy">
          Audio will be streamed to Google Gemini for real-time translation.
        </div>
      )}

      {settings.showLatency && latencyMs != null && running && (
        <div className="pop-card">
          <div className="kv">
            <span className="label">Latency</span>
            <span className="v">{latencyMs} ms</span>
          </div>
        </div>
      )}

      {/* spec2 §35 — Debug UI */}
      {settings.debug && (
        <div className="pop-card">
          <div className="kv">
            <span className="label">Debug</span>
            <code>{settings.model}</code>
          </div>
          <div>
            <div className="label">Input</div>
            <div className="debug-text">{input || "—"}</div>
          </div>
          <div>
            <div className="label">Output</div>
            <div className="debug-text">{output || "—"}</div>
          </div>
          <div>
            <div className="label">Audio</div>
            <div className="debug-text">{AUDIO_FORMAT_LABEL}</div>
          </div>
          <div>
            <button className="btn" onClick={sendTestSubtitle}>
              テスト字幕を表示
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error">
          {error}
          {errorCode === "MIC_PERMISSION_DENIED" && (
            <div>
              <button className="link" onClick={openMicSiteSettings}>
                Chrome のサイト設定でマイクを「許可」にする
              </button>
            </div>
          )}
        </div>
      )}

      <div className="pop-foot">
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
          ⚙ Options
        </button>
      </div>
    </div>
  );
}
