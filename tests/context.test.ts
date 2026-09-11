import assert from "node:assert/strict";
import test from "node:test";
import { collectKeywords, toPresentationContext } from "../lib/marp/context.ts";
import type { SlideContext } from "../types/index.ts";

const slide = (index: number, title: string, text: string, code: string[] = []): SlideContext => ({
  index,
  title,
  text,
  codeBlocks: code,
});

test("デッキ全体から用語と見出しを拾う", () => {
  const deck = [
    slide(0, "Marp Live Subtitles", "Gemini Live API で字幕を出す"),
    slide(1, "構成", "AudioWorklet で PCM16 にする", ["chrome.offscreen.createDocument()"]),
  ];
  const ctx = toPresentationContext(deck[0], deck);

  assert.deepEqual(ctx.outline, ["Marp Live Subtitles", "構成"]);
  // 現在スライドに無い 2 枚目の用語も入る（＝資料を先に渡せている）
  assert.ok(ctx.keywords.includes("AudioWorklet"));
  assert.ok(ctx.keywords.includes("chrome.offscreen.createDocument"));
});

test("deck を渡さなければ現在スライドだけ", () => {
  const ctx = toPresentationContext(slide(0, "Title", "Gemini"), []);
  assert.deepEqual(ctx.keywords, ["Title", "Gemini"]);
});

test("用語は重複させず上限で切る", () => {
  const words = collectKeywords([slide(0, "Gemini", "Gemini Gemini Marpit")], 2);
  assert.deepEqual(words, ["Gemini", "Marpit"]);
});
