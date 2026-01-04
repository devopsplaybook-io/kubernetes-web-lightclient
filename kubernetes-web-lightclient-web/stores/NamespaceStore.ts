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
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NamespaceStore, import.meta.hot));
}
