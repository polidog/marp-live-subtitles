/** spec §9 — Marp 検出。単一 selector に依存せずスコアで判定する。 */
import type { MarpDetection } from "../../types";

const SIGNALS = [
  "svg[data-marpit-svg]",
  "[data-marpit-fragment]",
  "[data-marpit-fragments]",
  "svg[data-marp-fitting]",
  "foreignObject > section",
  ".marpit",
  ".bespoke-marp-parent",
  ".bespoke-marp-osc",
  'meta[name="generator"][content*="Marp" i]',
];

/** Marp のスライド要素候補を、表示順で返す。 */
export function findSlideElements(root: ParentNode = document): HTMLElement[] {
  const svgs = Array.from(
    root.querySelectorAll<HTMLElement>("svg[data-marpit-svg]"),
  );
  if (svgs.length > 0) return svgs;

  const scoped = Array.from(
    root.querySelectorAll<HTMLElement>(".marpit > section, .marpit section"),
  );
  if (scoped.length > 0) return scoped;

  return Array.from(root.querySelectorAll<HTMLElement>("body > section"));
}

export function detectMarp(root: ParentNode = document): MarpDetection {
  const hits = SIGNALS.filter((sel) => {
    try {
      return root.querySelector(sel) != null;
    } catch {
      return false;
    }
  }).length;

  const slides = findSlideElements(root);
  // シグナル 2 つ以上、または「スライドらしい要素 + シグナル 1 つ」で Marp とみなす
  const detected = hits >= 2 || (hits >= 1 && slides.length > 0);

  return { detected, slideCount: slides.length };
}
