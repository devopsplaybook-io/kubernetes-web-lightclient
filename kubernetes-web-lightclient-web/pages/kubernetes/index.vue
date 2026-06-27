<template>
  <div id="object-layout">
    <input
      id="object-search"
      type="search"
      v-model="searchFilter"
      placeholder="Search"
      aria-label="Search"
      v-on:input="onKeywordChanged"
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
        :disabled="!isCurrentTypeNamespaced"
      >
        <option value="*">All Namespaces</option>
        <option
          v-for="ns in namespaceStore.availableNamespaces"
          :key="ns"
          :value="ns"
        >
          {{ ns }}
        </option>
      </select>
      <span
        ><i
          class="bi bi-arrow-clockwise"
          :class="{ spin: kubernetesObjectStore.loading }"
          v-on:click="refreshObject()"
        ></i
      ></span>
    </div>
    <div
      id="object-list"
      :class="{
        'is-refreshing':
          kubernetesObjectStore.loading && kubernetesObjectStore.hasEverLoaded,
      }"
    >
      <div
        v-if="
          kubernetesObjectStore.loading && kubernetesObjectStore.hasEverLoaded
        "
        class="refresh-bar"
      ></div>
      <Loading
        v-if="
          kubernetesObjectStore.loading && !kubernetesObjectStore.hasEverLoaded
        "
      />
      <div
        v-show="
          kubernetesObjectStore.hasEverLoaded || !kubernetesObjectStore.loading
        "
      >
        <KubernetesPodList v-if="objectType === 'pod'" />
        <KubernetesDeploymentList v-else-if="objectType === 'deployment'" />
        <KubernetesStatefulSetList v-else-if="objectType === 'statefulset'" />
        <KubernetesDaemonSetList v-else-if="objectType === 'daemonset'" />
        <KubernetesJobList v-else-if="objectType === 'job'" />
        <KubernetesCronJobList v-else-if="objectType === 'cronjob'" />
        <KubernetesServiceList v-else-if="objectType === 'service'" />
        <KubernetesIngressList v-else-if="objectType === 'ingress'" />
        <KubernetesConfigMapList v-else-if="objectType === 'configmap'" />
        <KubernetesPVCList v-else-if="objectType === 'pvc'" />
        <KubernetesSecretList v-else-if="objectType === 'secret'" />
        <KubernetesServiceAccountList
          v-else-if="objectType === 'serviceaccount'"
        />
        <KubernetesRoleList v-else-if="objectType === 'role'" />
        <KubernetesRoleBindingList v-else-if="objectType === 'rolebinding'" />
        <KubernetesNamespaceList v-else-if="objectType === 'namespace'" />
        <KubernetesNodeList v-else-if="objectType === 'node'" />
        <KubernetesPVList v-else-if="objectType === 'pv'" />
        <KubernetesClusterRoleList v-else-if="objectType === 'clusterrole'" />
        <KubernetesClusterRoleBindingList
          v-else-if="objectType === 'clusterrolebinding'"
        />
        <KubernetesCustomResourceDefinitionList
          v-else-if="objectType === 'customresourcedefinition'"
        />
        <KubernetesObjectList
          v-else-if="objectType"
          :objectType="objectType"
          :isNamespaced="isCurrentTypeNamespaced"
          :isCrd="true"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { debounce } from "lodash";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { ResourceService } from "~~/services/ResourceService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import KubernetesPodList from "~~/components/KubernetesPodList.vue";
import KubernetesDeploymentList from "~~/components/KubernetesDeploymentList.vue";
import KubernetesStatefulSetList from "~~/components/KubernetesStatefulSetList.vue";
import KubernetesDaemonSetList from "~~/components/KubernetesDaemonSetList.vue";
import KubernetesJobList from "~~/components/KubernetesJobList.vue";
import KubernetesCronJobList from "~~/components/KubernetesCronJobList.vue";
import KubernetesServiceList from "~~/components/KubernetesServiceList.vue";
import KubernetesIngressList from "~~/components/KubernetesIngressList.vue";
import KubernetesConfigMapList from "~~/components/KubernetesConfigMapList.vue";
import KubernetesPVCList from "~~/components/KubernetesPVCList.vue";
import KubernetesSecretList from "~~/components/KubernetesSecretList.vue";
import KubernetesServiceAccountList from "~~/components/KubernetesServiceAccountList.vue";
import KubernetesRoleList from "~~/components/KubernetesRoleList.vue";
import KubernetesRoleBindingList from "~~/components/KubernetesRoleBindingList.vue";
import KubernetesNamespaceList from "~~/components/KubernetesNamespaceList.vue";
import KubernetesNodeList from "~~/components/KubernetesNodeList.vue";
import KubernetesPVList from "~~/components/KubernetesPVList.vue";
import KubernetesClusterRoleList from "~~/components/KubernetesClusterRoleList.vue";
import KubernetesClusterRoleBindingList from "~~/components/KubernetesClusterRoleBindingList.vue";
import KubernetesCustomResourceDefinitionList from "~~/components/KubernetesCustomResourceDefinitionList.vue";
import KubernetesObjectList from "~~/components/KubernetesObjectList.vue";

