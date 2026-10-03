export const NamespaceStore = defineStore("NamespaceStore", {
  state: () => ({
    availableNamespaces: [] as string[],
  }),

  getters: {},

  actions: {
    async loadNamespaces() {
      // "namespace" (singular) is the server-side resource type id
      await KubernetesObjectStore().getObjectFull("namespace", {
        object: "namespace",
        command: "get",
        argument: "",
      });
      const namespaces = JSON.parse(
        JSON.stringify(KubernetesObjectStore().dataFull["namespace"]),
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
