import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("RequestQueue");

interface QueueItem {
  key: string | null;
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  commandGenerator: (signal: AbortSignal) => Promise<string>;
  timeout: number;
  addedAt: number;
  deadlineAt: number;
  timer: NodeJS.Timeout | null;
  settled: boolean;
  controller: AbortController | null;
}

interface ActiveRequest {
  key: string | null;
  promise: Promise<string>;
  controller: AbortController;
}

/**
 * Raised when a request cannot be accepted because the waiting queue is at
 * its configured cap. Callers map it to an HTTP 429.
 */
export class RequestQueueFullError extends Error {
  public readonly code = "REQUEST_QUEUE_FULL";
  public readonly statusCode = 429;

  constructor(message = "Request queue is full") {
    super(message);
    this.name = "RequestQueueFullError";
  }
}

export function IsRequestQueueFullError(error: unknown): boolean {
  if (error instanceof RequestQueueFullError) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "REQUEST_QUEUE_FULL"
  );
}

export class RequestQueue {
  private maxConcurrency: number;
  private defaultTimeout: number;
  private maxQueueLength: number;
  private queue: QueueItem[];
  private active: Map<string, ActiveRequest>;
  private activeCount: number;

  constructor(
    maxConcurrency: number = 2,
    defaultTimeout: number = 20000,
    maxQueueLength: number = 20,
  ) {
    this.maxConcurrency = maxConcurrency;
    this.defaultTimeout = defaultTimeout;
    this.maxQueueLength = maxQueueLength;
    this.queue = [];
    this.active = new Map();
    this.activeCount = 0;
  }

  public execute(
    key: string | null,
    commandGenerator: (signal: AbortSignal) => Promise<string>,
    timeout?: number,
  ): Promise<string> {
    const effectiveTimeout = timeout ?? this.defaultTimeout;

    // Deduplication: if key is provided and a request with the same key is
    // already active or queued, return the existing promise. Deduplicated
    // joins are allowed even when the waiting queue is full.
    if (key !== null && key !== undefined) {
      // Check active requests
      const activeReq = this.active.get(key);
      if (activeReq) {
        logger.info(`Request dedup (active): ${key}`);
        return activeReq.promise;
      }
      // Check queued requests (look for the same key in queue)
      const queuedItem = this.queue.find((item) => item.key === key);
      if (queuedItem) {
        logger.info(`Request dedup (queued): ${key}`);
        return queuedItem.promise;
      }
    }

    // The cap counts waiting items only: active requests are bounded by
    // maxConcurrency, and deduplicated joins are handled above.
    if (this.queue.length >= this.maxQueueLength) {
      logger.warn(
        `Request queue full (${this.maxQueueLength} waiting): rejecting request`,
      );
      return Promise.reject(
        new RequestQueueFullError(
          `Request queue is full (${this.maxQueueLength} waiting requests)`,
        ),
      );
    }

    // Create the promise that will be returned to the caller.
    // resolve/reject are stored in the QueueItem and called from executeItem.
    const now = Date.now();
    const item: QueueItem = {
      key,
      promise: null as unknown as Promise<string>,
      resolve: null as unknown as (value: string) => void,
      reject: null as unknown as (error: Error) => void,
      commandGenerator,
      timeout: effectiveTimeout,
      addedAt: now,
      deadlineAt: now + effectiveTimeout,
      timer: null,
      settled: false,
      controller: null,
    };

    const promise = new Promise<string>((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
    });
    item.promise = promise;

    // The deadline is measured from enqueue time, so time spent waiting in
    // the queue counts against the request timeout.
    item.timer = setTimeout(
      () => this.handleItemTimeout(item),
      effectiveTimeout,
    );

    this.queue.push(item);
    this.processQueue();

    return promise;
  }

  private processQueue(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.executeItem(item);
    }
  }

  private executeItem(item: QueueItem): void {
    if (item.settled) {
      return;
    }
    if (item.deadlineAt <= Date.now()) {
      this.settle(item);
      item.reject(new Error(`Request timed out after ${item.timeout}ms`));
      return;
    }

    const controller = new AbortController();
    item.controller = controller;
    this.activeCount++;

    const activeReq: ActiveRequest = {
      key: item.key,
      promise: item.promise,
      controller,
    };

    if (item.key !== null && item.key !== undefined) {
      this.active.set(item.key, activeReq);
    }

    item
      .commandGenerator(controller.signal)
      .then((result) => {
        if (item.settled) {
          return;
        }
        this.settle(item);
        item.resolve(result);
      })
      .catch((error) => {
        if (item.settled) {
          return;
        }
        this.settle(item);
        item.reject(error);
      })
      .finally(() => {
        item.controller = null;
        this.activeCount--;
        if (item.key !== null && item.key !== undefined) {
          this.active.delete(item.key);
        }
        this.processQueue();
      });
  }

  private handleItemTimeout(item: QueueItem): void {
    if (item.settled) {
      return;
    }
    item.timer = null;
    const error = new Error(`Request timed out after ${item.timeout}ms`);

    // Still waiting: drop it from the queue and fail it without running.
    const queuedIndex = this.queue.indexOf(item);
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1);
      item.settled = true;
      item.reject(error);
      this.processQueue();
      return;
    }

    // Already running: abort the child process and settle the promise now,
    // even if the command generator ignores the abort signal.
    item.settled = true;
    if (item.controller) {
      item.controller.abort(error);
    }
    item.reject(error);
  }

  private settle(item: QueueItem): void {
    item.settled = true;
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueuedCount(): number {
    return this.queue.length;
  }

  public getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  public getMaxQueueLength(): number {
    return this.maxQueueLength;
  }

  public setMaxConcurrency(concurrency: number): void {
    this.maxConcurrency = concurrency;
    this.processQueue();
  }
}

// Singleton instance
let instance: RequestQueue | null = null;

export function RequestQueueGetInstance(): RequestQueue {
  if (!instance) {
    instance = new RequestQueue();
  }
  return instance;
}

export function RequestQueueInit(
  maxConcurrency: number,
  defaultTimeout: number,
  maxQueueLength: number = 20,
): RequestQueue {
  instance = new RequestQueue(maxConcurrency, defaultTimeout, maxQueueLength);
  return instance;
}
