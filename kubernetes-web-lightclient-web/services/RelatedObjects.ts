/**
 * Pure helpers for the Related tab: owner references, template labels,
 * selector matching, ingress backends, referenced ConfigMaps/Secrets and
 * events. Kept free of I/O so every relation rule is unit-testable.
 */
import { PodSpecOf } from "~~/services/GlobalSearch";

export const RELATED_OWNER_MAX_DEPTH = 3;
export const RELATED_SECTION_CAP = 50;
export const RELATED_EVENTS_CAP = 50;

export interface OwnerRef {
  kind: string;
  name: string;
  uid: string;
  controller: boolean;
}

export function OwnerRefs(object: any): OwnerRef[] {
  const references = object?.metadata?.ownerReferences;
  if (!Array.isArray(references)) {
    return [];
  }
  const owners: OwnerRef[] = [];
  for (const reference of references) {
    if (
      !reference ||
      typeof reference.kind !== "string" ||
      typeof reference.name !== "string" ||
      !reference.kind ||
      !reference.name
    ) {
      continue;
    }
    owners.push({
      kind: reference.kind,
      name: reference.name,
      uid: typeof reference.uid === "string" ? reference.uid : "",
      controller: reference.controller === true,
    });
  }
  return owners;
}

function IsObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object";
}

/**
 * Labels used to find Services/Ingresses that route to the object: the pod
 * template labels for workloads, the object labels otherwise (pods, custom
 * resources).
 */
export function PodTemplateLabels(object: any): Record<string, string> {
  const templateLabels =
    object?.spec?.template?.metadata?.labels ||
    object?.spec?.jobTemplate?.spec?.template?.metadata?.labels;
  if (IsObject(templateLabels)) {
    return templateLabels;
  }
  return IsObject(object?.metadata?.labels) ? object.metadata.labels : {};
}

export function SelectorMatchesLabels(
  selector: unknown,
  labels: unknown,
): boolean {
  if (!IsObject(selector) || !IsObject(labels)) {
    return false;
  }
  const entries = Object.entries(selector);
  if (entries.length === 0) {
    return false;
  }
  return entries.every(([key, value]) => labels[key] === value);
}

export function SelectingServices(
  services: any[],
  labels: Record<string, string>,
): any[] {
  return (services || []).filter((service) =>
    SelectorMatchesLabels(service?.spec?.selector, labels),
  );
}

function BackendServiceName(backend: any): string | null {
  if (!IsObject(backend)) {
    return null;
  }
  if (typeof backend.service?.name === "string" && backend.service.name) {
    return backend.service.name;
  }
  if (typeof backend.serviceName === "string" && backend.serviceName) {
    return backend.serviceName;
  }
  return null;
}

/**
 * Service names referenced by an Ingress (networking.k8s.io/v1 and the legacy
 * extensions/v1beta1 `serviceName` form).
 */
export function IngressServiceNames(ingress: any): string[] {
  const names = new Set<string>();
  const add = (name: string | null) => {
    if (name) {
      names.add(name);
    }
  };
  add(BackendServiceName(ingress?.spec?.defaultBackend));
  for (const rule of ingress?.spec?.rules || []) {
    for (const path of rule?.http?.paths || []) {
      add(BackendServiceName(path?.backend));
    }
  }
  return Array.from(names).sort();
}

export function RoutingIngresses(
  ingresses: any[],
  serviceNames: string[],
): any[] {
  const names = new Set(serviceNames);
  return (ingresses || []).filter((ingress) =>
    IngressServiceNames(ingress).some((name) => names.has(name)),
  );
}

export interface ReferencedName {
  name: string;
  via: string;
}

export interface ReferencedConfigMapsAndSecrets {
  configMaps: ReferencedName[];
  secrets: ReferencedName[];
}

/**
 * ConfigMaps and Secrets referenced by a pod spec: volumes (configMap,
 * secret, projected sources), envFrom and env.valueFrom of every container
 * kind, and imagePullSecrets. Names are deduplicated and sorted.
 */
