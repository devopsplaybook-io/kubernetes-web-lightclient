import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";
import { UtilsDecompressData } from "~/services/Utils";

export const KubernetesObjectStore = defineStore("KubernetesObjectStore", {
  state: () => ({
    data: {
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      pods: [],
      jobs: [],
      cronjobs: [],
      services: [],
      configmaps: [],
      secrets: [],
      pvcs: [],
      pvs: [],
      nodes: [],
      namespaces: [],
      serviceaccounts: [],
      roles: [],
      clusterroles: [],
      rolebindings: [],
      clusterrolebindings: [],
      ingresses: [],
      customresourcedefinitions: [],
    },
    filter: "",
    lastCall: { payload: {}, type: "" },
  }),

  getters: {},

  actions: {
    setFilter(filter: string) {
      this.filter = filter;
      this.refreshLast();
    },
    async getPods() {
      await this.getObject("pods", {
        object: "pods",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getDeployments() {
      await this.getObject("deployments", {
        object: "deployments",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getServices() {
      await this.getObject("services", {
        object: "services",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getConfigMaps() {
      await this.getObject("configmaps", {
        object: "configmaps",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getPVCs() {
      await this.getObject("pvcs", {
        object: "pvc",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getPVs() {
      await this.getObject("pvs", {
        object: "pv",
        command: "get",
        argument: "",
      });
    },
    async getSecrets() {
      await this.getObject("secrets", {
        object: "secrets",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getNodes() {
      await this.getObject("nodes", {
        object: "nodes",
        command: "get",
        argument: "",
      });
    },
    async getNamespaces() {
      await this.getObject("namespaces", {
        object: "namespaces",
        command: "get",
        argument: "",
      });
    },
    async getStatefulSets() {
      await this.getObject("statefulsets", {
        object: "statefulset",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getDaemonSets() {
      await this.getObject("daemonsets", {
        object: "daemonset",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getJobs() {
      await this.getObject("jobs", {
        object: "job",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getCronJobs() {
      await this.getObject("cronjobs", {
        object: "cronjob",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getServiceAccounts() {
      await this.getObject("serviceaccounts", {
        object: "serviceaccount",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getRoles() {
      await this.getObject("roles", {
        object: "role",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getClusterRoles() {
      await this.getObject("clusterroles", {
        object: "clusterrole",
        command: "get",
        argument: "",
      });
    },
    async getRoleBindings() {
      await this.getObject("rolebindings", {
        object: "rolebinding",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getClusterRoleBindings() {
      await this.getObject("clusterrolebindings", {
        object: "clusterrolebinding",
        command: "get",
        argument: "",
      });
    },
    async getIngresses() {
      await this.getObject("ingresses", {
        object: "ingress",
        command: "get",
        argument: NamespaceStore().getNamespaceArgument,
      });
    },
    async getCustomResourceDefinitions() {
      await this.getObject("customresourcedefinitions", {
        object: "customresourcedefinition",
        command: "get",
        argument: "",
      });
    },
    refreshLast() {
      (this.lastCall.payload as any).argument =
        NamespaceStore().getNamespaceArgument;
      this.getObject(this.lastCall.type, this.lastCall.payload);
    },
    async getObject(type: string, payload: any) {
      this.lastCall.type = type;
      this.lastCall.payload = payload;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          payload,
          await AuthService.getAuthHeader()
        )
        .then(async (response) => {
          const items: any[] = [];
          for (const item of JSON.parse(
            await UtilsDecompressData(response.data.result)
          ).items) {
            if (!this.filter.trim()) {
              items.push(item);
              continue;
            }
            const keywords = this.filter
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
          (this.data as any)[type] = items;
        })
        .catch((error) => {
          console.error(error);
        });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(KubernetesObjectStore, import.meta.hot)
  );
}
