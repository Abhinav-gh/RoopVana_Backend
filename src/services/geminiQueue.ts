/**
 * Gemini API Request Queue
 *
 * A concurrency limiter that ensures we don't exceed Gemini's rate limits.
 * Requests beyond the max concurrent limit wait in a FIFO queue.
 *
 * Gemini 2.5 Flash Image (Tier 1): ~10 RPM
 * With ~30s per generation, 4 concurrent ≈ ~8 RPM (safe margin).
 */

import config from '../config/env';

interface QueuedTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

class GeminiQueue {
  private maxConcurrent: number;
  private activeCount: number = 0;
  private queue: QueuedTask<any>[] = [];

  constructor() {
    this.maxConcurrent = config.geminiMaxConcurrent;
    console.log(`🚦 Gemini queue initialized (max concurrent: ${this.maxConcurrent})`);
  }

  /**
   * Returns current queue status
   */
  getStatus(): { activeCount: number; queuedCount: number; maxConcurrent: number } {
    return {
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Enqueue an async function to be executed when a slot is available.
   * Returns the result of the function.
   * If a slot is available immediately, executes right away.
   * Otherwise, waits in a FIFO queue.
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    // If we have capacity, run immediately
    if (this.activeCount < this.maxConcurrent) {
      return this.execute(fn);
    }

    // Otherwise, queue and wait
    console.log(`⏳ Gemini request queued (active: ${this.activeCount}/${this.maxConcurrent}, queued: ${this.queue.length + 1})`);

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
    });
  }

  /**
   * Execute a function, tracking active count, and process next in queue when done.
   */
  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.activeCount++;
    console.log(`🔄 Gemini request processing (active: ${this.activeCount}/${this.maxConcurrent}, queued: ${this.queue.length})`);

    try {
      const result = await fn();
      return result;
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  /**
   * Process the next task in the queue, if any.
   */
  private processNext(): void {
    if (this.queue.length === 0) return;

    const next = this.queue.shift()!;
    this.execute(next.fn)
      .then(next.resolve)
      .catch(next.reject);
  }
}

// Singleton instance
const geminiQueue = new GeminiQueue();
export default geminiQueue;
