<template>
  <div id="object-layout">
    <input
      id="object-search"
      type="search"
      v-model="searchFilter"
      placeholder="Search"
      aria-label="Search"
      v-on:input="filterChanged"
    />
    <div id="object-actions" class="actions">
      <select v-model="objectType">
        <option
          v-for="feature in enabledFeatures"
          :key="feature.id"
          :value="feature.id"
        >
          {{ feature.name }}
        </option>
      </select>
      <select
        v-model="selectedNamespace"
        @change="onNamespaceChange"
        :disabled="!isCurrentFeatureNamespaced"
      >
        <option value="all">All Namespaces</option>
        <option
          v-for="ns in namespaceStore.availableNamespaces"
          :key="ns"
          :value="ns"
        >
          {{ ns }}
        </option>
      </select>
      <span
        ><i class="bi bi-arrow-clockwise" v-on:click="refreshObject()"></i
      ></span>
    </div>
    <div id="object-list">
      <KubernetesNodeList
        v-if="objectType == 'node' && isFeatureEnabled('node')"
      />
      <KubernetesNamespaceList
        v-if="objectType == 'namespace' && isFeatureEnabled('namespace')"
      />
      <KubernetesDeploymentList
        v-if="objectType == 'deployment' && isFeatureEnabled('deployment')"
      />
      <KubernetesPodList
        v-else-if="objectType == 'pod' && isFeatureEnabled('pod')"
      />
      <KubernetesStatefulSetList
        v-else-if="
          objectType == 'statefulset' && isFeatureEnabled('statefulset')
        "
      />
      <KubernetesDaemonSetList
        v-else-if="objectType == 'daemonset' && isFeatureEnabled('daemonset')"
      />
      <KubernetesJobList
        v-else-if="objectType == 'job' && isFeatureEnabled('job')"
      />
      <KubernetesCronJobList
        v-else-if="objectType == 'cronjob' && isFeatureEnabled('cronjob')"
      />
      <KubernetesServiceList
        v-else-if="objectType == 'service' && isFeatureEnabled('service')"
      />
      <KubernetesPVCList
        v-else-if="objectType == 'pvc' && isFeatureEnabled('pvc')"
      />
      <KubernetesPVList
        v-else-if="objectType == 'pv' && isFeatureEnabled('pv')"
      />
      <KubernetesConfigMapList
        v-else-if="objectType == 'configmap' && isFeatureEnabled('configmap')"
      />
      <KubernetesSecretList
        v-else-if="objectType == 'secret' && isFeatureEnabled('secret')"
      />
      <KubernetesServiceAccountList
        v-else-if="
          objectType == 'serviceaccount' && isFeatureEnabled('serviceaccount')
        "
      />
      <KubernetesRoleList
        v-else-if="objectType == 'role' && isFeatureEnabled('role')"
      />
      <KubernetesClusterRoleList
        v-else-if="
          objectType == 'clusterrole' && isFeatureEnabled('clusterrole')
        "
      />
      <KubernetesRoleBindingList
        v-else-if="
          objectType == 'rolebinding' && isFeatureEnabled('rolebinding')
        "
      />
      <KubernetesClusterRoleBindingList
        v-else-if="
          objectType == 'clusterrolebinding' &&
          isFeatureEnabled('clusterrolebinding')
        "
      />
      <KubernetesIngressList
        v-else-if="objectType == 'ingress' && isFeatureEnabled('ingress')"
      />
      <KubernetesCustomResourceDefinitionList
        v-else-if="
          objectType == 'customresourcedefinition' &&
          isFeatureEnabled('customresourcedefinition')
        "
      />
    </div>
  </div>
</template>

<script>
import { debounce } from "lodash";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { FeatureService, FEATURES } from "~~/services/FeatureService";

