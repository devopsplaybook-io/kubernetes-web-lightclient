import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";
import { UtilsDecompressData } from "~/services/Utils";

export const KubernetesObjectStore = defineStore("KubernetesObjectStore", {
  state: () => ({
    data: {
      deployments: [],
      deploymentsFull: [],
      statefulsets: [],
      statefulsetsFull: [],
      daemonsets: [],
      daemonsetsFull: [],
      pods: [],
      podsFull: [],
      jobs: [],
      jobsFull: [],
      cronjobs: [],
      cronjobsFull: [],
      services: [],
      servicesFull: [],
      configmaps: [],
      configmapsFull: [],
      secrets: [],
      secretsFull: [],
      pvcs: [],
      pvcsFull: [],
      pvs: [],
      pvsFull: [],
      nodes: [],
      nodesFull: [],
      namespaces: [],
      namespacesFull: [],
      serviceaccounts: [],
      serviceaccountsFull: [],
      roles: [],
      rolesFull: [],
      clusterroles: [],
      clusterrolesFull: [],
      rolebindings: [],
      rolebindingsFull: [],
      clusterrolebindings: [],
      clusterrolebindingsFull: [],
      ingresses: [],
      ingressesFull: [],
      customresourcedefinitions: [],
      customresourcedefinitionsFull: [],
    },
    filter: { keyword: "", namespace: "" },
    lastCall: { payload: {}, type: "" },
  }),

  getters: {},

  actions: {
    setFilterNamespace(namespace: string) {
      this.filter.namespace = namespace;
      this.applyFilter(this.lastCall.type);
    },
    setFilterKeyword(keyword: string) {
      this.filter.keyword = keyword;
      this.applyFilter(this.lastCall.type);
    },
    async getPods() {
      await this.getObject("pods", {
        object: "pods",
        command: "get",
        argument: "-A",
      });
    },
    async getDeployments() {
      await this.getObject("deployments", {
        object: "deployments",
        command: "get",
        argument: "-A",
      });
    },
    async getServices() {
      await this.getObject("services", {
        object: "services",
        command: "get",
        argument: "-A",
      });
    },
    async getConfigMaps() {
      await this.getObject("configmaps", {
        object: "configmaps",
        command: "get",
        argument: "-A",
      });
    },
    async getPVCs() {
      await this.getObject("pvcs", {
        object: "pvc",
        command: "get",
        argument: "-A",
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
        argument: "-A",
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
        argument: "-A",
      });
    },
    async getDaemonSets() {
      await this.getObject("daemonsets", {
        object: "daemonset",
        command: "get",
        argument: "-A",
      });
    },
    async getJobs() {
      await this.getObject("jobs", {
        object: "job",
        command: "get",
        argument: "-A",
      });
    },
    async getCronJobs() {
      await this.getObject("cronjobs", {
        object: "cronjob",
        command: "get",
        argument: "-A",
      });
    },
    async getServiceAccounts() {
      await this.getObject("serviceaccounts", {
        object: "serviceaccount",
        command: "get",
        argument: "-A",
      });
    },
    async getRoles() {
      await this.getObject("roles", {
        object: "role",
        command: "get",
        argument: "-A",
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
        argument: "-A",
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
        argument: "-A",
      });
    },
    async getCustomResourceDefinitions() {
      await this.getObject("customresourcedefinitions", {
        object: "customresourcedefinition",
        command: "get",
        argument: "",
      });
    },
    async refreshLast() {
      await this.getObject(this.lastCall.type, this.lastCall.payload);
    },
    async getObject(type: string, payload: any) {
      console.log(this.filter);
      this.lastCall.type = type;
      this.lastCall.payload = payload;
      this.getObjectFull(type, payload)
        .then(async () => {
          return this.applyFilter(type);
        })
        .catch((error) => {
          console.error(error);
        });
    },
    async getObjectFull(type: string, payload: any) {
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
            items.push(item);
          }
          (this.data as any)[type + "Full"] = items;
        });
    },
    async applyFilter(type: string) {
      const itemsFull = (this.data as any)[type + "Full"];
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
      (this.data as any)[type] = items;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(KubernetesObjectStore, import.meta.hot)
  );
}
