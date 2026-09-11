/** spec §26 / spec2 §34, §35, §41 — Popup UI */
import { useEffect, useState } from "react";
import {
  AUDIO_FORMAT_LABEL,
  hasMicPermission,
  listMicrophones,
  openMicSiteSettings,
} from "../../lib/audio/capture";
import { onMessage, send } from "../../lib/messaging/messages";
import { languageName } from "../../lib/translation/types";
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
  IDLE: "#94a3b8",
  REQUESTING_PERMISSION: "#f59e0b",
  CONNECTING: "#f59e0b",
  LISTENING: "#e11d48",
  TRANSLATING: "#e11d48",
  RECONNECTING: "#f59e0b",
  ERROR: "#dc2626",
  STOPPING: "#94a3b8",
};

const RUNNING: AppState[] = ["CONNECTING", "LISTENING", "TRANSLATING", "RECONNECTING"];

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<AppState>("IDLE");
  const [error, setError] = useState<string>();
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
          setState(msg.state);
          // undefined で既存のエラー文言を消さない（Start / Stop で消す）
          if (msg.error !== undefined) setError(msg.error);
          if (msg.latencyMs != null) setLatencyMs(msg.latencyMs);
          break;
        case "SUBTITLE":
          setInput(msg.original);
          setOutput(msg.text);
          if (msg.latencyMs != null) setLatencyMs(msg.latencyMs);
          break;
        case "TRANSLATION_ERROR":
          setError(`${msg.error.code}: ${msg.error.message}`);
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

  /** Gemini を経由せず content script の描画だけを確かめる (Debug Mode 専用) */
  const sendTestSubtitle = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return setError("対象タブが見つかりません");
    try {
      await chrome.tabs.sendMessage(tab.id, {
        target: "content",
        type: "SUBTITLE",
        status: "final",
        original: "今日は新しいサービスを紹介します",
        text: "Today, I'd like to introduce our new service.",
        latencyMs: 840,
      });
      setError(undefined);
    } catch (e) {
      setError(`content script に届きません: ${(e as Error)?.message ?? e}`);
    }
  };

  return (
    <div style={s.root}>
      <div style={s.title}>Marp Live Subtitles</div>

      <div style={s.row}>
        <span
          style={{ ...s.dot, background: detection?.detected ? "#16a34a" : "#94a3b8" }}
        />
        <span>
          {detection == null
            ? "検出中…"
            : detection.detected
              ? `Marp detected (${detection.slideCount} slides)`
              : "Marp presentation not detected."}
        </span>
      </div>

      {!micGranted && (
        <div style={s.warn}>
          Microphone permission is required.
          <button style={s.link} onClick={() => chrome.runtime.openOptionsPage()}>
            Options で許可
          </button>
          <button style={s.link} onClick={openMicSiteSettings}>
            Chrome のサイト設定でマイクを「許可」にする
          </button>
        </div>
      )}

      <label style={s.label}>Microphone</label>
      <select
        style={s.select}
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

      <div style={s.langs}>
        {languageName(settings.sourceLang)} → {languageName(settings.targetLang)}
      </div>

      {/* spec2 §41 — 開始前に送信先を明示する */}
      {!running && (
        <div style={s.privacy}>
          Audio will be streamed to Google Gemini for real-time translation.
        </div>
      )}

      <button
        style={{ ...s.button, background: running ? "#dc2626" : "#111827" }}
        onClick={() => {
          setError(undefined);
          send("background", { type: running ? "STOP" : "START" });
        }}
      >
        {running ? "Stop" : "Start Subtitles"}
      </button>

      <label style={s.label}>Status</label>
      <div style={s.row}>
        <span style={{ ...s.dot, background: DOT[state] }} />
        <span>{running && state !== "CONNECTING" ? "LIVE" : STATE_LABEL[state]}</span>
      </div>

      {settings.showLatency && latencyMs != null && running && (
        <>
          <label style={s.label}>Latency</label>
          <div>{latencyMs} ms</div>
        </>
      )}

      {/* spec2 §35 — Debug UI */}
      {settings.debug && (
        <div style={s.debug}>
          <div style={s.debugTitle}>{settings.model}</div>
          <label style={s.label}>Input</label>
          <div style={s.debugText}>{input || "—"}</div>
          <label style={s.label}>Output</label>
          <div style={s.debugText}>{output || "—"}</div>
          <label style={s.label}>Audio</label>
          <div style={s.debugText}>{AUDIO_FORMAT_LABEL}</div>
          <button style={{ ...s.button, marginTop: 8 }} onClick={sendTestSubtitle}>
            テスト字幕を表示
          </button>
        </div>
      )}

      {error && (
        <div style={s.error}>
          {error}
          {error.startsWith("MIC_PERMISSION_DENIED") && (
            <button style={s.link} onClick={openMicSiteSettings}>
              Chrome のサイト設定でマイクを「許可」にする
            </button>
          )}
        </div>
      )}

      <button style={s.link} onClick={() => chrome.runtime.openOptionsPage()}>
        Options
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: 260,
    padding: 14,
    font: '13px/1.5 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif',
    color: "#111827",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  title: { fontWeight: 700, fontSize: 14, marginBottom: 4 },
  row: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto" },
  label: { fontSize: 11, color: "#6b7280", marginTop: 6 },
  select: { width: "100%", padding: 4 },
  langs: { marginTop: 8, color: "#374151" },
  privacy: {
    marginTop: 6,
    fontSize: 11,
    color: "#6b7280",
    background: "#f3f4f6",
    borderRadius: 6,
    padding: 6,
  },
  button: {
    marginTop: 10,
    padding: "8px 12px",
    color: "#fff",
    border: 0,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
  },
  link: {
    marginTop: 8,
    background: "none",
    border: 0,
    color: "#2563eb",
    cursor: "pointer",
    padding: 0,
    textAlign: "left",
    fontSize: 12,
  },
  warn: { background: "#fef3c7", padding: 6, borderRadius: 6, fontSize: 12 },
  debug: {
    marginTop: 10,
    padding: 8,
    borderRadius: 6,
    border: "1px solid #e5e7eb",
    background: "#fafafa",
  },
  debugTitle: { fontSize: 11, fontWeight: 600, color: "#374151" },
  debugText: {
    fontSize: 12,
    wordBreak: "break-word",
    maxHeight: 54,
    overflow: "hidden",
  },
  error: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: 6,
    borderRadius: 6,
    fontSize: 12,
    wordBreak: "break-word",
  },
};
