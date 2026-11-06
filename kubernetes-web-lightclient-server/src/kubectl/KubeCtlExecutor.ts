import * as childProcess from "child_process";
import * as crypto from "crypto";
import { promisify } from "util";
import * as zlib from "zlib";
import { RequestQueueGetInstance } from "../queue/RequestQueue";

const gzip = promisify(zlib.gzip);

/**
 * Compress kubectl stdout for transport. Asynchronous on purpose: synchronous
 * gzip of multi-megabyte listings blocks the Node event loop.
 */
export async function CompressOutput(stdout: string): Promise<string> {
  const compressed = await gzip(Buffer.from(stdout, "utf8"));
  return compressed.toString("base64");
}

/**
 * Deduplication key for a kubectl argument vector. Only read-only commands
 * are coalesced; side-effect commands (delete, scale, create, ...) must
 * never share an execution.
 */
export function DedupKeyFor(args: string[]): string | null {
  if (args.length > 0 && args[0] === "logs") {
    // Hash the full argv: identical log requests coalesce, while different
    // pods/containers/--since values stay distinct. Pod names never appear
    // in queue keys (they are logged by the queue).
    return (
      "logs:" +
      crypto
        .createHash("sha256")
        .update(args.join("\u0000"))
        .digest("hex")
        .slice(0, 16)
    );
  }
  if (
    args.length === 5 &&
    args[0] === "get" &&
    args[2] === "-A" &&
    args[3] === "-o" &&
    args[4] === "json"
  ) {
    return `get:${args[1]}`;
  }
  return null;
}

/**
 * Detects kubectl "object not found" failures. kubectl prints the API error
 * to stderr, e.g. `Error from server (NotFound): pods "x" not found`.
 */
export function IsKubeObjectNotFoundError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const stderr = (error as { stderr?: unknown }).stderr;
  if (stderr) {
    const stderrText = Buffer.isBuffer(stderr)
      ? stderr.toString("utf8")
      : String(stderr);
    if (stderrText.includes("(NotFound)")) {
      return true;
    }
  }
  return error instanceof Error && error.message.includes("(NotFound)");
}

export class KubeCtlExecutor {
  /**
   * Execute a kubectl get for a full list of objects of a type.
   * Uses the request queue with deduplication by object type.
   * Returns base64-encoded gzip-compressed JSON.
   */
  public executeGetRequest(
    objectType: string,
    timeout?: number,
  ): Promise<string> {
    // Always fetch all namespaces - filtering is done on the client side
    const args = ["get", objectType, "-A", "-o", "json"];
    return this.enqueue(args, timeout, `get:${objectType}`).then(
      CompressOutput,
    );
  }

  /**
   * Execute a kubectl command from an argument vector. Read-only commands
   * are deduplicated by their argument vector.
   * Returns base64-encoded gzip-compressed output.
   */
  public executeCommand(args: string[], timeout?: number): Promise<string> {
    return this.enqueue(args, timeout, DedupKeyFor(args)).then(CompressOutput);
  }

  /**
   * Execute a kubectl command and return the raw (uncompressed) stdout.
   * Used by background work (stats captures, CRD scans) that parses JSON
   * in-process instead of shipping it to a client.
   */
  public executeRawCommand(
    args: string[],
    timeout?: number,
    key?: string | null,
  ): Promise<string> {
    return this.enqueue(
      args,
      timeout,
      key === undefined ? DedupKeyFor(args) : key,
    );
  }

  private enqueue(
    args: string[],
    timeout: number | undefined,
    key: string | null,
  ): Promise<string> {
    const queue = RequestQueueGetInstance();
    return queue.execute(
      key,
      (signal) => this.runCommand(args, signal),
      timeout,
    );
  }

  private runCommand(args: string[], signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = childProcess.execFile(
        "kubectl",
        args,
        {
          timeout: 0, // We handle timeout via AbortSignal
          // Raw `kubectl get -o json` output is buffered uncompressed before
          // in-process compression; large clusters can exceed the default.
          maxBuffer: 1024 * 1024 * 64,
        },
        (error, stdout) => {
          if (error) {
            // If the error is due to abort, reject with a clear message
            if (signal.aborted) {
              reject(
                new Error(signal.reason?.message || "Request was cancelled"),
              );
            } else {
              reject(error);
            }
          } else {
            resolve(stdout);
          }
        },
      );

      // Listen for abort signal to kill the child process
      signal.addEventListener(
        "abort",
        () => {
          child.kill("SIGTERM");
        },
        { once: true },
      );
    });
  }
}

// Singleton instance
let instance: KubeCtlExecutor | null = null;

export function KubeCtlExecutorGetInstance(): KubeCtlExecutor {
  if (!instance) {
    instance = new KubeCtlExecutor();
  }
  return instance;
}
