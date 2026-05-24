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
}

interface ActiveRequest {
  key: string | null;
  promise: Promise<string>;
  controller: AbortController;
}

export class RequestQueue {
  private maxConcurrency: number;
  private defaultTimeout: number;
  private queue: QueueItem[];
  private active: Map<string, ActiveRequest>;
  private activeCount: number;
  private keyedPromises: Map<string, Promise<string>>;

  constructor(maxConcurrency: number = 2, defaultTimeout: number = 20000) {
    this.maxConcurrency = maxConcurrency;
    this.defaultTimeout = defaultTimeout;
    this.queue = [];
    this.active = new Map();
    this.activeCount = 0;
    this.keyedPromises = new Map();
  }

  public execute(
    key: string | null,
    commandGenerator: (signal: AbortSignal) => Promise<string>,
    timeout?: number,
  ): Promise<string> {
    const effectiveTimeout = timeout ?? this.defaultTimeout;

    // Deduplication: if key is provided and a request with the same key is
    // already active or queued, return the existing promise
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

    // Create the promise that will be returned to the caller.
    // resolve/reject are stored in the QueueItem and called from executeItem.
    const item: QueueItem = {
      key,
      promise: null as unknown as Promise<string>,
      resolve: null as unknown as (value: string) => void,
      reject: null as unknown as (error: Error) => void,
      commandGenerator,
      timeout: effectiveTimeout,
      addedAt: Date.now(),
    };

    const promise = new Promise<string>((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
    });
    item.promise = promise;

    // If keyed, store promise for dedup
    if (key !== null && key !== undefined) {
      const finalize = () => {
        this.keyedPromises.delete(key);
      };
      promise.then(finalize, finalize);
      this.keyedPromises.set(key, promise);
    }

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
    const controller = new AbortController();
    this.activeCount++;

    const activeKey = item.key || `__nonkey_${Date.now()}_${Math.random()}`;
    const activeReq: ActiveRequest = {
      key: item.key,
      promise: item.promise,
      controller,
    };

    if (item.key !== null && item.key !== undefined) {
      this.active.set(item.key, activeReq);
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${item.timeout}ms`));
      // Reject the promise immediately when timeout fires,
      // even if the command generator doesn't check the abort signal
      item.reject(new Error(`Request timed out after ${item.timeout}ms`));
    }, item.timeout);

    item
      .commandGenerator(controller.signal)
      .then((result) => {
        clearTimeout(timeoutId);
        item.resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        item.reject(error);
      })
      .finally(() => {
        this.activeCount--;
        if (item.key !== null && item.key !== undefined) {
          this.active.delete(item.key);
        }
        this.processQueue();
      });
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
): RequestQueue {
  instance = new RequestQueue(maxConcurrency, defaultTimeout);
  return instance;
}
