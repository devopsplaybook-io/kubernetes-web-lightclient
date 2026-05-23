import * as childProcess from "child_process";
import { RequestQueueGetInstance } from "../queue/RequestQueue";

export class KubeCtlExecutor {
  /**
   * Execute a kubectl command that fetches a full list of objects for a type.
   * Uses the request queue with deduplication by object type.
   * Returns base64-encoded gzip-compressed JSON.
   */
  public executeGetRequest(objectType: string, timeout?: number): Promise<string> {
    // Always fetch all namespaces - filtering is done on the client side
    const command = `kubectl get ${objectType} -A -o json | gzip | base64 -w 0`;
    const queue = RequestQueueGetInstance();
    return queue.execute(
      `get:${objectType}`,
      (signal) => this.runCommand(command, signal),
      timeout,
    );
  }

  /**
   * Execute an arbitrary kubectl command without deduplication.
   * The command should already include the full kubectl invocation and piped compression.
   */
  public executeCommand(
    fullCommand: string,
    timeout?: number,
  ): Promise<string> {
    const queue = RequestQueueGetInstance();
    return queue.execute(
      null,
      (signal) => this.runCommand(fullCommand, signal),
      timeout,
    );
  }

  private runCommand(
    command: string,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = childProcess.exec(
        command,
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
