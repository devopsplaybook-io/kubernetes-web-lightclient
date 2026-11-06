import type { AuthAuditEvent } from "@devopsplaybook.io/common-utils";
import { CreateAuthAuditHandler } from "./AuthAuditLogger";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";

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
    expect(line).toContain("route=POST /api/users/session");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("logs a user update with route, actor, target, ids and changed fields", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "user_update",
        actorName: "root",
        actorId: ACTOR_ID,
        targetUserName: "bob",
        targetUserId: TARGET_ID,
        fields: ["role", "scopes"],
      }),
    );
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain("auth.user_update");
    expect(line).toContain("actor=root");
    expect(line).toContain(`actorId=${ACTOR_ID}`);
    expect(line).toContain("target=bob");
    expect(line).toContain(`targetId=${TARGET_ID}`);
    expect(line).toContain("fields=role,scopes");
    expect(line).toContain("route=PUT /api/users/:id");
  });

  test.each([
    ["user_create", "POST /api/users"],
    ["user_delete", "DELETE /api/users/:id"],
  ])("maps %s to route %s", (action, route) => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({ action: action as AuthAuditEvent["action"] }),
    );
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain(`route=${route}`);
  });

  test("maps a self password change to the password route", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "password_change",
        reason: "self",
        actorName: "alice",
        actorId: ACTOR_ID,
        targetUserId: ACTOR_ID,
      }),
    );
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain("auth.password_change");
    expect(line).toContain("route=PUT /api/users/password");
  });

  test("maps an admin password reset to the user route", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "password_change",
        reason: "admin_reset",
        actorName: "root",
        actorId: ACTOR_ID,
        targetUserId: TARGET_ID,
      }),
    );
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain("route=PUT /api/users/:id");
  });

  test("logs an API token creation with route, actor, target and only the token id", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "api_token_create",
        actorName: "alice",
        actorId: ACTOR_ID,
        targetUserId: ACTOR_ID,
        tokenId: TOKEN_ID,
      }),
    );
    const line = logger.info.mock.calls[0][0] as string;
    expect(line).toContain("auth.api_token_create");
    expect(line).toContain(`tokenId=${TOKEN_ID}`);
    expect(line).toContain("route=POST /api/users/tokens");
    // An arbitrary plaintext token value must never reach the audit line.
    expect(line).not.toContain("tok_live_supersecretvalue");
  });

  test("logs a failed API token revocation as a warning with the revoke route", () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    CreateAuthAuditHandler(logger)(
      buildEvent({
        action: "api_token_revoke",
        outcome: "failure",
        reason: "not_found",
        actorName: "alice",
        actorId: ACTOR_ID,
        tokenId: TOKEN_ID,
      }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = logger.warn.mock.calls[0][0] as string;
    expect(line).toContain("outcome=failure");
    expect(line).toContain(`tokenId=${TOKEN_ID}`);
    expect(line).toContain("route=DELETE /api/users/tokens/:id");
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
