const STORAGE_KEY = "DISABLED_FEATURES";

export const FEATURES = [
  { id: "node", name: "Nodes", namespaced: false },
  { id: "namespace", name: "Namespaces", namespaced: false },
  { id: "deployment", name: "Deployments", namespaced: true },
  { id: "statefulset", name: "StatefulSets", namespaced: true },
  { id: "daemonset", name: "DaemonSets", namespaced: true },
  { id: "pod", name: "Pods", namespaced: true },
  { id: "job", name: "Jobs", namespaced: true },
  { id: "cronjob", name: "CronJobs", namespaced: true },
  { id: "service", name: "Services", namespaced: true },
  { id: "pvc", name: "PVC", namespaced: true },
  { id: "pv", name: "PV", namespaced: false },
  { id: "configmap", name: "ConfigMap", namespaced: true },
  { id: "secret", name: "Secrets", namespaced: true },
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
