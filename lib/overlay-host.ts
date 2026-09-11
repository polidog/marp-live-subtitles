/**
 * spec §28 — fullscreen 中は fullscreen element の配下でないと描画されない。
 * 字幕の host 要素を、いま全画面になっている要素へ移し続ける。解除関数を返す。
 */
export function followFullscreen(host: HTMLElement): () => void {
  const relocate = () => {
    const fs = document.fullscreenElement;
    // ponytail: <video> 等の非 HTMLElement が fullscreen の場合は移動できない。
    // Marp の bespoke テンプレートは div を fullscreen にするので実害なし。
    const target = fs instanceof HTMLElement ? fs : document.body;
    if (host.parentElement !== target) target.appendChild(host);
  };
  relocate();
  document.addEventListener("fullscreenchange", relocate);
  return () => document.removeEventListener("fullscreenchange", relocate);
}
