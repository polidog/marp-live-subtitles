/**
 * 拡張がリロード / 更新されると、ページに残った content script は「孤児」になる。
 * その状態では chrome.runtime.id が消え、chrome.storage も undefined になり、
 * chrome.runtime.sendMessage は同期的に throw する（Promise の catch では拾えない）。
 *
 * pnpm dev は保存のたびに拡張をリロードするので、開きっぱなしのタブで日常的に起きる。
 */
export function isExtensionAlive(): boolean {
  try {
    return typeof chrome !== "undefined" && chrome.runtime?.id != null;
  } catch {
    return false;
  }
}

export function isStorageAvailable(): boolean {
  return isExtensionAlive() && chrome.storage != null;
}