export default {
  data() {
    const route = useRoute();
    const namespaceStore = NamespaceStore();
    return {
      objectType: route.query.objectType || "pod",
      searchFilter: route.query.search || "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      namespaceStore,
      selectedNamespace: route.query.namespace || "*",
      availableTypes: [],
      typesLoaded: false,
      kubernetesObjectStore: KubernetesObjectStore(),
    };
  },
  computed: {
    enabledFeatures() {
      const selectedIds = KubernetesObjectStore().selectedTypes;
      return this.availableTypes.filter((t) => selectedIds.includes(t.id));
    },
    isCurrentTypeNamespaced() {
      const type = this.availableTypes.find((t) => t.id === this.objectType);
      return type ? type.namespaced : true;
    },
    isCurrentTypeCrd() {
      const type = this.availableTypes.find((t) => t.id === this.objectType);
      return type ? type.isCrd : false;
    },
  },
  async created() {
    // Apply URL query params SYNCHRONOUSLY before any async operation
    // so the component never renders with incorrect default state
    const route = useRoute();
    if (route.query.namespace) {
      this.selectedNamespace = route.query.namespace;
      KubernetesObjectStore().setFilterNamespace(route.query.namespace);
    } else {
      KubernetesObjectStore().setFilterNamespace("");
    }
    if (route.query.search) {
      this.searchFilter = route.query.search;
      KubernetesObjectStore().setFilterKeyword(this.searchFilter);
    } else {
      KubernetesObjectStore().setFilterKeyword("");
    }

    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
      return;
    }

    // Load available types and user selections
    try {
      this.availableTypes = await ResourceService.getAvailableTypes();
      await KubernetesObjectStore().loadSelectedTypes();
      this.typesLoaded = true;
    } catch (e) {
      console.error("Failed to load resource types", e);
    }

    await this.namespaceStore.loadNamespaces();

    KubernetesObjectStore().refreshLast();

    this.refreshIntervalValue = RefreshIntervalService.get();

    // Ensure first objectType is a selected one
    const selectedIds = KubernetesObjectStore().selectedTypes;
    if (selectedIds.length > 0 && !selectedIds.includes(this.objectType)) {
      this.objectType = selectedIds[0];
    }
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshObject();
      }, interval);
    }
    // Listen for mutation events from child components to trigger a forced refresh
    this._onObjectChanged = (eventType) => {
      KubernetesObjectStore().invalidateAndRefresh(eventType);
    };
    EventBus.on(EventTypes.OBJECT_CHANGED, this._onObjectChanged);
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
    if (this._onObjectChanged) {
      EventBus.off(EventTypes.OBJECT_CHANGED, this._onObjectChanged);
    }
  },
  watch: {
    objectType(newType) {
      // Reset namespace if type is not namespaced
      const typeInfo = this.availableTypes.find((t) => t.id === newType);
      if (typeInfo && !typeInfo.namespaced) {
        this.selectedNamespace = "*";
        this.kubernetesObjectStore.setFilterNamespace("");
      } else if (
        typeInfo &&
        typeInfo.namespaced &&
        this.selectedNamespace !== "*"
      ) {
        // Re-apply namespace filter for namespaced types
        this.kubernetesObjectStore.setFilterNamespace(this.selectedNamespace);
      }

      const router = useRouter();
      const route = useRoute();
      const query = {
        ...route.query,
        objectType: newType,
        ...(this.searchFilter ? { search: this.searchFilter } : {}),
      };
      if (typeInfo && typeInfo.namespaced && this.selectedNamespace !== "*") {
        query.namespace = this.selectedNamespace;
      } else {
        delete query.namespace;
      }
      router.replace({
        path: route.path,
        query,
      });

      // Force a fresh fetch when switching object type
      KubernetesObjectStore().invalidateAndRefresh(newType);
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
      if (this.isCurrentTypeNamespaced && this.selectedNamespace !== "*") {
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
    onKeywordChanged: debounce(async function (e) {
      KubernetesObjectStore().setFilterKeyword(this.searchFilter);
    }, 500),
    isTypeEnabled(featureId) {
      return KubernetesObjectStore().selectedTypes.includes(featureId);
    },
    onNamespaceChange() {
      KubernetesObjectStore().setFilterNamespace(
        this.selectedNamespace && this.selectedNamespace !== "*"
          ? this.selectedNamespace
          : "",
      );
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query };
      if (this.selectedNamespace === "*") {
        delete query.namespace;
      } else {
        query.namespace = this.selectedNamespace;
      }
      router.replace({
        path: route.path,
        query,
      });
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
  position: relative;
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

/* Refresh bar shown at top of list during background refresh */
.refresh-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 3px;
  background: linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #3b82f6 100%);
  background-size: 200% 100%;
  animation: refreshBarSlide 1.2s linear infinite;
  border-radius: 2px;
}

@keyframes refreshBarSlide {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* Slightly dim the list while refreshing to give visual feedback */
#object-list.is-refreshing > div:last-child {
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.spin {
  animation: spin 1s linear infinite;
}
</style>
