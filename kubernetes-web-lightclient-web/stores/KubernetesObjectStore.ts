import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { ResourceService } from "~~/services/ResourceService";
import axios from "axios";
import { UtilsDecompressData } from "~/services/Utils";

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
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(KubernetesObjectStore, import.meta.hot),
  );
}
