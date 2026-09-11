import assert from "node:assert/strict";
import test from "node:test";
import { RollupQueue } from "../lib/subtitle/rollup.ts";

type Item = { status: "partial" | "final"; text: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("final は前の final から dwellMs 空けて出る。待ち中の partial は最後の 1 つだけ", async () => {
  const applied: string[] = [];
  const q = new RollupQueue<Item>((i) => applied.push(i.text), () => 60);

  q.push({ status: "final", text: "A" });
  q.push({ status: "final", text: "B" });
  q.push({ status: "partial", text: "c1" });
  q.push({ status: "partial", text: "c2" });
  assert.deepEqual(applied, ["A"]);
  assert.equal(q.pending, 2);

  await sleep(90);
  assert.deepEqual(applied, ["A", "B", "c2"]);
  assert.equal(q.pending, 0);
});

test("dwellMs 0 なら素通し", () => {
  const applied: string[] = [];
  const q = new RollupQueue<Item>((i) => applied.push(i.text), () => 0);
  q.push({ status: "final", text: "A" });
  q.push({ status: "final", text: "B" });
  assert.deepEqual(applied, ["A", "B"]);
});

test("clear で待ちを捨てる", async () => {
  const applied: string[] = [];
  const q = new RollupQueue<Item>((i) => applied.push(i.text), () => 60);
  q.push({ status: "final", text: "A" });
  q.push({ status: "final", text: "B" });
  q.clear();
  await sleep(90);
  assert.deepEqual(applied, ["A"]);
});
