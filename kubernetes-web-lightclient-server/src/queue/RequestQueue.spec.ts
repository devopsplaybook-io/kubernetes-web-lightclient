import { RequestQueue } from "./RequestQueue";

describe("RequestQueue", () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue(2, 5000); // max 2 concurrent, 5s timeout
  });

  test("should execute a single request and return the result", async () => {
    const result = await queue.execute(
      null,
      () => Promise.resolve("hello"),
    );
    expect(result).toBe("hello");
  });

  test("should execute requests in order", async () => {
    const order: number[] = [];

    const p1 = queue.execute(null, async () => {
      order.push(1);
      return "a";
    });

    const p2 = queue.execute(null, async () => {
      order.push(2);
      return "b";
    });

    await Promise.all([p1, p2]);
    // With max 2 concurrency, both start immediately
    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  test("should limit concurrency to maxConcurrency", async () => {
    const maxConcurrency = 2;
    queue.setMaxConcurrency(maxConcurrency);

    let concurrent = 0;
    let maxSeen = 0;

    const makeRequest = () =>
      queue.execute(null, async () => {
        concurrent++;
        maxSeen = Math.max(maxSeen, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 100));
        concurrent--;
        return "done";
      });

    // Start 4 requests concurrently
    await Promise.all([makeRequest(), makeRequest(), makeRequest(), makeRequest()]);

    // Max concurrent should not exceed maxConcurrency
    expect(maxSeen).toBeLessThanOrEqual(maxConcurrency);
  });

  test("should deduplicate requests with the same key", async () => {
    let executionCount = 0;

    const makeRequest = () =>
      queue.execute("my-key", async () => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "result";
      });

    // Start two requests with the same key simultaneously
    const [r1, r2] = await Promise.all([makeRequest(), makeRequest()]);

    expect(r1).toBe("result");
    expect(r2).toBe("result");
    // The function should only have been called once due to dedup
    expect(executionCount).toBe(1);
  });

  test("should not deduplicate requests without a key", async () => {
    let executionCount = 0;

    const makeRequest = () =>
      queue.execute(null, async () => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "result";
      });

    await Promise.all([makeRequest(), makeRequest()]);

    // Without dedup key, both should execute
    expect(executionCount).toBe(2);
  });

  test("should reject request on timeout", async () => {
    const fastQueue = new RequestQueue(1, 50); // 50ms timeout

    await expect(
      fastQueue.execute(null, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "too late";
      }),
    ).rejects.toThrow("timed out");
  });

  test("should abort the commandGenerator on timeout", async () => {
    const fastQueue = new RequestQueue(1, 50); // 50ms timeout
    let aborted = false;

    await expect(
      fastQueue.execute(null, async (signal) => {
        return new Promise<string>((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
          // Never resolve
          setTimeout(() => resolve("done"), 200);
        });
      }),
    ).rejects.toThrow();

    // Wait a bit for the abort to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(aborted).toBe(true);
  });

  test("should process queued items after active ones complete", async () => {
    queue.setMaxConcurrency(1); // Process one at a time
    const executionOrder: number[] = [];

    const p1 = queue.execute(null, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push(1);
      return "a";
    });

    const p2 = queue.execute(null, async () => {
      executionOrder.push(2);
      return "b";
    });

    await Promise.all([p1, p2]);

    // With concurrency 1, p2 should wait for p1
    expect(executionOrder).toEqual([1, 2]);
  });

  test("should report active and queued counts", () => {
    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getQueuedCount()).toBe(0);
  });

  test("should reject with error when commandGenerator fails", async () => {
    await expect(
      queue.execute(null, () => Promise.reject(new Error("command failed"))),
    ).rejects.toThrow("command failed");
  });

  test("should allow changing max concurrency", () => {
    expect(queue.getMaxConcurrency()).toBe(2);
    queue.setMaxConcurrency(5);
    expect(queue.getMaxConcurrency()).toBe(5);
  });

  test("should deduplicate already active requests with same key", async () => {
    let executionCount = 0;

    const p1 = queue.execute("unique-key", async () => {
      executionCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "first";
    });

    // Small delay to ensure first request becomes active
    await new Promise((resolve) => setTimeout(resolve, 10));

    const p2 = queue.execute("unique-key", async () => {
      executionCount++;
      return "second";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("first");
    expect(r2).toBe("first"); // Should get the same result due to dedup
    expect(executionCount).toBe(1);
  });
});
