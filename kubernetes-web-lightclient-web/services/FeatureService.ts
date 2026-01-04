const STORAGE_KEY = "DISABLED_FEATURES";

export const FEATURES = [
  { id: "pod", name: "Pods", namespaced: true },
  { id: "deployment", name: "Deployments", namespaced: true },
  { id: "statefulset", name: "StatefulSets", namespaced: true },
  { id: "daemonset", name: "DaemonSets", namespaced: true },
  { id: "job", name: "Jobs", namespaced: true },
  { id: "cronjob", name: "CronJobs", namespaced: true },
  { id: "service", name: "Services", namespaced: true },
  { id: "ingress", name: "Ingresses", namespaced: true },
  { id: "configmap", name: "ConfigMap", namespaced: true },
  { id: "pvc", name: "PVC", namespaced: true },
  { id: "secret", name: "Secrets", namespaced: true },
  { id: "serviceaccount", name: "Service Accounts", namespaced: true },
  { id: "role", name: "Roles", namespaced: true },
  { id: "rolebinding", name: "Role Bindings", namespaced: true },
  { id: "namespace", name: "Namespaces", namespaced: false },
  { id: "node", name: "Nodes", namespaced: false },
  { id: "pv", name: "PV", namespaced: false },
  { id: "clusterrole", name: "Cluster Roles", namespaced: false },
  {
    id: "clusterrolebinding",
    name: "Cluster Role Bindings",
    namespaced: false,
  },
  {
    id: "customresourcedefinition",
    name: "Custom Resource Definitions",
    namespaced: false,
  },
] as const;

export type FeatureId = (typeof FEATURES)[number]["id"];

export class FeatureService {
  static getDisabledFeatures(): Set<FeatureId> {
    if (typeof localStorage === "undefined") {
      return new Set();
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return new Set();
      }
      return new Set(JSON.parse(stored));
    } catch (e) {
      console.error("Failed to parse disabled features:", e);
      return new Set();
    }
  }

  static setDisabledFeatures(disabledFeatures: Set<FeatureId>): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(disabledFeatures))
      );
    } catch (e) {
      console.error("Failed to save disabled features:", e);
    }
  }

  static isFeatureEnabled(featureId: FeatureId): boolean {
    const disabled = this.getDisabledFeatures();
    return !disabled.has(featureId);
  }

  static getEnabledFeatures(): FeatureId[] {
    const disabled = this.getDisabledFeatures();
    return FEATURES.map((f) => f.id).filter((id) => !disabled.has(id));
  }

  static toggleFeature(featureId: FeatureId): boolean {
    const disabled = this.getDisabledFeatures();
    if (disabled.has(featureId)) {
      disabled.delete(featureId);
      this.setDisabledFeatures(disabled);
      return true; // now enabled
    } else {
      disabled.add(featureId);
      this.setDisabledFeatures(disabled);
      return false; // now disabled
    }
  }

  static isFeatureNamespaced(featureId: FeatureId): boolean {
    const feature = FEATURES.find((f) => f.id === featureId);
    return feature?.namespaced ?? false;
  }
}
