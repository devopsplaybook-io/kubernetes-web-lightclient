import { afterEach, describe, expect, it, vi } from "vitest";
import {
  denialForScope,
  isForbidden,
  permissionDenialForError,
} from "../services/PermissionErrors";
import { EventBus, EventTypes, handleError } from "../services/EventBus";

function httpError(
  status: number,
  url: string,
  data?: unknown,
): unknown {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    config: { url, data },
    response: {
      status,
      data: { error: "Access Denied", code: "FORBIDDEN" },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isForbidden", () => {
  it("only matches a 403 response", () => {
    expect(isForbidden(httpError(403, "/api/resources/types"))).toBe(true);
    expect(isForbidden(httpError(401, "/api/resources/types"))).toBe(false);
    expect(isForbidden(new Error("boom"))).toBe(false);
    expect(isForbidden(null)).toBe(false);
    expect(isForbidden(undefined)).toBe(false);
  });
});

describe("denialForScope", () => {
  it("names the missing scope in the message", () => {
    expect(denialForScope("k8s:read")?.message).toContain("k8s:read");
    expect(denialForScope("k8s:write")?.message).toContain("k8s:write");
    expect(denialForScope("stats:read")?.message).toContain("stats:read");
    expect(denialForScope("admin")?.message).toContain("admin");
    expect(denialForScope("admin")?.title).toBe("Missing scope");
  });

  it("explains the administrator role separately", () => {
    const denial = denialForScope("admin-role");
    expect(denial?.title).toBe("Administrator role required");
    expect(denial?.message).toContain("administrator role");
  });

  it("returns null for the unclassified case", () => {
    expect(denialForScope(null)).toBeNull();
  });
});

describe("permissionDenialForError", () => {
  it("ignores non-403 errors", () => {
    expect(
      permissionDenialForError(httpError(500, "/api/resources/types")),
    ).toBeNull();
    expect(permissionDenialForError(new Error("boom"))).toBeNull();
  });

  it("maps resource list and refresh requests", () => {
    expect(
      permissionDenialForError(httpError(403, "/api/resources/types"))?.scope,
    ).toBe("k8s:read");
    expect(
      permissionDenialForError(httpError(403, "/api/resources/selections"))
        ?.scope,
    ).toBe("k8s:read");
    expect(
      permissionDenialForError(httpError(403, "/api/resources/refresh"))?.scope,
    ).toBe("admin");
  });

  it("maps stats and recommendation requests", () => {
    expect(
      permissionDenialForError(httpError(403, "/api/stats/nodes"))?.scope,
    ).toBe("stats:read");
    expect(
      permissionDenialForError(
        httpError(403, "/api/stats/recommendation/regenerate"),
      )?.scope,
    ).toBe("admin");
  });

  it("distinguishes user administration from token access", () => {
    const users = permissionDenialForError(httpError(403, "/api/users?limit=1"));
    expect(users?.scope).toBe("admin-role");
    expect(users?.message).toContain("administrator role");

    const tokens = permissionDenialForError(
      httpError(403, "/api/users/tokens"),
    );
    expect(tokens?.scope).toBeNull();
    expect(tokens?.message).toContain("review your role and scopes");
  });

  it("maps kubectl logs to k8s:read", () => {
    expect(
      permissionDenialForError(httpError(403, "/api/kubectl/logs"))?.scope,
    ).toBe("k8s:read");
  });

  it("maps kubectl commands to the scope they need", () => {
    const scopeFor = (command?: unknown) =>
      permissionDenialForError(
        httpError(403, "/api/kubectl/command", { command }),
      )?.scope;

    expect(scopeFor("get")).toBe("k8s:read");
    expect(scopeFor("describe")).toBe("k8s:read");
    expect(scopeFor("delete")).toBe("admin");
    expect(scopeFor("exec")).toBe("admin");
    expect(scopeFor("rollout restart")).toBe("k8s:write");
    expect(scopeFor("scale")).toBe("k8s:write");
    expect(scopeFor("create")).toBe("k8s:write");
    expect(scopeFor("unknown")).toBe("k8s:read");
    expect(scopeFor(undefined)).toBe("k8s:read");
  });

  it("parses a JSON string request body", () => {
    expect(
      permissionDenialForError(
        httpError(403, "/api/kubectl/command", '{"command":"scale"}'),
      )?.scope,
    ).toBe("k8s:write");
  });

  it("falls back to a generic denial for unclassified routes", () => {
    const denial = permissionDenialForError(httpError(403, "/api/other"));
    expect(denial?.scope).toBeNull();
    expect(denial?.title).toBe("Access denied");
    expect(denial?.message).toContain("review your role and scopes");
  });

  it("never echoes the server response body", () => {
    const denial = permissionDenialForError(
      httpError(403, "/api/resources/types"),
    );
    expect(denial?.message).not.toContain("FORBIDDEN");
    expect(denial?.message).not.toContain("Access Denied");
  });
});

describe("handleError", () => {
  it("reports a 403 once with the actionable scope message", () => {
    const emit = vi.spyOn(EventBus, "emit");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    handleError(httpError(403, "/api/stats/nodes"));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe(EventTypes.ALERT_MESSAGE);
    const payload = emit.mock.calls[0][1] as { type: string; text: string };
    expect(payload.type).toBe("error");
    expect(payload.text).toContain("stats:read");
    expect(payload.text).not.toContain("Access Denied");
    expect(consoleError).not.toHaveBeenCalled();

    emit.mockClear();
    consoleError.mockClear();

    handleError(httpError(500, "/api/stats/nodes"));

    expect(emit).toHaveBeenCalledTimes(1);
    const fallback = emit.mock.calls[0][1] as { type: string; text: string };
    expect(fallback.type).toBe("error");
    expect(fallback.text).toBe("Access Denied");
    expect(consoleError).toHaveBeenCalled();
  });
});