export default {
  data() {
    const namespaceStore = NamespaceStore();
    return {
      objectType: "pod",
      searchFilter: "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      namespaceStore,
      selectedNamespace: namespaceStore.selectedNamespace,
    };
  },
  computed: {
    enabledFeatures() {
      const enabledIds = FeatureService.getEnabledFeatures();
      return FEATURES.filter((f) => enabledIds.includes(f.id));
    },
    isCurrentFeatureNamespaced() {
      return FeatureService.isFeatureNamespaced(this.objectType);
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }

    // Load namespaces first
    this.selectedNamespace = this.namespaceStore.selectedNamespace;
    await this.namespaceStore.loadNamespaces();

    const route = useRoute();
    if (route.query.objectType) {
      this.objectType = route.query.objectType;
    }
    if (route.query.namespace) {
      this.selectedNamespace = route.query.namespace;
      this.namespaceStore.setSelectedNamespace(route.query.namespace);
    }
    if (route.query.search) {
      this.searchFilter = route.query.search;
      KubernetesObjectStore().setFilter(this.searchFilter);
    }
    this.refreshIntervalValue = RefreshIntervalService.get();

    // Ensure the selected objectType is enabled
    const enabledIds = FeatureService.getEnabledFeatures();
    if (!enabledIds.includes(this.objectType)) {
      // If current objectType is disabled, select the first enabled feature
      if (enabledIds.length > 0) {
        this.objectType = enabledIds[0];
      }
    }
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshObject();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  watch: {
    objectType(newType) {
      // Reset namespace to "all" for non-namespaced resources
      if (!FeatureService.isFeatureNamespaced(newType)) {
        this.selectedNamespace = "all";
        this.namespaceStore.setSelectedNamespace("all");
      }

      const router = useRouter();
      const route = useRoute();
      const query = {
        ...route.query,
        objectType: newType,
        ...(this.searchFilter ? { search: this.searchFilter } : {}),
      };
      // Add namespace to query if current feature is namespaced
      if (
        FeatureService.isFeatureNamespaced(newType) &&
        this.selectedNamespace !== "all"
      ) {
        query.namespace = this.selectedNamespace;
      } else {
        delete query.namespace;
      }
      router.replace({
        path: route.path,
        query,
      });
    },
    searchFilter(newFilter) {
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query, objectType: this.objectType };
      if (newFilter) {
        query.search = newFilter;
      } else {
        delete query.search;
      }
      if (this.isCurrentFeatureNamespaced && this.selectedNamespace !== "all") {
        query.namespace = this.selectedNamespace;
      }
      router.replace({
        path: route.path,
        query,
      });
    },
  },
  methods: {
    refreshObject() {
      KubernetesObjectStore().refreshLast();
    },
    filterChanged: debounce(async function (e) {
      KubernetesObjectStore().setFilter(this.searchFilter);
    }, 500),
    isFeatureEnabled(featureId) {
      return FeatureService.isFeatureEnabled(featureId);
    },
    onNamespaceChange() {
      this.namespaceStore.setSelectedNamespace(this.selectedNamespace);

      // Update URL query
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query };
      if (this.selectedNamespace === "all") {
        delete query.namespace;
      } else {
        query.namespace = this.selectedNamespace;
      }
      router.replace({
        path: route.path,
        query,
      });

      // Refresh the current view
      this.refreshObject();
    },
  },
};
</script>

<style>
select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
#object-layout {
  display: grid;
  max-height: 100%;
  height: auto;
  grid-template-rows: auto auto 1fr;
}
#object-actions {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.5em;
}
#object-actions span {
  padding-top: 0.3rem;
}
#object-search {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  padding-left: 3em;
  height: 2.6rem;
}

#object-list {
  overflow-x: auto;
  overflow-y: auto;
  height: 100%;
  width: 100%;
}
#object-list td {
  white-space: nowrap;
}

#object-list td,
#object-list pre,
#object-list div,
#object-list span,
#object-list p {
  font-size: 0.9em;
}
</style>
