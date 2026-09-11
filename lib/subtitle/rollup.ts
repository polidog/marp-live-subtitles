/**
 * 行送りの最短間隔 — final を「前の final から dwellMs 以上空けて」反映する。
 *
 * 確定文が続けて届くと古い行が読む前に押し出されるので、ここで一度せき止める。
 * partial は順序を守るため同じ列に並ぶが、待っている間に来た partial は
 * 最後の 1 つだけ残す（古い partial を順に見せても意味がない）。
 */
export type RollupItem = { status: "partial" | "stable" | "final" };

export class RollupQueue<T extends RollupItem> {
  private queue: T[] = [];
  private lastFinalAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly apply: (item: T) => void;
  private readonly dwellMs: () => number;

  constructor(apply: (item: T) => void, dwellMs: () => number) {
    this.apply = apply;
    this.dwellMs = dwellMs;
  }

  push(item: T): void {
    const last = this.queue[this.queue.length - 1];
    if (last && last.status !== "final" && item.status !== "final") {
      this.queue[this.queue.length - 1] = item;
    } else {
      this.queue.push(item);
    }
    this.drain();
  }

  /** 待ちを捨てる。CLEAR と unmount 用 */
  clear(): void {
    this.queue = [];
    this.lastFinalAt = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  get pending(): number {
    return this.queue.length;
  }

  private drain(): void {
    if (this.timer) return;
    while (this.queue.length) {
      const item = this.queue[0];
      const wait =
        item.status === "final" ? this.lastFinalAt + this.dwellMs() - Date.now() : 0;
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.drain();
        }, wait);
        return;
      }
      this.queue.shift();
      if (item.status === "final") this.lastFinalAt = Date.now();
      this.apply(item);
    }
  }
}
