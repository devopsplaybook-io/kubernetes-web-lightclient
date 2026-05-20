import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { ResourceService } from "~~/services/ResourceService";
import axios from "axios";
import { UtilsDecompressData } from "~/services/Utils";

// Map from old-style data keys (e.g. 'pods') to new type IDs (e.g. 'pod')
const OLD_KEY_TO_TYPE: { [key: string]: string } = {
  pods: "pod",
  deployments: "deployment",
  statefulsets: "statefulset",
  daemonSets: "daemonset",
  jobs: "job",
  cronjobs: "cronjob",
  services: "service",
  ingresses: "ingress",
  configMaps: "configmap",
  pvcs: "pvc",
  secrets: "secret",
  serviceAccounts: "serviceaccount",
  roles: "role",
  roleBindings: "rolebinding",
  namespaces: "namespace",
  nodes: "node",
  pvs: "pv",
  clusterRoles: "clusterrole",
  clusterRoleBindings: "clusterrolebinding",
  customResourceDefinitions: "customresourcedefinition",
};

// Reverse: new type ID -> old-style data key
const TYPE_TO_OLD_KEY: { [key: string]: string } = {};
for (const [oldKey, typeId] of Object.entries(OLD_KEY_TO_TYPE)) {
  TYPE_TO_OLD_KEY[typeId] = oldKey;
}

export const KubernetesObjectStore = defineStore("KubernetesObjectStore", {
  state: () => ({
    data: {} as { [key: string]: any[] },
    dataFull: {} as { [key: string]: any[] },
    selectedTypes: [] as string[],
    filter: { keyword: "", namespace: "" },
    lastCall: { payload: {} as any, type: "" },
    loading: false,
    hasEverLoaded: false,
  }),

  getters: {},

  actions: {
    // Backward-compatible getter methods for original per-type components
    async getPods() {
      await this.getObject("pod", {
        object: "pod",
        command: "get",
        argument: "-A",
      });
    },
    async getDeployments() {
      await this.getObject("deployment", {
        object: "deployment",
        command: "get",
        argument: "-A",
      });
    },
    async getStatefulSets() {
      await this.getObject("statefulset", {
        object: "statefulset",
        command: "get",
        argument: "-A",
      });
    },
    async getDaemonSets() {
      await this.getObject("daemonset", {
        object: "daemonset",
        command: "get",
        argument: "-A",
      });
    },
    async getJobs() {
      await this.getObject("job", {
        object: "job",
        command: "get",
        argument: "-A",
      });
    },
    async getCronJobs() {
      await this.getObject("cronjob", {
        object: "cronjob",
        command: "get",
        argument: "-A",
      });
    },
    async getServices() {
      await this.getObject("service", {
        object: "service",
        command: "get",
        argument: "-A",
      });
    },
    async getIngresses() {
      await this.getObject("ingress", {
        object: "ingress",
        command: "get",
        argument: "-A",
      });
    },
    async getConfigMaps() {
      await this.getObject("configmap", {
        object: "configmap",
        command: "get",
        argument: "-A",
      });
    },
    async getPvcs() {
      await this.getObject("pvc", {
        object: "pvc",
        command: "get",
        argument: "-A",
      });
    },
    async getSecrets() {
      await this.getObject("secret", {
        object: "secret",
        command: "get",
        argument: "-A",
      });
    },
    async getServiceAccounts() {
      await this.getObject("serviceaccount", {
        object: "serviceaccount",
        command: "get",
        argument: "-A",
      });
    },
    async getRoles() {
      await this.getObject("role", {
        object: "role",
        command: "get",
        argument: "-A",
      });
    },
    async getRoleBindings() {
      await this.getObject("rolebinding", {
        object: "rolebinding",
        command: "get",
        argument: "-A",
      });
    },
    async getNamespaces() {
      await this.getObject("namespace", {
        object: "namespace",
        command: "get",
        argument: "",
      });
    },
    async getNodes() {
      await this.getObject("node", {
        object: "node",
        command: "get",
        argument: "",
      });
    },
    async getPvs() {
      await this.getObject("pv", {
        object: "pv",
        command: "get",
        argument: "",
      });
    },
    async getClusterRoles() {
      await this.getObject("clusterrole", {
        object: "clusterrole",
        command: "get",
        argument: "",
      });
    },
    async getClusterRoleBindings() {
      await this.getObject("clusterrolebinding", {
        object: "clusterrolebinding",
        command: "get",
        argument: "",
      });
    },
    async getCustomResourceDefinitions() {
      await this.getObject("customresourcedefinition", {
        object: "customresourcedefinition",
        command: "get",
        argument: "",
      });
    },

    async loadSelectedTypes() {
      this.selectedTypes = await ResourceService.getUserSelections();
    },
    isTypeSelected(type: string): boolean {
      return this.selectedTypes.includes(type);
    },
    setFilterNamespace(namespace: string) {
      this.filter.namespace = namespace;
      this.applyFilter(this.lastCall.type);
    },
    setFilterKeyword(keyword: string) {
      this.filter.keyword = keyword;
      this.applyFilter(this.lastCall.type);
    },
    async refreshLast() {
      if (this.lastCall.type) {
        await this.getObject(this.lastCall.type, this.lastCall.payload);
      }
    },
    setLoading(value: boolean) {
      this.loading = value;
    },
    async getObject(type: string, payload: any) {
      this.lastCall.type = type;
      this.lastCall.payload = payload;
      this.loading = true;
      this.getObjectFull(type, payload)
        .then(async () => {
          this.loading = false;
          this.hasEverLoaded = true;
          return this.applyFilter(type);
        })
        .catch((error) => {
          this.loading = false;
          console.error(error);
        });
    },
    async getObjectFull(type: string, payload: any) {
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          payload,
          await AuthService.getAuthHeader(),
        )
        .then(async (response) => {
          const items: any[] = [];
          const parsed = JSON.parse(
            await UtilsDecompressData(response.data.result),
          );
          for (const item of parsed.items || []) {
            items.push(item);
          }
          this.dataFull[type] = items;
        });
    },
    async applyFilter(type: string) {
      const itemsFull = this.dataFull[type] || [];
      const items: any[] = [];
      for (const item of itemsFull) {
        if (
          this.filter.namespace &&
          item.metadata.namespace !== this.filter.namespace
        ) {
          continue;
        }
        if (!this.filter.keyword?.trim()) {
          items.push(item);
          continue;
        }
        const keywords = this.filter.keyword
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ")
          .split(" ");
        const itemString = JSON.stringify(item).trim().toLowerCase();
        if (keywords.every((keyword) => itemString.includes(keyword))) {
          items.push(item);
          continue;
        }
      }
      this.data[type] = items;
      // Also set old-style data key for backward compatibility with original components
      const oldKey = TYPE_TO_OLD_KEY[type];
      if (oldKey) {
        this.data[oldKey] = items;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(KubernetesObjectStore, import.meta.hot),
  );
}
