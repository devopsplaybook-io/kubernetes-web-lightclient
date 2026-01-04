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
    getPods() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("pods", {
        object: "pods",
        command: "get",
        argument: namespaceArg,
      });
    },
    getDeployments() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("deployments", {
        object: "deployments",
        command: "get",
        argument: namespaceArg,
      });
    },
    getServices() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("services", {
        object: "services",
        command: "get",
        argument: namespaceArg,
      });
    },
    getConfigMaps() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("configmaps", {
        object: "configmaps",
        command: "get",
        argument: namespaceArg,
      });
    },
    getPVCs() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("pvcs", { object: "pvc", command: "get", argument: namespaceArg });
    },
    getPVs() {
      this.getObject("pvs", { object: "pv", command: "get", argument: "" });
    },
    getSecrets() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("secrets", {
        object: "secrets",
        command: "get",
        argument: namespaceArg,
      });
    },
    getNodes() {
      this.getObject("nodes", {
        object: "nodes",
        command: "get",
        argument: "",
      });
    },
    getNamespaces() {
      this.getObject("namespaces", {
        object: "namespaces",
        command: "get",
        argument: "",
      });
    },
    getStatefulSets() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("statefulsets", {
        object: "statefulset",
        command: "get",
        argument: namespaceArg,
      });
    },
    getDaemonSets() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("daemonsets", {
        object: "daemonset",
        command: "get",
        argument: namespaceArg,
      });
    },
    getJobs() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("jobs", { object: "job", command: "get", argument: namespaceArg });
    },
    getCronJobs() {
      const namespaceArg = NamespaceStore().getNamespaceArgument;
      this.getObject("cronjobs", {
        object: "cronjob",
        command: "get",
        argument: namespaceArg,
      });
    },
    refreshLast() {
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
