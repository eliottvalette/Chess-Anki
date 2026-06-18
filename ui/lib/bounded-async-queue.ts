export class BoundedAsyncQueue {
  private activeCount = 0;
  private cancelled = false;
  private readonly maxConcurrency: number;
  private readonly queue: Array<() => Promise<void>> = [];

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  enqueue(task: () => Promise<void>): void {
    if (this.cancelled) {
      return;
    }

    this.queue.push(task);
    this.pump();
  }

  cancel(): void {
    this.cancelled = true;
    this.queue.length = 0;
  }

  private pump(): void {
    while (!this.cancelled && this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();

      if (!task) {
        return;
      }

      this.activeCount += 1;

      void task().finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }
}
