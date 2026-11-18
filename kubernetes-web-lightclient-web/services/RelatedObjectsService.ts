/**
 * I/O for the Related tab. Every read goes through the existing validated
 * `POST /api/kubectl/command` route with a plain `get` (the workload-pods
 * helper reuses G1's validated pod selector); all matching is done
 * client-side. Sections load in bounded parallel waves and their failures are
 * captured individually so one missing resource type cannot empty the tab.
 */
import axios from "axios";
import { getObjectJson } from "~~/services/ManifestService";
import {
  GetList,
  FetchWorkloadPods,
  PostKubectl,
} from "~~/services/WorkloadPodsService";
import {
  RELATED_OWNER_MAX_DEPTH,
  RELATED_SECTION_CAP,
  IngressServiceNames,
  OwnerRefs,
  PodTemplateLabels,
  PodsOwnedBy,
  PodsReferencing,
  ReferencedConfigMapsAndSecrets,
  RelatedEvents,
  ReplicaSetsOwnedBy,
  RoutingIngresses,
  SelectingServices,
  SelectorMatchesLabels,
  type ReferencedName,
} from "~~/services/RelatedObjects";
import { PodSpecOf } from "~~/services/GlobalSearch";
import { KindToTypeId, type ResourceTypeLike } from "~~/services/ObjectLinks";
import type { WorkloadKind } from "~~/services/WorkloadPods";

const RELATED_LOAD_CONCURRENCY = 4;
const WORKLOAD_TYPES = [
  "deployment",
  "statefulset",
  "daemonset",
  "job",
  "cronjob",
];

export interface RelatedOwner {
  kind: string;
  name: string;
  namespace: string;
  typeId: string | null;
}

export interface RelatedSectionError {
  section: string;
  message: string;
}

export interface RelatedObjectsResult {
  kind: string;
  owners: RelatedOwner[];
  pods: any[];
  replicaSets: any[];
  services: any[];
  ingresses: any[];
  configMaps: ReferencedName[];
  secrets: ReferencedName[];
  node: any | null;
  events: any[];
  usedByPods: any[];
  errors: RelatedSectionError[];
}

export interface FetchRelatedObjectsInput {
  objectType: string;
  namespace: string;
  name: string;
  types: ResourceTypeLike[];
}

interface SectionTask {
  section: string;
  run: () => Promise<void>;
}

function ErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) {
      return "No longer available.";
    }
    if (error.response?.status === 429) {
      return "Server is busy.";
    }
  }
  return error instanceof Error && error.message
    ? error.message
    : "Failed to load.";
}

async function RunWithConcurrency(
  tasks: SectionTask[],
  limit: number,
  errors: RelatedSectionError[],
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        try {
          await task.run();
        } catch (error) {
          errors.push({ section: task.section, message: ErrorMessage(error) });
        }
      }
    },
  );
  await Promise.all(workers);
}

async function GetItems(
  object: string,
  namespace: string,
  allNamespaces = false,
): Promise<any[]> {
  if (allNamespaces) {
    const result = await PostKubectl(
      { object, command: "get", argument: "-A" },
      `Failed to load ${object} objects.`,
    );
    return result.items || [];
  }
  return GetList(object, namespace);
}

function Cap(items: any[]): any[] {
  return (items || []).slice(0, RELATED_SECTION_CAP);
}

async function LoadOwnerChain(
  manifest: any,
  types: ResourceTypeLike[],
  fallbackNamespace: string,
): Promise<RelatedOwner[]> {
  const owners: RelatedOwner[] = [];
  const seen = new Set<string>();
  let current = manifest;
  while (owners.length < RELATED_OWNER_MAX_DEPTH) {
    const references = OwnerRefs(current);
    if (references.length === 0) {
      break;
    }
    const reference = references.find((owner) => owner.controller) || references[0];
    const namespace = current?.metadata?.namespace || fallbackNamespace || "";
    const typeId = KindToTypeId(reference.kind, types);
    owners.push({
      kind: reference.kind,
      name: reference.name,
      namespace,
      typeId,
    });
    if (!typeId) {
      break;
    }
    const key = `${typeId}/${namespace}/${reference.name}`;
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    try {
      current = await getObjectJson(typeId, namespace, reference.name);
    } catch {
      break;
    }
  }
  return owners;
}

/**
 * Load the manifest of the object and everything it is related to. The
 * manifest itself is required (its failure rejects); every relation section is
 * best-effort and reports its own error.
 */
