import { AuthHasScope, UserScope } from "@devopsplaybook.io/common-utils";

export const APP_SCOPES: UserScope[] = [
  "k8s:read",
  "k8s:write",
  "stats:read",
  "admin",
];

export type AppScope = (typeof APP_SCOPES)[number];

/**
 * Scope guard for a route. AuthHasScope sends the 401/403 response and then
 * throws; the expected throw is swallowed once the response is sent so it
 * cannot reach Fastify or the OTel onError hook. An unexpected failure is
 * rethrown so the request fails closed with a sanitized 500.
 */
export async function RequireScope(
  req: any,
  res: any,
  scope: AppScope,
): Promise<boolean> {
  try {
    await AuthHasScope(req, res, scope);
    return true;
  } catch (error) {
    if (res.sent) {
      return false;
    }
    throw error;
  }
}

export function RequireAdmin(req: any, res: any): Promise<boolean> {
  return RequireScope(req, res, "admin");
}

/**
 * Minimum scope required to execute a validated kubectl command. Unknown
 * values fail closed (validation already rejects them with 400).
 */
export function ScopeForKubectlCommand(command: string): AppScope {
  switch (command) {
    case "get":
    case "describe":
      return "k8s:read";
    case "rollout restart":
    case "scale":
    case "create":
      return "k8s:write";
    case "delete":
      return "admin";
    default:
      return "admin";
  }
}
