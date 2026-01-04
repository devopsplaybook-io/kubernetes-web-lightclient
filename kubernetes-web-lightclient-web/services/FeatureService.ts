const STORAGE_KEY = "DISABLED_FEATURES";

export const FEATURES = [
  { id: "node", name: "Nodes" },
  { id: "namespace", name: "Namespaces" },
  { id: "deployment", name: "Deployments" },
  { id: "statefulset", name: "StatefulSets" },
  { id: "daemonset", name: "DaemonSets" },
  { id: "pod", name: "Pods" },
  { id: "job", name: "Jobs" },
  { id: "cronjob", name: "CronJobs" },
  { id: "service", name: "Services" },
  { id: "pvc", name: "PVC" },
  { id: "pv", name: "PV" },
  { id: "configmap", name: "ConfigMap" },
  { id: "secret", name: "Secrets" },
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
}
