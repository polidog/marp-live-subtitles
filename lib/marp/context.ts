/**
 * spec §23 / spec2 §27-§29 — スライドから Local Context State を作る。
 *
 * 現在スライドだけでなくデッキ全体から用語を拾う。これを setup の systemInstruction
 * に載せることで「資料を先に渡す」形の context injection になる（spec2 §29）。
 */
import type { PresentationContext, SlideContext } from "../../types";

const MAX_KEYWORDS = 120;
const MAX_OUTLINE = 40;

/** 製品名・ライブラリ名・識別子っぽいトークンを拾う */
const TOKEN = /\b[A-Z][A-Za-z0-9]{2,}(?:[.\-_][A-Za-z0-9]+)*\b|\b[a-z]+(?:\.[a-z][A-Za-z0-9]+)+\b/g;

export function extractKeywords(slide: SlideContext): string[] {
  return collectKeywords([slide], MAX_KEYWORDS);
}

export function collectKeywords(slides: SlideContext[], limit = MAX_KEYWORDS): string[] {
  const seen = new Set<string>();

  for (const slide of slides) {
    const source = [slide.title ?? "", slide.text, ...slide.codeBlocks].join(" ");
    for (const match of source.matchAll(TOKEN)) {
      if (seen.size >= limit) return [...seen];
      seen.add(match[0]);
    }
  }
  return [...seen];
}

/**
 * deck を渡すとデッキ全体の用語と見出しを載せる。渡さなければ現在スライドのみ。
 */
export function toPresentationContext(
  slide: SlideContext,
  deck: SlideContext[] = [],
): PresentationContext {
  const slides = deck.length > 0 ? deck : [slide];
  const outline = slides
    .map((s) => s.title)
    .filter((t): t is string => !!t)
    .slice(0, MAX_OUTLINE);

  return { slide, keywords: collectKeywords(slides), outline };
}
