import type { AuthAuditEvent } from "@devopsplaybook.io/common-utils";
import { CreateAuthAuditHandler } from "./AuthAuditLogger";

function buildEvent(overrides: Partial<AuthAuditEvent>): AuthAuditEvent {
  return {
    action: "login_success",
    outcome: "success",
    timestamp: "2026-11-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("CreateAuthAuditHandler", () => {
  test("logs a failed login as a warning with action, reason, user, ip and route", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const handler = CreateAuthAuditHandler(logger);
    handler(
      buildEvent({
        action: "login_failure",
        outcome: "failure",
        reason: "invalid_credentials",
        targetUserName: "alice",
        ip: "10.0.0.1",
      }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = logger.warn.mock.calls[0][0] as string;
    expect(line).toContain("auth.login_failure");
    expect(line).toContain("outcome=failure");
    expect(line).toContain("reason=invalid_credentials");
    expect(line).toContain("target=alice");
    expect(line).toContain("ip=10.0.0.1");
    expect(line).toContain("route=POST /api/users/session");
    expect(logger.info).not.toHaveBeenCalled();
  });

  test("logs a successful login as info", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "login_success",
        actorName: "alice",
        ip: "10.0.0.1",
      }),
    );
    expect(logger.info).toHaveBeenCalledTimes(1);
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain("auth.login_success");
    expect(line).toContain("actor=alice");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("logs user management events with actor and target", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "user_update",
        actorName: "root",
        targetUserName: "bob",
      }),
    );
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain("auth.user_update");
    expect(line).toContain("actor=root");
    expect(line).toContain("target=bob");
    expect(line).not.toContain("route=");
  });

  test("never logs credentials", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "login_failure",
        outcome: "failure",
        targetUserName: "alice",
      }),
    );
    const line = logger.warn.mock.calls[0][0] as string;
    expect(line).not.toMatch(/password/i);
    expect(line).not.toMatch(/token/i);
  });
});
