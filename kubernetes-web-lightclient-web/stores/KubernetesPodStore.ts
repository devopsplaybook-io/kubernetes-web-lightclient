import { Timeout } from "~~/services/Timeout";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";

export const KubernetesPodStore = defineStore("KubernetesPodStore", {
  state: () => ({
    lastUpdate: new Date(),
    data: [],
    loading: false,
    checkFrequency: 10000,
  }),

  getters: {},

  actions: {
    async get() {
      if (this.loading) {
        return;
      }
      this.loading = true;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          { object: "pods", command: "get", argument: "-A" },
          await AuthService.getAuthHeader()
        )
        .then((response) => {
          this.data = response.data.result.items;
        })
        .catch((error) => {
          console.error(error);
        });
      Timeout.wait(this.checkFrequency).then(() => {
        this.loading = false;
        this.get();
      });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(KubernetesPodStore, import.meta.hot));
}
