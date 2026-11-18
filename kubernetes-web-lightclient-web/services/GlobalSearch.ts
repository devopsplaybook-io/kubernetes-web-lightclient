/**
 * Pure helpers for the global command palette: search-document extraction,
 * AND-token matching, scoring and grouped result shaping. Kept free of I/O so
 * the matching rules are unit-testable without a cluster.
 */
import { ParseKeywords } from "~~/services/KeywordFilter";
import { getPodStatus } from "~~/services/KubernetesUtils";
import { UtilsRelativeTime } from "~~/services/Utils";
import type { ResourceTypeLike } from "~~/services/ObjectLinks";

export const PALETTE_DEBOUNCE_MS = 200;
export const PALETTE_MAX_RESULTS = 50;
export const PALETTE_MAX_PER_TYPE = 8;
export const PALETTE_MAX_QUERY_LENGTH = 200;

export interface SearchDocument {
  name: string;
  namespace: string;
  labels: string;
  images: string;
  nodes: string;
  ips: string;
}

export interface SearchMatch {
  score: number;
  reason: "name" | "label" | "image" | "node" | "ip" | "namespace";
}

export interface SearchResultItem {
  object: any;
  typeId: string;
  typeName: string;
  name: string;
  namespace: string;
  statusText: string;
  reason: SearchMatch["reason"];
  score: number;
}

export interface SearchGroup {
  typeId: string;
  typeName: string;
  total: number;
  items: SearchResultItem[];
}

export interface SearchObjectsInput {
  types: ResourceTypeLike[];
  itemsByType: Record<string, any[]>;
}

function IsObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object";
}

/**
 * The pod spec carried by a Pod or by a workload's pod template. Returns
 * null for objects that embed no pod template (Services, ConfigMaps, ...).
 */
export function PodSpecOf(object: any): any | null {
  if (!IsObject(object) || !IsObject(object.spec)) {
    return null;
  }
  const spec = object.spec;
  if (
    Array.isArray(spec.containers) ||
    Array.isArray(spec.initContainers) ||
    Array.isArray(spec.ephemeralContainers)
  ) {
    return spec;
  }
  if (IsObject(spec.template) && IsObject(spec.template.spec)) {
    return spec.template.spec;
  }
  if (
    IsObject(spec.jobTemplate) &&
    IsObject(spec.jobTemplate.spec) &&
    IsObject(spec.jobTemplate.spec.template) &&
    IsObject(spec.jobTemplate.spec.template.spec)
  ) {
    return spec.jobTemplate.spec.template.spec;
  }
  return null;
}

function ContainerImages(containers: any): string[] {
  if (!Array.isArray(containers)) {
    return [];
  }
  return containers
    .map((container) => container?.image)
    .filter((image): image is string => typeof image === "string" && !!image);
}

export function CollectImages(object: any): string[] {
  const spec = PodSpecOf(object);
  if (!spec) {
    return [];
  }
  return Array.from(
    new Set([
      ...ContainerImages(spec.containers),
      ...ContainerImages(spec.initContainers),
      ...ContainerImages(spec.ephemeralContainers),
    ]),
  );
}

export function CollectNodeNames(object: any): string[] {
  const names = new Set<string>();
  if (IsObject(object?.spec) && typeof object.spec.nodeName === "string") {
    names.add(object.spec.nodeName);
  }
  const spec = PodSpecOf(object);
  if (spec && typeof spec.nodeName === "string" && spec.nodeName) {
    names.add(spec.nodeName);
  }
  return Array.from(names);
}

function PushString(target: string[], value: unknown) {
  if (typeof value === "string" && value) {
    target.push(value);
  }
}

export function CollectIPs(object: any): string[] {
  const ips: string[] = [];
  const status = object?.status || {};
  const spec = object?.spec || {};
  PushString(ips, status.podIP);
  PushString(ips, status.hostIP);
  for (const entry of status.podIPs || []) {
    PushString(ips, entry?.ip);
  }
  PushString(ips, spec.clusterIP);
  for (const ip of spec.clusterIPs || []) {
    PushString(ips, ip);
  }
  for (const ip of spec.externalIPs || []) {
    PushString(ips, ip);
  }
  for (const ingress of status.loadBalancer?.ingress || []) {
    PushString(ips, ingress?.ip);
    PushString(ips, ingress?.hostname);
  }
  for (const address of status.addresses || []) {
    PushString(ips, address?.address);
  }
  return Array.from(new Set(ips));
}

export function BuildSearchDocument(object: any): SearchDocument {
  const labels = IsObject(object?.metadata?.labels)
    ? Object.entries(object.metadata.labels)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")
    : "";
  const metadata = object?.metadata || {};
  return {
    name: String(metadata.name || "").toLowerCase(),
    namespace: String(metadata.namespace || "").toLowerCase(),
    labels: labels.toLowerCase(),
    images: CollectImages(object).join(" ").toLowerCase(),
    nodes: CollectNodeNames(object).join(" ").toLowerCase(),
    ips: CollectIPs(object).join(" ").toLowerCase(),
  };
}

