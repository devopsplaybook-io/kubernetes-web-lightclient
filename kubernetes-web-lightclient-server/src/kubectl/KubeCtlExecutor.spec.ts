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
  DedupKeyFor,
  IsKubeObjectNotFoundError,
  KubeCtlExecutor,
  KubeCtlExecutorGetInstance,
  RedactSecretList,
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

  test("CompressOutput produces base64 gzip that decompresses to the original stdout", async () => {
    const output = '{"items":[{"metadata":{"name":"my-pod"}}]}';
    expect(decode(await CompressOutput(output))).toBe(output);
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

  test("shares one kubectl execution between raw and compressed list reads", async () => {
    const raw = executor.executeRawCommand(["get", "pods", "-A", "-o", "json"]);
    const compressed = executor.executeGetRequest("pods");
    expect(execFileMock).toHaveBeenCalledTimes(1);

    callbacks[0](null, '{"items":[]}');
    expect(await raw).toBe('{"items":[]}');
    expect(decode(await compressed)).toBe('{"items":[]}');
  });

  test("executeRawCommand returns uncompressed stdout", async () => {
    const raw = executor.executeRawCommand(["get", "nodes", "-o", "json"]);
    callbacks[0](null, '{"items":[{"metadata":{"name":"n1"}}]}');
    expect(await raw).toBe('{"items":[{"metadata":{"name":"n1"}}]}');
  });

  test("coalesces identical logs commands but keeps different ones separate", async () => {
    const argv = ["logs", "-n", "default", "my-pod", "--tail=5000", "--timestamps"];
    const first = executor.executeCommand(argv);
    const second = executor.executeCommand(argv);
    expect(execFileMock).toHaveBeenCalledTimes(1);

    callbacks[0](null, "LOG OUTPUT");
    expect(decode(await first)).toBe("LOG OUTPUT");
    expect(decode(await second)).toBe("LOG OUTPUT");

    const otherPod = executor.executeCommand([
      "logs",
      "-n",
      "default",
      "other-pod",
      "--tail=5000",
      "--timestamps",
    ]);
    const otherSince = executor.executeCommand([
      "logs",
      "-n",
      "default",
      "my-pod",
      "--since=1h",
      "--tail=5000",
      "--timestamps",
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(3);

    callbacks[1](null, "OTHER POD");
    callbacks[2](null, "OTHER SINCE");
    expect(decode(await otherPod)).toBe("OTHER POD");
    expect(decode(await otherSince)).toBe("OTHER SINCE");
  });

  test("does not deduplicate side-effect commands", () => {
    expect(DedupKeyFor(["delete", "pod", "my-pod", "-n", "default"])).toBeNull();
    expect(DedupKeyFor(["scale", "deployment", "web", "--replicas=3"])).toBeNull();
    expect(DedupKeyFor(["logs", "-n", "default", "my-pod"])).toMatch(/^logs:/);
    expect(DedupKeyFor(["get", "pods", "-A", "-o", "json"])).toBe("get:pods");
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

  test("redacts Secret payloads from a cached list read", async () => {
    const pending = executor.executeGetRequest("secret");
    callbacks[0](
      null,
      JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items: [
          {
            metadata: {
              name: "my-secret",
              namespace: "default",
              annotations: {
                "kubectl.kubernetes.io/last-applied-configuration": "{}",
                "keep.example.com/owner": "team-a",
              },
            },
            type: "Opaque",
            data: { password: "c3VwZXItc2VjcmV0" },
            stringData: { user: "admin" },
          },
        ],
      }),
    );

    const decoded = decode(await pending);
    expect(decoded).not.toContain("c3VwZXItc2VjcmV0");
    const list = JSON.parse(decoded);
    expect(list.items[0].metadata.name).toBe("my-secret");
    expect(list.items[0].type).toBe("Opaque");
    expect(list.items[0].data).toBeUndefined();
    expect(list.items[0].stringData).toBeUndefined();
    expect(
      list.items[0].metadata.annotations[
        "kubectl.kubernetes.io/last-applied-configuration"
      ],
    ).toBeUndefined();
    expect(
      list.items[0].metadata.annotations["keep.example.com/owner"],
    ).toBe("team-a");
  });

  test("keeps non-secret list payloads unchanged", async () => {
    const payload = JSON.stringify({
      items: [{ metadata: { name: "my-config" }, data: { key: "value" } }],
    });
    const pending = executor.executeGetRequest("configmap");
    callbacks[0](null, payload);
    expect(decode(await pending)).toBe(payload);
  });

  test("rejects a Secret list that is not valid JSON instead of caching it", async () => {
    const pending = executor.executeGetRequest("secret");
    callbacks[0](null, "not-json");
    await expect(pending).rejects.toThrow();
  });
});

describe("RedactSecretList", () => {
  test("removes Secret data, stringData and the last-applied annotation", () => {
    const redacted = JSON.parse(
      RedactSecretList(
        JSON.stringify({
          items: [
            {
              metadata: {
                name: "my-secret",
                annotations: {
                  "kubectl.kubernetes.io/last-applied-configuration": "{}",
                },
              },
              data: { password: "c2VjcmV0" },
              stringData: { user: "admin" },
            },
          ],
        }),
      ),
    );
    expect(redacted.items[0].metadata.name).toBe("my-secret");
    expect(redacted.items[0].data).toBeUndefined();
    expect(redacted.items[0].stringData).toBeUndefined();
    expect(
      redacted.items[0].metadata.annotations[
        "kubectl.kubernetes.io/last-applied-configuration"
      ],
    ).toBeUndefined();
  });

  test("throws on invalid JSON so the raw payload can never be cached", () => {
    expect(() => RedactSecretList("{not-json")).toThrow();
    expect(() => RedactSecretList("null")).toThrow(
      "Secret list payload is not a JSON object",
    );
  });
});

describe("IsKubeObjectNotFoundError", () => {
  test("detects NotFound in a Buffer stderr (execFile default shape)", () => {
    const error = Object.assign(new Error("Command failed"), {
      stderr: Buffer.from('Error from server (NotFound): pods "x" not found'),
    });
    expect(IsKubeObjectNotFoundError(error)).toBe(true);
  });

  test("detects NotFound in a string stderr", () => {
    const error = Object.assign(new Error("Command failed"), {
      stderr: 'Error from server (NotFound): pods "x" not found',
    });
    expect(IsKubeObjectNotFoundError(error)).toBe(true);
  });

  test("detects NotFound in the error message when stderr is absent", () => {
    expect(
      IsKubeObjectNotFoundError(
        new Error('Error from server (NotFound): pods "x" not found'),
      ),
    ).toBe(true);
  });

  test("rejects non-NotFound kubectl errors", () => {
    const error = Object.assign(new Error("Command failed"), {
      stderr: 'Error from server (Forbidden): pods "x" is forbidden',
    });
    expect(IsKubeObjectNotFoundError(error)).toBe(false);
  });

  test("rejects null, undefined and non-Error values", () => {
    expect(IsKubeObjectNotFoundError(null)).toBe(false);
    expect(IsKubeObjectNotFoundError(undefined)).toBe(false);
    expect(IsKubeObjectNotFoundError("Error from server (NotFound)")).toBe(
      false,
    );
  });
});
