/**
 * Deep-link builders shared by the global search palette and the Related tab.
 *
 * A details link reuses the dialog parameters understood by
 * `DialogDeepLink.ts` (`dialog`, `name`, `dialogNamespace`) plus the list
 * parameters (`objectType`, `namespace`) so the target page opens the right
 * list and then the details dialog. A filtered-list link only needs the list
 * parameters. Both produce stable, shareable URLs.
 */

const MAX_NAME_LENGTH = 253;
const TYPE_ID_REGEX = /^[a-z0-9][a-z0-9.-]*$/;
const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const BuiltInKindToTypeId: Record<string, string> = {
  Pod: "pod",
  Deployment: "deployment",
  ReplicaSet: "replicaset",
  StatefulSet: "statefulset",
  DaemonSet: "daemonset",
  Job: "job",
  CronJob: "cronjob",
  Service: "service",
  Ingress: "ingress",
  ConfigMap: "configmap",
  Secret: "secret",
  Node: "node",
  Namespace: "namespace",
  Event: "events",
  PersistentVolumeClaim: "pvc",
  PersistentVolume: "pv",
  ServiceAccount: "serviceaccount",
  Role: "role",
  RoleBinding: "rolebinding",
  ClusterRole: "clusterrole",
  ClusterRoleBinding: "clusterrolebinding",
  HorizontalPodAutoscaler: "hpa",
  PodDisruptionBudget: "pdb",
  NetworkPolicy: "networkpolicy",
  StorageClass: "storageclass",
  CustomResourceDefinition: "customresourcedefinition",
};

export interface ResourceTypeLike {
  id: string;
  name: string;
  namespaced?: boolean;
  isCrd?: boolean;
}

function IsValidTypeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    TYPE_ID_REGEX.test(value)
  );
}

function IsValidNamespace(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 63 &&
    NAMESPACE_REGEX.test(value)
  );
}

export function DetailsQuery(
  typeId: string,
  namespace: string,
  name: string,
): Record<string, string> {
  const query: Record<string, string> = {
    objectType: typeId,
    dialog: "details",
    name,
  };
  if (namespace) {
    query.namespace = namespace;
    query.dialogNamespace = namespace;
  }
  return query;
}

export function FilteredListQuery(
  typeId: string,
  namespace: string,
  search: string,
): Record<string, string> {
  const query: Record<string, string> = { objectType: typeId };
  if (namespace) {
    query.namespace = namespace;
  }
  if (search) {
    query.search = search;
  }
  return query;
}

function ToPath(query: Record<string, string>): string {
  return `/kubernetes?${new URLSearchParams(query).toString()}`;
}

export function DetailsPath(
  typeId: string,
  namespace: string,
  name: string,
): string {
  return ToPath(DetailsQuery(typeId, namespace, name));
}

export function FilteredListPath(
  typeId: string,
  namespace: string,
  search: string,
): string {
  return ToPath(FilteredListQuery(typeId, namespace, search));
}

/**
 * Resolve an owner/related `kind` to a resource type id. Built-ins map
 * directly; a custom resource resolves through the `"<Kind> (CRD)"` display
 * name the server uses for CRD types. Unknown kinds return null so callers
 * can render the entry without a link instead of guessing a command.
 */
export function KindToTypeId(
  kind: string,
  types: ResourceTypeLike[],
): string | null {
  if (!kind) {
    return null;
  }
  if (BuiltInKindToTypeId[kind]) {
    return BuiltInKindToTypeId[kind];
  }
  const crd = (types || []).find((type) => type.name === `${kind} (CRD)`);
  return crd ? crd.id : null;
}

export interface ListState {
  objectType?: string;
  namespace: string;
  search: string;
}

/**
 * Normalize the list-related query parameters coming from the route. Junk
 * values fall back to the defaults so an edited URL cannot put the page in a
 * state the server would reject.
 */
export function DesiredListState(query: unknown): ListState {
  const state: ListState = { namespace: "*", search: "" };
  if (!query || typeof query !== "object") {
    return state;
  }
  const params = query as Record<string, unknown>;
  if (IsValidTypeId(params.objectType)) {
    state.objectType = params.objectType;
  }
  if (IsValidNamespace(params.namespace)) {
    state.namespace = params.namespace;
  } else if (params.namespace === "*") {
    state.namespace = "*";
  }
  if (typeof params.search === "string") {
    state.search = params.search;
  }
  return state;
}
