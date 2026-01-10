export const NamespaceStore = defineStore("NamespaceStore", {
  state: () => ({
    availableNamespaces: [] as string[],
  }),

  getters: {},

  actions: {
    async loadNamespaces() {
      await KubernetesObjectStore().getObjectFull("namespaces", {
        object: "namespaces",
        command: "get",
        argument: "",
      });
      const namespaces = JSON.parse(
        JSON.stringify(KubernetesObjectStore().data.namespacesFull)
      )
        .map((ns: any) => ns.metadata.name)
        .sort();
      this.availableNamespaces = namespaces;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NamespaceStore, import.meta.hot));
}
