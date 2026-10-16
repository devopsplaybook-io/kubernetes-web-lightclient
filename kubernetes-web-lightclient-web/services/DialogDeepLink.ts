// Deep links encode the open details/logs dialog in the URL query so views
// are shareable and survive a refresh. The parameters are deliberately
// separate from the list filters (`namespace`): opening a dialog never
// mutates the list filters.

export type DialogKind = "details" | "logs";

export interface DialogRoute {
  kind: DialogKind;
  name: string;
  namespace: string;
}

// Same RFC 1123-ish shapes the server validates server-side.
const OBJECT_NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 253;

function isValidObjectName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    OBJECT_NAME_REGEX.test(value)
  );
}

function isValidNamespace(value: string): boolean {
  return value.length <= 63 && NAMESPACE_REGEX.test(value);
}

/**
 * Read a dialog deep link from a route query. Returns null for absent or
 * junk values: the server stays the authority on what can actually be
 * fetched, so a malformed link is simply ignored.
 */
export function readDialogRoute(query: unknown): DialogRoute | null {
  if (!query || typeof query !== "object") {
    return null;
  }
  const params = query as Record<string, unknown>;
  if (params.dialog !== "details" && params.dialog !== "logs") {
    return null;
  }
  if (!isValidObjectName(params.name)) {
    return null;
  }
  const rawNamespace = params.dialogNamespace;
  if (
    rawNamespace !== undefined &&
    rawNamespace !== null &&
    rawNamespace !== "" &&
    (typeof rawNamespace !== "string" || !isValidNamespace(rawNamespace))
  ) {
    return null;
  }
  return {
    kind: params.dialog,
    name: params.name,
    namespace: typeof rawNamespace === "string" ? rawNamespace : "",
  };
}

export function writeDialogRoute(
  router: { replace: (location: unknown) => unknown },
  route: { path: string; query: Record<string, unknown> },
  kind: DialogKind,
  name: string,
  namespace?: string,
): void {
  const query = { ...route.query, dialog: kind, name };
  if (namespace) {
    query.dialogNamespace = namespace;
  } else {
    delete query.dialogNamespace;
  }
  void router.replace({ path: route.path, query });
}

export function clearDialogRoute(
  router: { replace: (location: unknown) => unknown },
  route: { path: string; query: Record<string, unknown> },
): void {
  if (
    route.query.dialog === undefined &&
    route.query.name === undefined &&
    route.query.dialogNamespace === undefined
  ) {
    return;
  }
  const query = { ...route.query };
  delete query.dialog;
  delete query.name;
  delete query.dialogNamespace;
  void router.replace({ path: route.path, query });
}
