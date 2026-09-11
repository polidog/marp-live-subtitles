/**
 * 設定の永続化 (spec §27 / spec2 §31-§33)。API Key は content script へ渡さないため別キーにする。
 *
 * wxt/storage は使わない。storage.defineItem() が定義した瞬間に driver.getItem() を
 * 走らせる（catch なし）ため、chrome.storage が無い context ——拡張リロードで孤児に
 * なった content script など—— では import しただけで例外になる。
 * ここで必要なのは get / set / watch だけなので chrome.storage.local を直接使う。
 */
import { isStorageAvailable } from "../lib/extension";
import { DEFAULT_TRANSLATION_MODEL } from "../lib/translation/provider";
import type { Settings } from "../types";

const SETTINGS_KEY = "settings";
/** spec2 §12, §32, §33 — Development Mode 専用。extension context からのみ読む。 */
const API_KEY = "geminiApiKey";

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

export async function getSettings(): Promise<Settings> {
  if (!isStorageAvailable()) return DEFAULT_SETTINGS;
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    // 設定項目が増えても壊れないよう既定値とマージする
    return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  if (isStorageAvailable()) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  }
  return next;
}

/** 設定変更を購読する。解除関数を返す。 */
export function watchSettings(cb: (s: Settings) => void): () => void {
  if (!isStorageAvailable()) return () => {};

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    cb({
      ...DEFAULT_SETTINGS,
      ...(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined),
    });
  };

  try {
    chrome.storage.onChanged.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* context 失効後は解除する対象もない */
    }
  };
}

/** 読めなかった場合は握りつぶさず投げる。「未設定」と「読めなかった」は別物。 */
export async function getApiKey(): Promise<string> {
  if (!isStorageAvailable()) {
    throw new Error(`chrome.storage が使えません (extension: ${chrome.runtime?.id})`);
  }
  return ((await chrome.storage.local.get(API_KEY))[API_KEY] as string) ?? "";
}

export async function setApiKey(value: string): Promise<void> {
  if (!isStorageAvailable()) return;
  await chrome.storage.local.set({ [API_KEY]: value });
}
