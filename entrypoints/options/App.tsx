/** spec §27 / spec2 §30-§33, §41 — Options Page */
import { useEffect, useState } from "react";
import {
  hasMicPermission,
  listMicrophones,
  requestMicPermission,
} from "../../lib/audio/capture";
import { LANGUAGES, languageName } from "../../lib/translation/types";
import {
  apiKeyItem,
  DEFAULT_SETTINGS,
  getSettings,
  patchSettings,
} from "../../stores/settings";
import type { Settings } from "../../types";

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [granted, setGranted] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings());
      setApiKey(await apiKeyItem.getValue());
      setGranted(await hasMicPermission());
      setMics(await listMicrophones().catch(() => []));
    })();
  }, []);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const update = async (patch: Partial<Settings>) => {
    setSettings(await patchSettings(patch));
    flash();
  };

  const grant = async () => {
    const ok = await requestMicPermission();
    setGranted(ok);
    if (ok) setMics(await listMicrophones().catch(() => []));
  };

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Marp Live Subtitles</h1>
      {saved && <div style={s.saved}>保存しました</div>}

      <h2 style={s.h2}>Translation</h2>
      <Field label="Translation Provider">
        <select
          value={settings.provider}
          onChange={(e) =>
            update({ provider: e.target.value as Settings["provider"] })
          }
        >
          <option value="gemini-live-translation">Gemini Live Translation</option>
        </select>
      </Field>
      <Field label="Model">
        <input
          style={s.wide}
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
        />
      </Field>
      <Field label="Source Language">
        <div>
          <select
            value={settings.sourceLang}
            onChange={(e) => update({ sourceLang: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {languageName(l)} ({l})
              </option>
            ))}
          </select>
          <div style={s.note}>
            Gemini Live Translation は入力言語を自動判定するため、この値は表示と将来の
            Provider 用です。
          </div>
        </div>
      </Field>
      <Field label="Target Language">
        <select
          value={settings.targetLang}
          onChange={(e) => update({ targetLang: e.target.value })}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {languageName(l)} ({l})
            </option>
          ))}
        </select>
      </Field>

      <h2 style={s.h2}>General</h2>
      <Field label="Microphone">
        <select
          value={settings.micDeviceId}
          onChange={(e) => update({ micDeviceId: e.target.value })}
        >
          <option value="">Default Microphone</option>
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || m.deviceId.slice(0, 8)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Permission">
        {granted ? (
          <span style={{ color: "#16a34a" }}>マイク許可済み</span>
        ) : (
          <button style={s.button} onClick={grant}>
            マイクを許可する
          </button>
        )}
      </Field>

      <h2 style={s.h2}>Subtitle</h2>
      <Field label={`Font Size (${settings.fontSize}px)`}>
        <input
          type="range"
          min={20}
          max={80}
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </Field>
      <Field label="Position">
        <select
          value={settings.position}
          onChange={(e) =>
            update({ position: e.target.value as Settings["position"] })
          }
        >
          <option value="bottom">bottom</option>
          <option value="top">top</option>
        </select>
      </Field>
      <Field label={`Opacity (${settings.opacity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </Field>
      <Field label={`Width (${settings.width}vw)`}>
        <input
          type="range"
          min={40}
          max={100}
          value={settings.width}
          onChange={(e) => update({ width: Number(e.target.value) })}
        />
      </Field>
      <Field label="Max Lines">
        <input
          type="number"
          min={1}
          max={5}
          value={settings.maxLines}
          onChange={(e) => update({ maxLines: Number(e.target.value) })}
        />
      </Field>
      <Field label="Original Text">
        <select
          value={settings.mode}
          onChange={(e) => update({ mode: e.target.value as Settings["mode"] })}
        >
          <option value="translation">Translation Only</option>
          <option value="both">Original + Translation</option>
          <option value="original">Original Only</option>
        </select>
      </Field>

      <h2 style={s.h2}>Advanced</h2>
      <Field label="Gemini API Key">
        <div>
          <input
            style={s.wide}
            type="password"
            value={apiKey}
            placeholder="AIza..."
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={async () => {
              await apiKeyItem.setValue(apiKey.trim());
              flash();
            }}
          />
          {/* spec2 §32 */}
          <div style={s.note}>
            For local development only. Do not distribute builds containing your API
            key.
          </div>
        </div>
      </Field>
      <Field label="Show latency">
        <input
          type="checkbox"
          checked={settings.showLatency}
          onChange={(e) => update({ showLatency: e.target.checked })}
        />
      </Field>
      <Field label="Debug Mode">
        <div>
          <input
            type="checkbox"
            checked={settings.debug}
            onChange={(e) => update({ debug: e.target.checked })}
          />
          <span style={s.note}> Popup に Input / Output / Audio を表示する</span>
        </div>
      </Field>
      <Field label="Log Gemini events">
        <input
          type="checkbox"
          checked={settings.logProviderEvents}
          onChange={(e) => update({ logProviderEvents: e.target.checked })}
        />
      </Field>
      <Field label="Echo target language">
        <div>
          <input
            type="checkbox"
            checked={settings.echoTargetLanguage}
            onChange={(e) => update({ echoTargetLanguage: e.target.checked })}
          />
          <span style={s.note}> 翻訳音声側の設定。MVP では字幕に影響しない</span>
        </div>
      </Field>

      {/* spec2 §41 */}
      <p style={s.note}>
        Audio will be streamed to Google Gemini for real-time translation.
        Stop を押すと MediaStream / WebSocket / AudioContext / AudioWorklet をすべて停止します。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.field}>
      <label style={s.fieldLabel}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 720,
    margin: "0 auto",
    padding: 24,
    font: '14px/1.6 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif',
    color: "#111827",
  },
  h1: { fontSize: 20, margin: "0 0 16px" },
  h2: {
    fontSize: 14,
    margin: "24px 0 8px",
    paddingBottom: 4,
    borderBottom: "1px solid #e5e7eb",
    color: "#374151",
  },
  field: {
    display: "grid",
    gridTemplateColumns: "200px 1fr",
    alignItems: "start",
    gap: 12,
    padding: "6px 0",
  },
  fieldLabel: { color: "#6b7280", fontSize: 13 },
  wide: { width: "100%", boxSizing: "border-box", padding: 4 },
  button: {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
  },
  note: { color: "#6b7280", fontSize: 12, marginTop: 4 },
  saved: {
    position: "fixed",
    top: 12,
    right: 12,
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 12,
  },
};
