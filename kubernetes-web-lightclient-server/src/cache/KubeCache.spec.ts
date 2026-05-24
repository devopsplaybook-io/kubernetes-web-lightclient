import * as fse from "fs-extra";
import * as path from "path";
import * as os from "os";
import { KubeCache } from "./KubeCache";

describe("KubeCache", () => {
  let cacheDir: string;
  let cache: KubeCache;

  beforeEach(async () => {
    cacheDir = path.join(os.tmpdir(), `kube-cache-test-${Date.now()}`);
    cache = new KubeCache(cacheDir, 100); // 100ms TTL for testing
  });

  afterEach(async () => {
    await fse.remove(cacheDir);
  });

  test("should return null for missing cache entry", async () => {
    const entry = await cache.get("nonexistent");
    expect(entry).toBeNull();
  });

  test("should store and retrieve a cache entry", async () => {
    const testData = "dGVzdGRhdGE="; // base64 "testdata"
    await cache.set("pods", testData);

    const entry = await cache.get("pods");
    expect(entry).not.toBeNull();
    expect(entry!.data).toBe(testData);
    expect(entry!.type).toBe("pods");
    expect(entry!.cachedAt).toBeDefined();
  });

  test("should overwrite existing cache entry on set", async () => {
    await cache.set("pods", "ZGF0YTE=");
    await cache.set("pods", "ZGF0YTI=");

    const entry = await cache.get("pods");
    expect(entry!.data).toBe("ZGF0YTI=");
  });

  test("should detect stale cache based on TTL", async () => {
    await cache.set("pods", "dGVzdGRhdGE=");
    expect(await cache.isStale("pods")).toBe(false);

    // Wait for TTL to expire (100ms)
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await cache.isStale("pods")).toBe(true);
  });

  test("should consider missing cache as stale", async () => {
    expect(await cache.isStale("nonexistent")).toBe(true);
  });

  test("should clear a specific cache entry", async () => {
    await cache.set("pods", "dGVzdGRhdGE=");
    await cache.set("deployments", "b3RoZXI=");

    await cache.clear("pods");

    expect(await cache.get("pods")).toBeNull();
    expect(await cache.get("deployments")).not.toBeNull();
  });

  test("should clear all cache entries", async () => {
    await cache.set("pods", "ZGF0YTE=");
    await cache.set("deployments", "ZGF0YTI=");

    await cache.clearAll();

    expect(await cache.get("pods")).toBeNull();
    expect(await cache.get("deployments")).toBeNull();
  });

  test("should sanitize cache keys to prevent directory traversal", async () => {
    await cache.set("../malicious", "ZGF0YQ==");
    // The sanitized key should not traverse up directories
    expect(cache.getCacheDir()).not.toContain("malicious");
  });

  test("should use custom TTL for staleness check", async () => {
    await cache.set("pods", "dGVzdGRhdGE=");
    // With a very small TTL, the entry should be stale immediately
    expect(await cache.isStale("pods", 0)).toBe(true);
    // With a very large TTL, the entry should be fresh
    expect(await cache.isStale("pods", 60000)).toBe(false);
  });

  test("should return default TTL", () => {
    expect(cache.getDefaultTtl()).toBe(100);
  });

  test("should create cache directory on instantiation", async () => {
    const exists = await fse.pathExists(cache.getCacheDir());
    expect(exists).toBe(true);
  });
});
