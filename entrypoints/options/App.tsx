/** spec §27 / spec2 §30-§33, §41 — Options Page */
import { useEffect, useRef, useState } from "react";
import {
  listMicrophones,
  micPermissionState,
  openMicSiteSettings,
  requestMicPermission,
} from "../../lib/audio/capture";
import { LANGUAGES, languageName } from "../../lib/translation/types";
import {
  DEFAULT_SETTINGS,
  getApiKey,
  getSettings,
  patchSettings,
  setApiKey,
} from "../../stores/settings";
import type { Settings } from "../../types";

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKeyInput] = useState("");
  /** 実際に chrome.storage.local に入っている値（入力中の state と区別する） */
  const [storedKey, setStoredKey] = useState("");
  /** bidiGenerateContent (Live API) に対応するモデル名。鍵で ListModels して絞る */
  const [liveModels, setLiveModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string>();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [permission, setPermission] = useState<string>("unknown");
  const [grantError, setGrantError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings());
      const stored = await getApiKey().catch(() => "");
      setApiKeyInput(stored);
      setStoredKey(stored);
      setPermission(await micPermissionState());
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
    // getUserMedia が通っただけでは永続化されたとは限らないので、状態を読み直す
    const state = await micPermissionState();
    setPermission(state);
    if (ok && state === "granted") {
      setMics(await listMicrophones().catch(() => []));
      setGrantError(undefined);
    } else if (ok) {
      // getUserMedia は通ったのに永続化されていない = 「今回のみ許可」を選んだ
      setGrantError(
        `許可されましたが永続化されていません (permission: ${state})。` +
          `このままだと字幕開始時に offscreen document から使えません。` +
          `プロンプトで「常に許可」を選ぶか、下の「Chrome のサイト設定を開く」でマイクを「許可」にしてください。`,
      );
    } else {
      // 一度拒否すると Chrome は再プロンプトしない。行き止まりにしない。
      setGrantError(
        `許可されませんでした (permission: ${state})。アドレスバー左のアイコン、または` +
          ` chrome://settings/content/microphone からこの拡張のマイクを許可してください。`,
      );
    }
  };

  /** モデル名の当て推量をやめる。鍵で使える Live 対応モデルを API から引く。 */
  const loadLiveModels = async () => {
    setModelsError(undefined);
    setLiveModels(null);
    if (!storedKey) return setModelsError("先に API Key を保存してください");
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=500&key=${encodeURIComponent(storedKey)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      const names = ((json.models ?? []) as Array<{
        name: string;
        supportedGenerationMethods?: string[];
      }>)
        .filter((m) => m.supportedGenerationMethods?.includes("bidiGenerateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      setLiveModels(names);
      if (names.length === 0) setModelsError("この API Key で使える Live 対応モデルがありません");
    } catch (e) {
      setModelsError(`取得に失敗: ${(e as Error).message}`);
    }
  };

  /** 1 文字ごとに保存すると途中の値が生きてしまうので、入力が止まってから書く */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onApiKeyChange = (value: string) => {
    setApiKeyInput(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await setApiKey(value.trim());
      setStoredKey(await getApiKey().catch(() => ""));
      flash();
    }, 600);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Live Subtitles</h1>
        <div className="note">変更は自動で保存されます</div>
      </div>
      {saved && <div className="toast">保存しました</div>}

      <section className="card">
        <h2>Translation</h2>
        <Field
          label="Gemini API Key"
          hint="必須。For local development only. Do not distribute builds containing your API key."
        >
          <div className="stack" style={{ alignItems: "stretch" }}>
            <input
              type="password"
              value={apiKey}
              placeholder="AIza..."
              // blur 待ちだと「入力したのに保存されていない」、1 文字ごとだと途中の値が
              // 生きてしまう。入力が止まってから書く。
              onChange={(e) => onApiKeyChange(e.target.value)}
              onBlur={(e) => onApiKeyChange(e.target.value)}
            />
            <div className="note">
              {storedKey
                ? `保存済み: ${storedKey.slice(0, 6)}…${storedKey.slice(-4)} (${storedKey.length} 文字)`
                : "未保存"}
            </div>
          </div>
        </Field>
        <Field label="Provider" hint="Web Speech 側は Chrome 内蔵の音声認識を使うぶん安く済みます">
          <select
            value={settings.provider}
            onChange={(e) =>
              update({ provider: e.target.value as Settings["provider"] })
            }
          >
            <option value="gemini-live-translation">Gemini Live Translation</option>
            <option value="webspeech-gemini-text">
              Web Speech (Chrome 内蔵) + Gemini テキスト翻訳
            </option>
          </select>
        </Field>
        <Field label="Model" hint="API Key で使える Live 対応モデルを取得して選べます">
          <div className="stack" style={{ alignItems: "stretch" }}>
            <input
              type="text"
              list="live-models"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
            />
            <datalist id="live-models">
              {(liveModels ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div>
              <button className="btn" onClick={loadLiveModels}>
                使える Live モデルを取得
              </button>
            </div>
            {modelsError && <div className="error">{modelsError}</div>}
            {liveModels && liveModels.length > 0 && (
              <div className="model-list">
                {liveModels.map((m) => (
                  <div key={m} className="row">
                    <button className="link" onClick={() => update({ model: m })}>
                      使う
                    </button>
                    <code>{m}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field
          label="Source Language"
          hint="Gemini Live Translation は入力言語を自動判定します。この値は表示と将来の Provider 用です"
        >
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
      </section>

      <section className="card">
        <h2>Microphone</h2>
        <Field label="Device">
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
        <Field
          label="Permission"
          hint="字幕は offscreen document から録音するため「常に許可」が必要です。「今回のみ許可」はページを閉じると失効します"
        >
          <div className="stack">
            <div className="row">
              {permission === "granted" ? (
                <span className="row" style={{ color: "var(--ok)", fontWeight: 500 }}>
                  <span className="dot ok" />
                  マイク許可済み
                </span>
              ) : (
                <button className="btn btn-primary" onClick={grant}>
                  マイクを許可する
                </button>
              )}
              <button
                className="btn"
                onClick={openMicSiteSettings}
                title="chrome://settings/content/siteDetails でこの拡張のマイクを「許可」に固定する"
              >
                Chrome のサイト設定を開く
              </button>
            </div>
            {/* 権限は拡張 ID ごと。dev ビルドと本ビルドでは別扱いになる */}
            <div className="note">
              permission: {permission} / extension: <code>{chrome.runtime.id}</code>
            </div>
            {grantError && <div className="error">{grantError}</div>}
          </div>
        </Field>
      </section>

      <section className="card">
        <h2>Subtitle</h2>
        <Field label="Font Size" value={`${settings.fontSize}px`}>
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
            <option value="bottom">Bottom</option>
            <option value="top">Top</option>
          </select>
        </Field>
        <Field label="Background Opacity" value={settings.opacity.toFixed(2)}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
          />
        </Field>
        <Field label="Width" value={`${settings.width}vw`}>
          <input
            type="range"
            min={40}
            max={100}
            value={settings.width}
            onChange={(e) => update({ width: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max Lines" hint="溢れた古い行は上へ流れて消えます">
          <input
            type="number"
            min={1}
            max={5}
            value={settings.maxLines}
            onChange={(e) => update({ maxLines: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Clear After"
          value={`${(settings.holdMs / 1000).toFixed(1)}s`}
          hint="更新が途切れてから字幕を消すまでの時間"
        >
          <input
            type="range"
            min={500}
            max={6000}
            step={250}
            value={settings.holdMs}
            onChange={(e) => update({ holdMs: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Min Line Time"
          value={`${(settings.dwellMs / 1000).toFixed(1)}s`}
          hint="確定した文を次の文に押し出されるまで最低限置いておく時間。0 で無効"
        >
          <input
            type="range"
            min={0}
            max={5000}
            step={250}
            value={settings.dwellMs}
            onChange={(e) => update({ dwellMs: Number(e.target.value) })}
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
      </section>

      <section className="card">
        <h2>Advanced</h2>
        <Field label="Show Latency" hint="字幕の下に遅延を表示する">
          <Switch
            checked={settings.showLatency}
            onChange={(v) => update({ showLatency: v })}
          />
        </Field>
        <Field label="Debug Mode" hint="Popup に Input / Output / Audio を表示する">
          <Switch checked={settings.debug} onChange={(v) => update({ debug: v })} />
        </Field>
        <Field label="Log Gemini Events">
          <Switch
            checked={settings.logProviderEvents}
            onChange={(v) => update({ logProviderEvents: v })}
          />
        </Field>
        <Field label="Echo Target Language" hint="翻訳音声側の設定。MVP では字幕に影響しない">
          <Switch
            checked={settings.echoTargetLanguage}
            onChange={(v) => update({ echoTargetLanguage: v })}
          />
        </Field>
      </section>

      {/* spec2 §41 */}
      <p className="note">
        Audio will be streamed to Google Gemini for real-time translation.
        Stop を押すと MediaStream / WebSocket / AudioContext / AudioWorklet をすべて停止します。
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  children,
}: {
  label: string;
  hint?: string;
  /** スライダーなどの現在値。ラベル横にバッジで出す */
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {value && <span className="badge">{value}</span>}
      </div>
      {hint && <div className="field-hint">{hint}</div>}
      <div className="field-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}
