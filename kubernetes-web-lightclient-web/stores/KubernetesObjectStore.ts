import { Timeout } from "~~/services/Timeout";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";

export const KubernetesObjectStore = defineStore("KubernetesObjectStore", {
  state: () => ({
    data: { deployments: [], statefulset: [], pods: [], services: [], configmaps: [], secrets: [], pvc: [] },
  }),

  getters: {},

  actions: {
    getPods() {
      this.getObject("pods", { object: "pods", command: "get", argument: "-A" });
    },
    getDeployments() {
      this.getObject("deployments", { object: "deployments", command: "get", argument: "-A" });
    },
    getServices() {
      this.getObject("services", { object: "services", command: "get", argument: "-A" });
    },
    getConfigMaps() {
      this.getObject("configmaps", { object: "configmaps", command: "get", argument: "-A" });
    },
    getPVCs() {
      this.getObject("pvc", { object: "pvc", command: "get", argument: "-A" });
    },
    getSecrets() {
      this.getObject("secrets", { object: "secrets", command: "get", argument: "-A" });
    },
    getStatefulSets() {
      this.getObject("statefulset", { object: "statefulset", command: "get", argument: "-A" });
    },
    async getObject(type: string, payload: any) {
      await axios
        .post(`${(await Config.get()).SERVER_URL}/kubectl/command`, payload, await AuthService.getAuthHeader())
        .then((response) => {
          (this.data as any)[type] = response.data.result.items;
        })
        .catch((error) => {
          console.error(error);
        });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(KubernetesObjectStore, import.meta.hot));
}
