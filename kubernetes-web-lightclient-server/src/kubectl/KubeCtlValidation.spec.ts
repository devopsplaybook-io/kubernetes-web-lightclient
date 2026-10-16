import {
  BuildCommandArgs,
  BuildLogsArgs,
  IsAllowedResourceType,
  IsValidNamespace,
  IsValidObjectName,
} from "./KubeCtlValidation";

// Payload families that must never reach kubectl: newline chaining,
// command substitution, backticks, pipes, separators, ${IFS} and friends.
const INJECTION_PAYLOADS = [
  "pods\nid",
  "pods;id",
  "pods;id${IFS}-u",
  "pods$(id)",
  "pods`id`",
  "pods|id",
  "pods&id",
  "pods&&id",
  "pods id",
  "pods\tid",
  "pods'id",
  'pods"id',
  "pods>out",
  "pods<in",
  "pods#comment",
  "pods\u0000id",
  "../../etc/passwd",
  "-o",
  "--all-namespaces",
  "Pods",
  "pods.fake/extra",
];

describe("KubeCtlValidation", () => {
  describe("IsAllowedResourceType", () => {
    test("accepts known built-in resource ids", () => {
      expect(IsAllowedResourceType("pod")).toBe(true);
      expect(IsAllowedResourceType("deployment")).toBe(true);
      expect(IsAllowedResourceType("customresourcedefinition")).toBe(true);
    });

    test.each(INJECTION_PAYLOADS)("rejects injection payload %j", (payload) => {
      expect(IsAllowedResourceType(payload)).toBe(false);
    });

    test("rejects unknown resource ids", () => {
      expect(IsAllowedResourceType("pods")).toBe(false);
      expect(IsAllowedResourceType("nonexistent")).toBe(false);
      expect(IsAllowedResourceType("")).toBe(false);
    });
  });

  describe("IsValidObjectName / IsValidNamespace", () => {
    test("accepts RFC1123 names", () => {
      expect(IsValidObjectName("my-pod")).toBe(true);
      expect(IsValidObjectName("my-pod-0")).toBe(true);
      expect(IsValidObjectName("my.pod.subdomain")).toBe(true);
      expect(IsValidNamespace("default")).toBe(true);
      expect(IsValidNamespace("kube-system")).toBe(true);
    });

    test.each(INJECTION_PAYLOADS)("rejects payload %j", (payload) => {
      expect(IsValidObjectName(payload)).toBe(false);
      expect(IsValidNamespace(payload)).toBe(false);
    });

    test("rejects overly long values", () => {
      expect(IsValidObjectName("a".repeat(254))).toBe(false);
      expect(IsValidNamespace("a".repeat(64))).toBe(false);
    });
  });

  describe("BuildCommandArgs", () => {
    test("rebuilds a get with namespace, name and json output", () => {
      const result = BuildCommandArgs({
        object: "pod",
        command: "get",
        namespace: "default",
        argument: "my-pod",
      });
      expect(result).toEqual({
        ok: true,
        argv: ["get", "pod", "my-pod", "-n", "default", "-o", "json"],
      });
    });

    test("rebuilds a get for all namespaces", () => {
      const result = BuildCommandArgs({
        object: "pod",
        command: "get",
        argument: "-A",
      });
      expect(result).toEqual({ ok: true, argv: ["get", "pod", "-A", "-o", "json"] });
    });

    test("rebuilds a describe without json output", () => {
      const result = BuildCommandArgs({
        object: "deployment",
        command: "describe",
        namespace: "default",
        argument: "my-deployment",
        noJson: true,
      });
      expect(result).toEqual({
        ok: true,
        argv: ["describe", "deployment", "my-deployment", "-n", "default"],
      });
    });

    test("rebuilds a delete", () => {
      const result = BuildCommandArgs({
        object: "deployment",
        command: "delete",
        namespace: "default",
        argument: "my-deployment",
        noJson: true,
      });
      expect(result).toEqual({
        ok: true,
        argv: ["delete", "deployment", "my-deployment", "-n", "default"],
      });
    });

    test("rebuilds a rollout restart", () => {
      const result = BuildCommandArgs({
        object: "deployment",
        command: "rollout restart",
        namespace: "default",
        argument: "my-deployment",
        noJson: true,
      });
      expect(result).toEqual({
        ok: true,
        argv: [
          "rollout",
          "restart",
          "deployment",
          "my-deployment",
          "-n",
          "default",
        ],
      });
    });

    test("rebuilds a scale with a re-serialized replica count", () => {
      const result = BuildCommandArgs({
        object: "deployment",
        command: "scale",
        namespace: "default",
        argument: "my-deployment --replicas=3",
        noJson: true,
      });
      expect(result).toEqual({
        ok: true,
        argv: [
          "scale",
          "deployment",
          "my-deployment",
          "--replicas=3",
          "-n",
          "default",
        ],
      });
    });

    test("rebuilds a job creation from a cronjob", () => {
      const result = BuildCommandArgs({
        object: "job",
        command: "create",
        namespace: "default",
        argument: "--from=cronjob/my-cron my-job",
        noJson: true,
      });
      expect(result).toEqual({
        ok: true,
        argv: [
          "create",
          "job",
          "my-job",
          "--from=cronjob/my-cron",
          "-n",
          "default",
        ],
      });
    });

    test.each(INJECTION_PAYLOADS)(
      "rejects object payload %j",
      (payload) => {
        const result = BuildCommandArgs({
          object: payload,
          command: "get",
          argument: "my-pod",
        });
        expect(result.ok).toBe(false);
        if (result.ok === false) {
          expect(result.error).toContain("unknown resource type");
          expect(result.field).toBe("object");
        }
      },
    );

    test.each(INJECTION_PAYLOADS)(
      "rejects argument payload %j",
      (payload) => {
        const result = BuildCommandArgs({
          object: "deployment",
          command: "delete",
          argument: payload,
          noJson: true,
        });
        expect(result.ok).toBe(false);
        if (result.ok === false) {
          expect(result.error).toContain("invalid object name");
          expect(result.field).toBe("argument");
        }
      },
    );

    test.each(INJECTION_PAYLOADS)(
      "rejects namespace payload %j",
      (payload) => {
        const result = BuildCommandArgs({
          object: "pod",
          command: "get",
          namespace: payload,
          argument: "my-pod",
        });
        expect(result.ok).toBe(false);
        if (result.ok === false) {
          expect(result.error).toContain("invalid namespace");
          expect(result.field).toBe("namespace");
        }
      },
    );

    test("rejects unknown commands with a command field", () => {
      const exec = BuildCommandArgs({
        object: "pod",
        command: "exec",
        argument: "my-pod",
      });
      expect(exec).toMatchObject({
        ok: false,
        error: 'unsupported command "exec"',
        field: "command",
      });
      expect(
        BuildCommandArgs({ object: "pod", command: "get pods; id" }),
      ).toMatchObject({
        ok: false,
        error: 'unsupported command "get pods; id"',
        field: "command",
      });
      expect(BuildCommandArgs(null)).toMatchObject({
        ok: false,
        error: "missing or invalid command",
        field: "command",
      });
    });

    test("rejects a get with an invalid object name", () => {
      const result = BuildCommandArgs({
        object: "pod",
        command: "get",
        argument: "my-pod; id",
      });
      expect(result).toMatchObject({
        ok: false,
        error: 'invalid object name "my-pod; id"',
        field: "argument",
      });
    });

    test("rejects malformed scale and create arguments", () => {
      expect(
        BuildCommandArgs({
          object: "deployment",
          command: "scale",
          argument: "my-deployment --replicas=3;id",
          noJson: true,
        }).ok,
      ).toBe(false);
      const scale = BuildCommandArgs({
        object: "deployment",
        command: "scale",
        argument: "my-deployment",
        noJson: true,
      });
      expect(scale).toMatchObject({
        ok: false,
        error: 'invalid scale argument "my-deployment", expected <name> --replicas=<n>',
        field: "argument",
      });
      expect(
        BuildCommandArgs({
          object: "job",
          command: "create",
          argument: "--from=cronjob/my-cron",
          noJson: true,
        }).ok,
      ).toBe(false);
      const createOnPod = BuildCommandArgs({
        object: "pod",
        command: "create",
        argument: "--from=cronjob/my-cron my-job",
        noJson: true,
      });
      expect(createOnPod).toMatchObject({
        ok: false,
        error: "command create is only supported for object job",
        field: "object",
      });
    });
  });

  describe("BuildLogsArgs", () => {
    test("rebuilds the logs dialog argument shapes", () => {
      const result = BuildLogsArgs({
        namespace: "default",
        pod: "my-pod",
        container: "my-container",
        argument: " --since=1h --previous ",
        timestamps: true,
      });
      expect(result).toEqual({
        ok: true,
        argv: [
          "logs",
          "-n",
          "default",
          "my-pod",
          "-c",
          "my-container",
          "--since=1h",
          "--previous",
          "--timestamps",
        ],
      });
    });

    test("omits timestamps when disabled", () => {
      const result = BuildLogsArgs({
        namespace: "default",
        pod: "my-pod",
        timestamps: false,
      });
      expect(result).toEqual({
        ok: true,
        argv: ["logs", "-n", "default", "my-pod"],
      });
    });

    test.each(INJECTION_PAYLOADS)("rejects pod payload %j", (payload) => {
      const result = BuildLogsArgs({ namespace: "default", pod: payload });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toContain("invalid pod name");
        expect(result.field).toBe("pod");
      }
    });

    test("rejects an invalid container name", () => {
      const result = BuildLogsArgs({
        namespace: "default",
        pod: "my-pod",
        container: "container$(id)",
      });
      expect(result).toMatchObject({
        ok: false,
        error: 'invalid container name "container$(id)"',
        field: "container",
      });
    });

    test.each(INJECTION_PAYLOADS)(
      "rejects argument payload %j",
      (payload) => {
        const result = BuildLogsArgs({
          namespace: "default",
          pod: "my-pod",
          argument: payload,
        });
        expect(result.ok).toBe(false);
        if (result.ok === false) {
          expect(result.field).toBe("argument");
        }
      },
    );

    test("rejects unknown log options with the allowed list in the message", () => {
      const tail = BuildLogsArgs({
        namespace: "default",
        pod: "my-pod",
        argument: "--tail=10",
      });
      expect(tail).toMatchObject({
        ok: false,
        error:
          'unsupported logs option "--tail=10", allowed: --previous, --since=10m|1h|24h',
        field: "argument",
      });
      expect(
        BuildLogsArgs({
          namespace: "default",
          pod: "my-pod",
          argument: "--since=5m",
        }).ok,
      ).toBe(false);
    });

    test("rejects missing namespace", () => {
      const result = BuildLogsArgs({ namespace: "", pod: "my-pod" });
      expect(result).toMatchObject({
        ok: false,
        error: 'invalid namespace ""',
        field: "namespace",
      });
      expect(BuildLogsArgs(null)).toMatchObject({
        ok: false,
        error: "missing request payload",
        field: "payload",
      });
    });
  });
});
