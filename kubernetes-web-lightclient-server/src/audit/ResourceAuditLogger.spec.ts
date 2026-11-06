import {
  CreateResourceAuditHandler,
  FormatResourceAuditEvent,
} from "./ResourceAuditLogger";

const BASE = {
  outcome: "success" as const,
  route: "POST /api/kubectl/command",
  object: "pod",
  actorName: "alice",
  actorId: "11111111-1111-4111-8111-111111111111",
  requestId: "req-1",
  ip: "10.0.0.1",
};

describe("FormatResourceAuditEvent", () => {
  test("formats a delete success as a single readable line", () => {
    const line = FormatResourceAuditEvent({
      ...BASE,
      action: "kubectl.delete",
      namespace: "default",
      target: "my-pod",
    });
    expect(line).toBe(
      "kubectl.delete outcome=success actor=alice actorId=11111111-1111-4111-8111-111111111111 route=POST /api/kubectl/command object=pod namespace=default target=my-pod requestId=req-1 ip=10.0.0.1",
    );
    expect(line).not.toContain("\n");
  });

  test("includes the replica count for a scale event", () => {
    const line = FormatResourceAuditEvent({
      ...BASE,
      action: "kubectl.scale",
      object: "deployment",
      namespace: "default",
      target: "my-deployment",
      replicas: 3,
    });
    expect(line).toContain("kubectl.scale outcome=success");
    expect(line).toContain("target=my-deployment");
    expect(line).toContain("replicas=3");
  });

  test("includes the cronjob source for a create-job event", () => {
    const line = FormatResourceAuditEvent({
      ...BASE,
      action: "kubectl.create-job",
      object: "job",
      namespace: "default",
      target: "my-job",
      source: "cronjob/my-cron",
    });
    expect(line).toContain("kubectl.create-job");
    expect(line).toContain("source=cronjob/my-cron");
  });

  test("records a fixed failure reason", () => {
    const line = FormatResourceAuditEvent({
      ...BASE,
      action: "kubectl.rollout-restart",
      outcome: "failure",
      object: "deployment",
      target: "my-deployment",
      reason: "queue_full",
    });
    expect(line).toContain("outcome=failure");
    expect(line).toContain("reason=queue_full");
  });

  test("never contains payloads, manifests or command output", () => {
    const line = FormatResourceAuditEvent({
      ...BASE,
      action: "kubectl.delete",
      target: "my-pod",
    });
    expect(line).not.toContain("COMPRESSED_OUTPUT");
    expect(line).not.toContain("super-secret");
    expect(line).not.toContain("eyJhbGciOi");
    expect(line).not.toContain("data:");
  });
});

describe("CreateResourceAuditHandler", () => {
  test("logs successes at info and failures at warn", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const handler = CreateResourceAuditHandler(logger);

    handler({ ...BASE, action: "kubectl.delete", target: "my-pod" });
    handler({
      ...BASE,
      action: "kubectl.delete",
      outcome: "failure",
      target: "my-pod",
      reason: "not_found",
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain("outcome=success");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("reason=not_found");
  });
});
