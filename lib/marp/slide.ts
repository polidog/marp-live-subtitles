/** spec §22, §23, §24 — 現在スライドの検出とコンテキスト抽出 */
import type { SlideContext } from "../../types";
import { findSlideElements } from "./detector";

const MAX_TEXT = 1500;

function isActive(el: HTMLElement): boolean {
  // svg 要素の className は SVGAnimatedString なので属性から読む
  const cls = el.getAttribute("class") ?? "";
  if (/(^|[\s-])(active|current)([\s-]|$)/.test(cls)) return true;
  if (el.getAttribute("aria-hidden") === "false") return true;
  return false;
}

/** viewport との重なり面積。bare template（縦スクロール表示）用のフォールバック。 */
function visibleArea(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
}

export function getActiveSlide(): { el: HTMLElement; index: number } | null {
  const slides = findSlideElements();
  if (slides.length === 0) return null;

  const marked = slides.filter(isActive);
  if (marked.length > 0) {
    const el = marked[0];
    return { el, index: slides.indexOf(el) };
  }

  let best = 0;
  let bestArea = -1;
  slides.forEach((el, i) => {
    const a = visibleArea(el);
    if (a > bestArea) {
      bestArea = a;
      best = i;
    }
  });
  return { el: slides[best], index: best };
}

export function extractContext(el: HTMLElement, index: number): SlideContext {
  // svg[data-marpit-svg] の場合、実際の中身は foreignObject 配下の section
  const section = el.querySelector<HTMLElement>("section") ?? el;

  const codeBlocks = Array.from(section.querySelectorAll("pre"))
    .map((p) => (p.textContent ?? "").trim())
    .filter(Boolean);

  // 本文は code を除いた地の文
  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("pre").forEach((p) => p.remove());

  const text = (clone.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

  const heading = section.querySelector("h1, h2, h3");

  return {
    index,
    title: heading?.textContent?.trim() || undefined,
    text,
    codeBlocks: codeBlocks.map((c) => c.slice(0, 500)),
  };
}

export function getSlideContext(): SlideContext | null {
  const active = getActiveSlide();
  return active ? extractContext(active.el, active.index) : null;
}

/**
 * スライド変更を監視する (spec §24)。
 * hashchange（bespoke のページ送り）+ 属性変化 + scroll を rAF でまとめる。
 */
export function watchSlideChange(cb: (ctx: SlideContext) => void): () => void {
  let lastIndex = -1;
  let lastText = "";
  let scheduled = false;

  const check = () => {
    scheduled = false;
    const ctx = getSlideContext();
    if (!ctx) return;
    if (ctx.index === lastIndex && ctx.text === lastText) return;
    lastIndex = ctx.index;
    lastText = ctx.text;
    cb(ctx);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(check);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "aria-hidden", "style", "data-bespoke-marp-current"],
  });

  addEventListener("hashchange", schedule);
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });

  schedule();

  return () => {
    observer.disconnect();
    removeEventListener("hashchange", schedule);
    removeEventListener("scroll", schedule);
    removeEventListener("resize", schedule);
  };
}
