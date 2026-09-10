/** 設定の永続化 (spec §27 / spec2 §31-§33)。API Key は content script へ渡さないため別アイテムにする。 */
import { storage } from "wxt/utils/storage";
import { DEFAULT_TRANSLATION_MODEL } from "../lib/translation/provider";
import type { Settings } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  sourceLang: "ja",
  targetLang: "en",
  micDeviceId: "",

  fontSize: 40,
  position: "bottom",
  opacity: 0.65,
  width: 80,
  maxLines: 2,
  mode: "translation",

  provider: "gemini-live-translation",
  model: DEFAULT_TRANSLATION_MODEL,
  echoTargetLanguage: false,
  // spec2 §26 — MVP では翻訳音声を再生しない
  enableTranslatedAudio: false,

  debug: false,
  showLatency: true,
  logProviderEvents: false,
};

export const settingsItem = storage.defineItem<Settings>("local:settings", {
  // 設定項目が増えても壊れないよう、読み出し時に既定値とマージする (getSettings)
  fallback: DEFAULT_SETTINGS,
});

/**
 * spec2 §12, §32, §33 — Development Mode 専用の Gemini API Key。
 * extension context (offscreen / options) からのみ読む。
 */
export const apiKeyItem = storage.defineItem<string>("local:geminiApiKey", {
  fallback: "",
});

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

/** 設定変更を購読する。解除関数を返す。 */
export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch((v) => cb({ ...DEFAULT_SETTINGS, ...(v ?? undefined) }));
}
