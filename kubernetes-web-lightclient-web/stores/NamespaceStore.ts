export const NamespaceStore = defineStore("NamespaceStore", {
  state: () => ({
    selectedNamespace: "all",
    availableNamespaces: [] as string[],
  }),

  getters: {
    isAllNamespaces: (state) => state.selectedNamespace === "all",
  },

  actions: {
    setSelectedNamespace(namespace: string) {
      this.selectedNamespace = namespace;
    },

    setAvailableNamespaces(namespaces: string[]) {
      this.availableNamespaces = namespaces;
    },

    async loadNamespaces() {
      const KubernetesObjectStore = (await import("./KubernetesObjectStore"))
        .KubernetesObjectStore;
      await KubernetesObjectStore().getNamespaces();
      const namespaces = KubernetesObjectStore()
        .data.namespaces.map((ns: any) => ns.metadata.name)
        .sort();
      this.setAvailableNamespaces(namespaces);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NamespaceStore, import.meta.hot));
}
