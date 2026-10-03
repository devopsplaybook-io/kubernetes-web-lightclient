import * as childProcess from "child_process";
import * as zlib from "zlib";
import { RequestQueueGetInstance } from "../queue/RequestQueue";

export function CompressOutput(stdout: string): string {
  return zlib.gzipSync(Buffer.from(stdout, "utf8")).toString("base64");
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
    const queue = RequestQueueGetInstance();
    return queue.execute(
      `get:${objectType}`,
      (signal) => this.runCommand(args, signal).then(CompressOutput),
      timeout,
    );
  }

  /**
   * Execute a kubectl command from an argument vector without deduplication.
   * The caller is responsible for building a validated argument vector.
   * Returns base64-encoded gzip-compressed output.
   */
  public executeCommand(args: string[], timeout?: number): Promise<string> {
    const queue = RequestQueueGetInstance();
    return queue.execute(
      null,
      (signal) => this.runCommand(args, signal).then(CompressOutput),
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
          maxBuffer: 1024 * 1024 * 10,
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
