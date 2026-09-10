/**
 * spec §23 / spec2 §27-§29 — スライドから Local Context State を作る。
 *
 * Gemini Live Translate は翻訳専用モデルで context injection を前提にできないため、
 * ここで作った context は Provider へ「渡すだけ」に留める（Provider 側の capability 次第で使う）。
 */
import type { PresentationContext, SlideContext } from "../../types";

const MAX_KEYWORDS = 30;

/** 製品名・ライブラリ名・識別子っぽいトークンを拾う */
const TOKEN = /\b[A-Z][A-Za-z0-9]{2,}(?:[.\-_][A-Za-z0-9]+)*\b|\b[a-z]+(?:\.[a-z][A-Za-z0-9]+)+\b/g;

export function extractKeywords(slide: SlideContext): string[] {
  const source = [slide.title ?? "", slide.text, ...slide.codeBlocks].join(" ");
  const seen = new Set<string>();

  for (const match of source.matchAll(TOKEN)) {
    const token = match[0];
    if (seen.size >= MAX_KEYWORDS) break;
    seen.add(token);
  }
  return [...seen];
}

export function toPresentationContext(slide: SlideContext): PresentationContext {
  return { slide, keywords: extractKeywords(slide) };
}
