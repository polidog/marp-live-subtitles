import assert from "node:assert/strict";
import test from "node:test";
import {
  TranslationCommitter,
  type CommitterOutput,
} from "../lib/translation/committer.ts";
import type { TranscriptEvent } from "../lib/translation/types.ts";

function setup() {
  const emitted: CommitterOutput[] = [];
  const c = new TranslationCommitter({ emit: (o) => emitted.push(o) });
  return { c, emitted };
}

const out = (
  text: string,
  final = false,
  timestamp = 1000,
  latencyMs?: number,
): TranscriptEvent => ({ text, final, timestamp, latencyMs });

test("翻訳 transcript の partial がそのまま字幕になる", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today"));
  c.handleOutput(out("Today I'd like"));

  assert.deepEqual(
    emitted.map((e) => [e.text, e.status]),
    [
      ["Today", "partial"],
      ["Today I'd like", "partial"],
    ],
  );
});

test("同じ partial が 2 回続いたら stable になる", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today I'd like"));
  c.handleOutput(out("Today I'd like", false, 1001));

  assert.equal(emitted.at(-1)!.status, "stable");
});

test("duplicate suppression: 中身が変わらなければ送り直さない", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today I'd like"));
  c.handleOutput(out("Today I'd like", false, 1001)); // -> stable
  c.handleOutput(out("Today I'd like", false, 1002)); // 変化なし
  c.handleOutput(out("Today I'd like", false, 1003)); // 変化なし

  assert.equal(emitted.length, 2);
});

test("final で確定し、latency を持ち回る", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today I'd like", false, 1000, 840));
  c.handleOutput(out("Today, I'd like to introduce our new service.", true, 1200));

  const last = emitted.at(-1)!;
  assert.equal(last.status, "final");
  assert.equal(last.text, "Today, I'd like to introduce our new service.");
  assert.equal(last.latencyMs, 840);
});

test("確定より古いイベントは破棄する", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("This isn't what we developed last year.", true, 2000));
  const afterFinal = emitted.length;

  // 再接続などで遅れて届いた古い partial
  c.handleOutput(out("This is a feature we've been developing since last year...", false, 1500));

  assert.equal(emitted.length, afterFinal);
  assert.equal(emitted.at(-1)!.text, "This isn't what we developed last year.");
});

test("空の transcript で字幕を消さない (flicker reduction)", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today I'd like"));
  c.handleOutput(out("   ", false, 1001));

  assert.equal(emitted.length, 1);
  assert.equal(emitted.at(-1)!.text, "Today I'd like");
});

test("入力 transcript は original だけを更新し、翻訳字幕を壊さない", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today I'd like"));
  c.handleInput(out("今日は新しいサービスを紹介します", false, 1001));

  const last = emitted.at(-1)!;
  assert.equal(last.text, "Today I'd like");
  assert.equal(last.original, "今日は新しいサービスを紹介します");
});

test("reset 後は次のターンを最初から扱える", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Old subtitle", true, 5000));
  c.reset();
  c.handleOutput(out("New subtitle", false, 100));

  assert.equal(emitted.at(-1)!.text, "New subtitle");
  assert.equal(emitted.at(-1)!.status, "partial");
});

test("final のあとの入力は次の文の始まりで、前の翻訳を送り直さない", () => {
  const { c, emitted } = setup();
  c.handleOutput(out("Today, I'd like to introduce our new service.", true, 1200));
  c.handleInput(out("次に", false, 1300));

  const last = emitted.at(-1)!;
  assert.equal(last.text, "");
  assert.equal(last.original, "次に");
  assert.equal(last.status, "partial");
});
