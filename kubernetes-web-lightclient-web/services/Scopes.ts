/**
 * Application roles and scopes as enforced by the server
 * (`kubernetes-web-lightclient-server/src/auth/Authorization.ts`). The
 * `admin` role bypasses per-scope checks; the `admin` scope grants
 * admin-only routes to a non-admin user but not the `/api/users` CRUD
 * routes, which require the role.
 */

export type AppScope = "k8s:read" | "k8s:write" | "stats:read" | "admin";

export interface ScopeDefinition {
  id: AppScope;
  label: string;
  description: string;
}

export const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  {
    id: "k8s:read",
    label: "Kubernetes read",
    description:
      "List cluster resources, read pod logs and run get/describe commands.",
  },
  {
    id: "k8s:write",
    label: "Kubernetes write",
    description: "Rollout restart, scale deployments and create jobs.",
  },
  {
    id: "stats:read",
    label: "Stats read",
    description: "View the cluster metrics and the LLM recommendation.",
  },
  {
    id: "admin",
    label: "Admin actions",
    description:
      "Delete objects, refresh CRDs, regenerate the recommendation and other admin-only actions.",
  },
];

export interface UserLike {
  role?: string;
  scopes?: string[] | null;
}

/** Keeps only the known application scopes, in their declared order. */
export function normalizeScopes(value: unknown): AppScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const present = new Set(
    value.filter((scope): scope is string => typeof scope === "string"),
  );
  return SCOPE_DEFINITIONS.map((definition) => definition.id).filter((id) =>
    present.has(id),
  );
}

export function isAdminRole(user: UserLike | null | undefined): boolean {
  return user?.role === "admin";
}

/** True when the admin role bypasses the scope or the scope is granted. */
export function hasScope(
  user: UserLike | null | undefined,
  scope: AppScope,
): boolean {
  return isAdminRole(user) || normalizeScopes(user?.scopes).includes(scope);
}

export function hasAdminScope(user: UserLike | null | undefined): boolean {
  return hasScope(user, "admin");
}
