import * as fse from "fs-extra";
import * as path from "path";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("KubeCache");

export interface CacheEntry {
  data: string; // base64 gzip compressed JSON
  cachedAt: string; // ISO timestamp
  type: string;
}

export class KubeCache {
  private cacheDir: string;
  private defaultTtl: number;

  constructor(dataDir: string, defaultTtl: number = 30000) {
    this.cacheDir = path.join(dataDir, "cache");
    this.defaultTtl = defaultTtl;
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    try {
      fse.ensureDirSync(this.cacheDir);
    } catch (error) {
      logger.error(
        `Failed to create cache directory: ${error.message}`,
        error,
      );
    }
  }

  private getCacheFilePath(type: string): string {
    // Sanitize type to prevent directory traversal
    const sanitized = type.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.cacheDir, `${sanitized}.json`);
  }

  public async get(type: string): Promise<CacheEntry | null> {
    const filePath = this.getCacheFilePath(type);
    try {
      if (await fse.pathExists(filePath)) {
        const entry = (await fse.readJson(filePath)) as CacheEntry;
        if (entry && entry.data && entry.cachedAt) {
          return entry;
        }
      }
    } catch (error) {
      logger.warn(`Failed to read cache for ${type}: ${error.message}`);
    }
    return null;
  }

  public async set(type: string, data: string): Promise<void> {
    const entry: CacheEntry = {
      data,
      cachedAt: new Date().toISOString(),
      type,
    };
    const filePath = this.getCacheFilePath(type);
    const tmpFilePath = `${filePath}.tmp`;
    try {
      await fse.ensureDir(this.cacheDir);
      // Write to a temporary file first, then rename so a crash mid-write
      // can never leave a truncated entry in place
      await fse.writeJson(tmpFilePath, entry, { spaces: 2 });
      await fse.rename(tmpFilePath, filePath);
      logger.info(`Cache saved for ${type} (${data.length} bytes)`);
    } catch (error) {
      logger.error(`Failed to save cache for ${type}: ${error.message}`, error);
      try {
        await fse.remove(tmpFilePath);
      } catch {
        // Best effort cleanup
      }
    }
  }

  public isStaleEntry(entry: CacheEntry | null, ttl?: number): boolean {
    if (!entry) {
      return true; // No cache means stale
    }
    const effectiveTtl = ttl ?? this.defaultTtl;
    const cachedTime = new Date(entry.cachedAt).getTime();
    const age = Date.now() - cachedTime;
    return age > effectiveTtl;
  }

  public async isStale(type: string, ttl?: number): Promise<boolean> {
    return this.isStaleEntry(await this.get(type), ttl);
  }

  public async clear(type: string): Promise<void> {
    const filePath = this.getCacheFilePath(type);
    try {
      await fse.remove(filePath);
      logger.info(`Cache cleared for ${type}`);
    } catch (error) {
      logger.warn(`Failed to clear cache for ${type}: ${error.message}`);
    }
  }

  public async clearAll(): Promise<void> {
    try {
      await fse.emptyDir(this.cacheDir);
      logger.info("All cache cleared");
    } catch (error) {
      logger.error(`Failed to clear all cache: ${error.message}`, error);
    }
  }

  public getCacheDir(): string {
    return this.cacheDir;
  }

  public getDefaultTtl(): number {
    return this.defaultTtl;
  }
}