export async function FetchRelatedObjects(
  input: FetchRelatedObjectsInput,
): Promise<RelatedObjectsResult> {
  const { objectType, namespace, name, types } = input;
  const manifest = await getObjectJson(objectType, namespace, name);
  const objectNamespace = manifest?.metadata?.namespace || namespace || "";

  const result: RelatedObjectsResult = {
    kind: String(manifest?.kind || ""),
    owners: [],
    pods: [],
    replicaSets: [],
    services: [],
    ingresses: [],
    configMaps: [],
    secrets: [],
    node: null,
    events: [],
    usedByPods: [],
    errors: [],
  };
  const tasks: SectionTask[] = [];

  tasks.push({
    section: "owners",
    run: async () => {
      result.owners = await LoadOwnerChain(manifest, types || [], objectNamespace);
    },
  });

  tasks.push({
    section: "events",
    run: async () => {
      const events = await GetItems("events", objectNamespace, !objectNamespace);
      result.events = RelatedEvents(events, manifest);
    },
  });

  if (WORKLOAD_TYPES.includes(objectType)) {
    tasks.push({
      section: "pods",
      run: async () => {
        const podsResult = await FetchWorkloadPods({
          kind: objectType as WorkloadKind,
          name,
          namespace: objectNamespace,
        });
        result.pods = Cap(podsResult.pods);
      },
    });
  }

  if (objectType === "deployment") {
    tasks.push({
      section: "replicaSets",
      run: async () => {
        const replicaSets = await GetItems("replicaset", objectNamespace);
        result.replicaSets = Cap(
          ReplicaSetsOwnedBy(replicaSets, manifest?.metadata?.uid),
        );
      },
    });
  }

  if (objectType === "replicaset") {
    tasks.push({
      section: "pods",
      run: async () => {
        const pods = await GetItems("pod", objectNamespace);
        result.pods = Cap(PodsOwnedBy(pods, manifest?.metadata?.uid));
      },
    });
  }

  if (objectType === "pod" && manifest?.spec?.nodeName) {
    tasks.push({
      section: "node",
      run: async () => {
        result.node = await getObjectJson("node", "", manifest.spec.nodeName);
      },
    });
  }

  if (objectType === "service") {
    tasks.push({
      section: "pods",
      run: async () => {
        const pods = await GetItems("pod", objectNamespace);
        result.pods = Cap(
          pods.filter((pod) =>
            SelectorMatchesLabels(manifest?.spec?.selector, pod?.metadata?.labels),
          ),
        );
      },
    });
    tasks.push({
      section: "ingresses",
      run: async () => {
        const ingresses = await GetItems("ingress", objectNamespace);
        result.ingresses = Cap(RoutingIngresses(ingresses, [name]));
      },
    });
  }

  if (objectType === "ingress") {
    const serviceNames = IngressServiceNames(manifest);
    tasks.push({
      section: "services",
      run: async () => {
        const services = await GetItems("service", objectNamespace);
        const names = new Set(serviceNames);
        result.services = Cap(
          services.filter((service) => names.has(service?.metadata?.name)),
        );
      },
    });
  }

  if (objectType === "configmap" || objectType === "secret") {
    const kind = objectType === "secret" ? "Secret" : "ConfigMap";
    tasks.push({
      section: "usedByPods",
      run: async () => {
        const pods = await GetItems("pod", objectNamespace);
        result.usedByPods = Cap(
          PodsReferencing(pods, kind as "ConfigMap" | "Secret", name),
        );
      },
    });
  }

  const podSpec = PodSpecOf(manifest);
  if (podSpec) {
    const references = ReferencedConfigMapsAndSecrets(podSpec);
    result.configMaps = Cap(references.configMaps);
    result.secrets = Cap(references.secrets);
  }

  // Services and Ingresses route to the object through its pod template
  // labels (a pod's own labels, a workload's template labels, ...).
  if (podSpec && objectType !== "service" && objectType !== "ingress") {
    const labels = PodTemplateLabels(manifest);
    if (Object.keys(labels || {}).length > 0) {
      tasks.push({
        section: "services",
        run: async () => {
          const services = await GetItems("service", objectNamespace);
          const selecting = SelectingServices(services, labels);
          result.services = Cap(selecting);
          const serviceNames = selecting.map(
            (service) => service?.metadata?.name,
          );
          const ingresses = await GetItems("ingress", objectNamespace);
          result.ingresses = Cap(RoutingIngresses(ingresses, serviceNames));
        },
      });
    }
  }

  await RunWithConcurrency(tasks, RELATED_LOAD_CONCURRENCY, result.errors);
  return result;
}