const scoreCache = new WeakMap<object, SearchDocument>();

function DocumentOf(object: any): SearchDocument {
  if (!IsObject(object)) {
    return BuildSearchDocument(object);
  }
  const cached = scoreCache.get(object);
  if (cached) {
    return cached;
  }
  const document = BuildSearchDocument(object);
  scoreCache.set(object, document);
  return document;
}

interface FieldScore {
  score: number;
  reason: SearchMatch["reason"];
}

function BestFieldScore(document: SearchDocument, token: string): FieldScore | null {
  if (!token) {
    return null;
  }
  if (document.name === token) {
    return { score: 100, reason: "name" };
  }
  if (document.name.startsWith(token)) {
    return { score: 80, reason: "name" };
  }
  if (document.name.includes(token)) {
    return { score: 60, reason: "name" };
  }
  if (document.labels.includes(token)) {
    return { score: 50, reason: "label" };
  }
  if (document.images.includes(token)) {
    return { score: 40, reason: "image" };
  }
  if (document.nodes.includes(token)) {
    return { score: 35, reason: "node" };
  }
  if (document.ips.includes(token)) {
    return { score: 30, reason: "ip" };
  }
  if (document.namespace.includes(token)) {
    return { score: 20, reason: "namespace" };
  }
  return null;
}

/**
 * Every token must match at least one field (the same AND semantics as the
 * list keyword filter); the per-field scores are summed so a match on the
 * name dominates a match on a label or an IP.
 */
export function ScoreMatch(
  document: SearchDocument,
  tokens: string[],
): SearchMatch | null {
  if (!tokens || tokens.length === 0) {
    return null;
  }
  let score = 0;
  let reason: SearchMatch["reason"] | null = null;
  let best = -1;
  for (const token of tokens) {
    const field = BestFieldScore(document, token);
    if (!field) {
      return null;
    }
    score += field.score;
    if (field.score > best) {
      best = field.score;
      reason = field.reason;
    }
  }
  return reason ? { score, reason } : null;
}

function NodeReady(node: any): boolean {
  const conditions = node?.status?.conditions || [];
  return conditions.some(
    (condition: any) => condition?.type === "Ready" && condition?.status === "True",
  );
}

export function ObjectStatusText(object: any, typeId: string): string {
  if (typeId === "pod") {
    return getPodStatus(object);
  }
  if (
    typeId === "deployment" ||
    typeId === "statefulset" ||
    typeId === "daemonset" ||
    typeId === "replicaset"
  ) {
    const ready = object?.status?.readyReplicas || 0;
    const total = object?.status?.replicas ?? object?.spec?.replicas ?? 0;
    return `${ready}/${total} ready`;
  }
  if (typeId === "job") {
    const succeeded = object?.status?.succeeded || 0;
    const completions = object?.spec?.completions ?? 1;
    return `${succeeded}/${completions} succeeded`;
  }
  if (typeId === "node") {
    return NodeReady(object) ? "Ready" : "NotReady";
  }
  const creationTimestamp = object?.metadata?.creationTimestamp;
  if (creationTimestamp) {
    return `${UtilsRelativeTime(creationTimestamp)} old`;
  }
  return "";
}

function CompareItems(a: SearchResultItem, b: SearchResultItem): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.namespace.localeCompare(b.namespace);
}

/**
 * Search the loaded items of the given types and return per-type groups in
 * input order. Groups with no match are omitted; each group is capped to
 * `PALETTE_MAX_PER_TYPE` rows and the whole result to `PALETTE_MAX_RESULTS`.
 */
export function SearchObjects(
  input: SearchObjectsInput,
  query: string,
): SearchGroup[] {
  const tokens = ParseKeywords(
    (query || "").slice(0, PALETTE_MAX_QUERY_LENGTH),
  );
  if (tokens.length === 0) {
    return [];
  }
  const groups: SearchGroup[] = [];
  let emitted = 0;
  for (const type of input.types || []) {
    if (emitted >= PALETTE_MAX_RESULTS) {
      break;
    }
    const items = input.itemsByType?.[type.id] || [];
    const matches: SearchResultItem[] = [];
    for (const object of items) {
      const document = DocumentOf(object);
      const match = ScoreMatch(document, tokens);
      if (!match) {
        continue;
      }
      matches.push({
        object,
        typeId: type.id,
        typeName: type.name,
        name: String(object?.metadata?.name || ""),
        namespace: String(object?.metadata?.namespace || ""),
        statusText: ObjectStatusText(object, type.id),
        reason: match.reason,
        score: match.score,
      });
    }
    if (matches.length === 0) {
      continue;
    }
    matches.sort(CompareItems);
    const budget = Math.min(
      PALETTE_MAX_PER_TYPE,
      PALETTE_MAX_RESULTS - emitted,
    );
    const selected = matches.slice(0, budget);
    emitted += selected.length;
    groups.push({
      typeId: type.id,
      typeName: type.name,
      total: matches.length,
      items: selected,
    });
  }
  return groups;
}
