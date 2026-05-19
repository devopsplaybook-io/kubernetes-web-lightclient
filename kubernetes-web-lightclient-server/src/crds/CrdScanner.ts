import * as cron from "node-cron";
import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { OTelLogger } from "../OTelContext";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

const logger = OTelLogger().createModuleLogger("CrdScanner");

export interface ResourceType {
  id: string;
  name: string;
  namespaced: boolean;
  isCrd: boolean;
  group: string;
}

const BUILT_IN_RESOURCES: ResourceType[] = [
  { id: "pod", name: "Pods", namespaced: true, isCrd: false, group: "" },
  {
    id: "deployment",
    name: "Deployments",
    namespaced: true,
    isCrd: false,
    group: "apps",
  },
  {
    id: "statefulset",
    name: "StatefulSets",
    namespaced: true,
    isCrd: false,
    group: "apps",
  },
  {
    id: "daemonset",
    name: "DaemonSets",
    namespaced: true,
    isCrd: false,
    group: "apps",
  },
  { id: "job", name: "Jobs", namespaced: true, isCrd: false, group: "batch" },
  {
    id: "cronjob",
    name: "CronJobs",
    namespaced: true,
    isCrd: false,
    group: "batch",
  },
  {
    id: "service",
    name: "Services",
    namespaced: true,
    isCrd: false,
    group: "",
  },
  {
    id: "ingress",
    name: "Ingresses",
    namespaced: true,
    isCrd: false,
    group: "networking.k8s.io",
  },
  {
    id: "configmap",
    name: "ConfigMaps",
    namespaced: true,
    isCrd: false,
    group: "",
  },
  { id: "pvc", name: "PVCs", namespaced: true, isCrd: false, group: "" },
  { id: "secret", name: "Secrets", namespaced: true, isCrd: false, group: "" },
  {
    id: "serviceaccount",
    name: "Service Accounts",
    namespaced: true,
    isCrd: false,
    group: "",
  },
  {
    id: "role",
    name: "Roles",
    namespaced: true,
    isCrd: false,
    group: "rbac.authorization.k8s.io",
  },
  {
    id: "rolebinding",
    name: "Role Bindings",
    namespaced: true,
    isCrd: false,
    group: "rbac.authorization.k8s.io",
  },
  {
    id: "namespace",
    name: "Namespaces",
    namespaced: false,
    isCrd: false,
    group: "",
  },
  { id: "node", name: "Nodes", namespaced: false, isCrd: false, group: "" },
  {
    id: "pv",
    name: "PersistentVolumes",
    namespaced: false,
    isCrd: false,
    group: "",
  },
  {
    id: "clusterrole",
    name: "Cluster Roles",
    namespaced: false,
    isCrd: false,
    group: "rbac.authorization.k8s.io",
  },
  {
    id: "clusterrolebinding",
    name: "Cluster Role Bindings",
    namespaced: false,
    isCrd: false,
    group: "rbac.authorization.k8s.io",
  },
  {
    id: "customresourcedefinition",
    name: "Custom Resource Definitions",
    namespaced: false,
    isCrd: false,
    group: "apiextensions.k8s.io",
  },
];

const CRD_SCAN_INTERVAL = "0 0 * * *"; // Daily at midnight
const RESOURCES_FILE = "available-resources.json";

let availableResources: ResourceType[] = [...BUILT_IN_RESOURCES];
let resourcesFilePath: string;

export function CrdScannerGetAvailableResources(): ResourceType[] {
  return [...availableResources];
}

export function CrdScannerGetBuiltinResources(): string[] {
  return BUILT_IN_RESOURCES.map((r) => r.id);
}

export async function CrdScannerInit(config: Config): Promise<void> {
  resourcesFilePath = path.join(config.DATA_DIR, RESOURCES_FILE);
  logger.info(`Resources file path: ${resourcesFilePath}`);

  // Load from disk first (if exists) so we have data even before first scan succeeds
  await loadFromDisk();

  // Initial scan
  await scanCrds();

  // Schedule daily scan
  cron.schedule(CRD_SCAN_INTERVAL, async () => {
    logger.info("Running scheduled CRD scan");
    await scanCrds();
  });
}

export async function CrdScannerRefresh(): Promise<ResourceType[]> {
  await scanCrds();
  return CrdScannerGetAvailableResources();
}

async function scanCrds(): Promise<void> {
  logger.info("Scanning cluster for CRDs...");
  try {
    const commandOutput = await SystemCommandExecute(
      "kubectl get customresourcedefinition -o json | gzip | base64 -w 0",
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
      },
    );

    const binaryString = atob(commandOutput);
    const byteArray = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      byteArray[i] = binaryString.charCodeAt(i);
    }
    const decompressionStream = new DecompressionStream("gzip");
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(byteArray);
        controller.close();
      },
    });
    const response = new Response(
      readableStream.pipeThrough(decompressionStream),
    );
    const arrayBuffer = await response.arrayBuffer();
    const jsonStr = new TextDecoder().decode(arrayBuffer);
    const crdList = JSON.parse(jsonStr);

    const crdResources: ResourceType[] = [];
    if (crdList.items) {
      for (const crd of crdList.items) {
        const names = crd.spec?.names;
        const group = crd.spec?.group || "";
        if (!names || !names.plural) continue;

        const id = names.plural;
        // Skip if already a built-in resource (avoid duplicates)
        if (BUILT_IN_RESOURCES.some((r) => r.id === id)) continue;

        const displayName = names.kind || names.plural;
        const namespaced = crd.spec?.scope === "Namespaced";

        crdResources.push({
          id,
          name: `${displayName} (CRD)`,
          namespaced,
          isCrd: true,
          group,
        });
      }
    }

    // Merge: built-in + CRDs, with built-in always first
    const existingCrdIds = new Set(crdResources.map((r) => r.id));
    const filteredExisting = availableResources.filter(
      (r) => !r.isCrd || existingCrdIds.has(r.id),
    );
    const newBuiltIn = filteredExisting.filter((r) => !r.isCrd);
    const existingCrds = filteredExisting.filter((r) => r.isCrd);

    // Keep CRDs that still exist, add new ones, remove stale ones
    const crdMap = new Map<string, ResourceType>();
    for (const crd of existingCrds) crdMap.set(crd.id, crd);
    for (const crd of crdResources) crdMap.set(crd.id, crd);

    availableResources = [...newBuiltIn, ...Array.from(crdMap.values())];
    await saveToDisk();
    logger.info(
      `CRD scan complete: ${availableResources.length} total resources (${crdMap.size} CRDs)`,
    );
  } catch (error) {
    logger.error(`CRD scan failed: ${error.message}`, error);
    // If we already have data on disk, keep using it
    if (availableResources.length === 0) {
      availableResources = [...BUILT_IN_RESOURCES];
    }
  }
}

async function loadFromDisk(): Promise<void> {
  try {
    if (await fse.pathExists(resourcesFilePath)) {
      const data = await fse.readJson(resourcesFilePath);
      if (data && Array.isArray(data) && data.length > 0) {
        availableResources = data;
        logger.info(`Loaded ${availableResources.length} resources from disk`);
      }
    }
  } catch (error) {
    logger.warn(`Could not load resources from disk: ${error.message}`);
  }
}

async function saveToDisk(): Promise<void> {
  try {
    await fse.ensureDir(path.dirname(resourcesFilePath));
    await fse.writeJson(resourcesFilePath, availableResources, { spaces: 2 });
  } catch (error) {
    logger.error(`Failed to save resources to disk: ${error.message}`, error);
  }
}
