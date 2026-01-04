export const NamespaceStore = defineStore("NamespaceStore", {
  state: () => ({
    selectedNamespace: "all", // "all" or specific namespace name
    availableNamespaces: [] as string[],
  }),

  getters: {
    isAllNamespaces: (state) => state.selectedNamespace === "all",
    getNamespaceArgument: (state) => {
      if (state.selectedNamespace === "all") {
        return "-A";
      }
      return `-n ${state.selectedNamespace}`;
    },
  },

  actions: {
    setSelectedNamespace(namespace: string) {
      this.selectedNamespace = namespace;
      // Save to localStorage
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("SELECTED_NAMESPACE", namespace);
      }
    },

    loadSelectedNamespace() {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("SELECTED_NAMESPACE");
        if (saved) {
          this.selectedNamespace = saved;
        }
      }
    },

    setAvailableNamespaces(namespaces: string[]) {
      this.availableNamespaces = namespaces;
    },

    addNamespace(namespace: string) {
      if (!this.availableNamespaces.includes(namespace)) {
        this.availableNamespaces.push(namespace);
        this.availableNamespaces.sort();
      }
    },

    async loadNamespaces() {
      const KubernetesObjectStore = (await import("./KubernetesObjectStore"))
        .KubernetesObjectStore;
      const store = KubernetesObjectStore();
      await store.getNamespaces();
      const namespaces = store.data.namespaces
        .map((ns: any) => ns.metadata.name)
        .sort();
      console.log("Loaded namespaces:", namespaces);
      this.setAvailableNamespaces(namespaces);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NamespaceStore, import.meta.hot));
}
