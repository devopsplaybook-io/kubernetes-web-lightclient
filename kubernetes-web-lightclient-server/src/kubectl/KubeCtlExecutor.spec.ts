import * as zlib from "zlib";
import * as childProcess from "child_process";

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

jest.mock("../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}));

import {
  CompressOutput,
  KubeCtlExecutor,
  KubeCtlExecutorGetInstance,
} from "./KubeCtlExecutor";
import { RequestQueueInit } from "../queue/RequestQueue";

const execFileMock = childProcess.execFile as unknown as jest.Mock;

type ExecFileCallback = (error: Error | null, stdout: string) => void;

function decode(compressed: string): string {
  return zlib.gunzipSync(Buffer.from(compressed, "base64")).toString("utf8");
}

describe("KubeCtlExecutor", () => {
  let executor: KubeCtlExecutor;
  let callbacks: ExecFileCallback[];

  beforeEach(() => {
    jest.clearAllMocks();
    callbacks = [];
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        callbacks.push(callback);
        return { kill: jest.fn() };
      },
    );
    // Fresh queue so dedup state and timeouts never leak between tests
    RequestQueueInit(2, 20000);
    executor = new KubeCtlExecutor();
  });

  test("CompressOutput produces base64 gzip that decompresses to the original stdout", () => {
    const output = '{"items":[{"metadata":{"name":"my-pod"}}]}';
    expect(decode(CompressOutput(output))).toBe(output);
  });

  test("executeGetRequest runs kubectl with an argument vector and compresses the result", async () => {
    const pending = executor.executeGetRequest("pods");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "kubectl",
      ["get", "pods", "-A", "-o", "json"],
      { timeout: 0, maxBuffer: 1024 * 1024 * 64 },
      expect.any(Function),
    );

    callbacks[0](null, '{"items":[]}');
    expect(decode(await pending)).toBe('{"items":[]}');
  });

  test("buffers raw kubectl output well beyond the 1MB exec default (CRD lists exceed 10MB)", async () => {
    const pending = executor.executeGetRequest("customresourcedefinition");
    const options = execFileMock.mock.calls[0][2];
    expect(options.maxBuffer).toBeGreaterThan(17 * 1024 * 1024);
    callbacks[0](null, "x");
    await pending;
  });

  test("executeGetRequest deduplicates concurrent requests of the same type", async () => {
    const first = executor.executeGetRequest("pods");
    const second = executor.executeGetRequest("pods");
    expect(execFileMock).toHaveBeenCalledTimes(1);

    callbacks[0](null, "shared-output");
    const [a, b] = await Promise.all([first, second]);
    expect(decode(a)).toBe("shared-output");
    expect(decode(b)).toBe("shared-output");
  });

  test("does not deduplicate requests for different object types", async () => {
    const pods = executor.executeGetRequest("pods");
    const nodes = executor.executeGetRequest("nodes");
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls.map((call) => call[1][1])).toEqual([
      "pods",
      "nodes",
    ]);

    callbacks[0](null, "pods-output");
    callbacks[1](null, "nodes-output");
    expect(decode(await pods)).toBe("pods-output");
    expect(decode(await nodes)).toBe("nodes-output");
  });

  test("executeCommand passes the exact argument vector without deduplication", async () => {
    const argv = ["describe", "pod", "my-pod", "-n", "default"];
    const first = executor.executeCommand(argv);
    const second = executor.executeCommand(argv);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenCalledWith(
      "kubectl",
      argv,
      { timeout: 0, maxBuffer: 1024 * 1024 * 64 },
      expect.any(Function),
    );

    callbacks[0](null, "output-1");
    callbacks[1](null, "output-2");
    expect(decode(await first)).toBe("output-1");
    expect(decode(await second)).toBe("output-2");
  });

  test("returns a singleton executor instance", () => {
    const first = KubeCtlExecutorGetInstance();
    expect(first).toBeInstanceOf(KubeCtlExecutor);
    expect(KubeCtlExecutorGetInstance()).toBe(first);
  });

  test("rejects with the kubectl error when the command fails", async () => {
    const pending = executor.executeCommand(["get", "pods"]);
    callbacks[0](new Error("kubectl: command not found"), "");
    await expect(pending).rejects.toThrow("kubectl: command not found");
  });

  test("aborts the child process when the request times out", async () => {
    const killMock = jest.fn();
    execFileMock.mockImplementation(() => ({ kill: killMock }));
    RequestQueueInit(2, 20);

    const pending = executor.executeCommand(["get", "pods", "-A", "-o", "json"]);
    await expect(pending).rejects.toThrow("Request timed out after 20ms");
    expect(killMock).toHaveBeenCalledWith("SIGTERM");
  });
});