export function ReferencedConfigMapsAndSecrets(
  podSpec: any,
): ReferencedConfigMapsAndSecrets {
  const configMaps = new Map<string, string>();
  const secrets = new Map<string, string>();
  const add = (target: Map<string, string>, name: unknown, via: string) => {
    if (typeof name === "string" && name && !target.has(name)) {
      target.set(name, via);
    }
  };
  if (!IsObject(podSpec)) {
    return { configMaps: [], secrets: [] };
  }
  for (const volume of podSpec.volumes || []) {
    add(configMaps, volume?.configMap?.name, `volume ${volume?.name || ""}`);
    add(secrets, volume?.secret?.secretName, `volume ${volume?.name || ""}`);
    for (const source of volume?.projected?.sources || []) {
      add(
        configMaps,
        source?.configMap?.name,
        `volume ${volume?.name || ""}`,
      );
      add(secrets, source?.secret?.name, `volume ${volume?.name || ""}`);
    }
  }
  const containers = [
    ...(podSpec.containers || []),
    ...(podSpec.initContainers || []),
    ...(podSpec.ephemeralContainers || []),
  ];
  for (const container of containers) {
    const containerName = container?.name || "";
    for (const envFrom of container?.envFrom || []) {
      add(configMaps, envFrom?.configMapRef?.name, `envFrom ${containerName}`);
      add(secrets, envFrom?.secretRef?.name, `envFrom ${containerName}`);
    }
    for (const env of container?.env || []) {
      add(
        configMaps,
        env?.valueFrom?.configMapKeyRef?.name,
        `env ${env?.name || ""}`,
      );
      add(
        secrets,
        env?.valueFrom?.secretKeyRef?.name,
        `env ${env?.name || ""}`,
      );
    }
  }
  for (const secret of podSpec.imagePullSecrets || []) {
    add(secrets, secret?.name, "imagePullSecrets");
  }
  const toList = (map: Map<string, string>): ReferencedName[] =>
    Array.from(map.entries())
      .map(([name, via]) => ({ name, via }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return { configMaps: toList(configMaps), secrets: toList(secrets) };
}

/** Pods whose pod spec references the given ConfigMap or Secret. */
export function PodsReferencing(
  pods: any[],
  kind: "ConfigMap" | "Secret",
  name: string,
): any[] {
  if (!name) {
    return [];
  }
  return (pods || []).filter((pod) => {
    const references = ReferencedConfigMapsAndSecrets(PodSpecOf(pod));
    const names =
      kind === "ConfigMap" ? references.configMaps : references.secrets;
    return names.some((reference) => reference.name === name);
  });
}

function OwnedBy(item: any, uid: string): boolean {
  if (!uid) {
    return false;
  }
  return (item?.metadata?.ownerReferences || []).some(
    (reference: any) => reference?.uid === uid,
  );
}

export function PodsOwnedBy(pods: any[], ownerUid: string): any[] {
  return (pods || []).filter((pod) => OwnedBy(pod, ownerUid));
}

export function ReplicaSetsOwnedBy(
  replicaSets: any[],
  ownerUid: string,
): any[] {
  return (replicaSets || []).filter((replicaSet) =>
    OwnedBy(replicaSet, ownerUid),
  );
}

function EventTimestamp(event: any): number {
  const value =
    event?.lastTimestamp ||
    event?.eventTime ||
    event?.metadata?.creationTimestamp ||
    "";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Events whose `involvedObject` is the given object. The UID is authoritative;
 * the kind/name/namespace tuple is the fallback when the event carries no UID.
 * Newest first, capped at `RELATED_EVENTS_CAP`.
 */
export function RelatedEvents(events: any[], object: any): any[] {
  const metadata = object?.metadata || {};
  const kind = object?.kind || "";
  const uid = metadata.uid;
  const name = metadata.name;
  const namespace = metadata.namespace || "";
  return (events || [])
    .filter((event) => {
      const involved = event?.involvedObject;
      if (!involved) {
        return false;
      }
      if (uid && involved.uid) {
        return involved.uid === uid;
      }
      return (
        involved.kind === kind &&
        involved.name === name &&
        (involved.namespace || "") === namespace
      );
    })
    .sort((a, b) => EventTimestamp(b) - EventTimestamp(a))
    .slice(0, RELATED_EVENTS_CAP);
}
