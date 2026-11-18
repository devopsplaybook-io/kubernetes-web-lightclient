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
      <select :value="objectType" @change="onObjectTypeChange">
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
    <ListPager :type-id="objectType" />
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
        <WorkloadPodView
          v-if="drilldown"
          ref="workloadView"
          :kind="drilldown.kind"
          :name="drilldown.name"
          :namespace="drilldown.namespace"
          :search="searchFilter"
          :deletable="isCurrentTypeDeletable"
          :open-merged-logs="$route.query.dialog === 'merged-logs'"
        />
        <template v-else>
          <KubernetesPodList
            v-if="objectType === 'pod'"
            :deletable="isCurrentTypeDeletable"
          />
          <KubernetesEventList v-else-if="objectType === 'events'" />
          <KubernetesDeploymentList
            v-else-if="objectType === 'deployment'"
            :deletable="isCurrentTypeDeletable"
          />
        <KubernetesStatefulSetList
          v-else-if="objectType === 'statefulset'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesDaemonSetList
          v-else-if="objectType === 'daemonset'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesJobList
          v-else-if="objectType === 'job'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesCronJobList
          v-else-if="objectType === 'cronjob'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesServiceList
          v-else-if="objectType === 'service'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesIngressList
          v-else-if="objectType === 'ingress'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesConfigMapList
          v-else-if="objectType === 'configmap'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesPVCList
          v-else-if="objectType === 'pvc'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesSecretList
          v-else-if="objectType === 'secret'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesServiceAccountList
          v-else-if="objectType === 'serviceaccount'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesRoleList
          v-else-if="objectType === 'role'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesRoleBindingList
          v-else-if="objectType === 'rolebinding'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesNamespaceList
          v-else-if="objectType === 'namespace'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesNodeList
          v-else-if="objectType === 'node'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesPVList
          v-else-if="objectType === 'pv'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesClusterRoleList
          v-else-if="objectType === 'clusterrole'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesClusterRoleBindingList
          v-else-if="objectType === 'clusterrolebinding'"
          :deletable="isCurrentTypeDeletable"
        />
        <KubernetesCustomResourceDefinitionList
          v-else-if="objectType === 'customresourcedefinition'"
          :deletable="isCurrentTypeDeletable"
        />
          <KubernetesObjectList
            v-else-if="objectType"
            :key="objectType"
            :objectType="objectType"
            :isNamespaced="isCurrentTypeNamespaced"
            :isCrd="true"
            :deletable="isCurrentTypeDeletable"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { debounce } from "lodash";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { ResourceService } from "~~/services/ResourceService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import { clearDialogRoute } from "~~/services/DialogDeepLink";
import { ListPaginationService } from "~~/services/ListPagination";
import ListPager from "~~/components/ListPager.vue";
import KubernetesPodList from "~~/components/KubernetesPodList.vue";
import KubernetesEventList from "~~/components/KubernetesEventList.vue";
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
import WorkloadPodView from "~~/components/WorkloadPodView.vue";
import { ParseWorkloadRoute } from "~~/services/WorkloadPods";

export default {
  data() {
    const route = useRoute();
    const namespaceStore = NamespaceStore();
    // Parse the workload drill-down synchronously so the first render never
    // flashes the plain pod list before the drill-down takes over.
    const drilldown = ParseWorkloadRoute(route.query);
    return {
      objectType: drilldown ? "pod" : route.query.objectType || "pod",
      searchFilter: route.query.search || "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      namespaceStore,
      selectedNamespace: route.query.namespace || "*",
      availableTypes: [],
      typesLoaded: false,
      kubernetesObjectStore: KubernetesObjectStore(),
      drilldown,
      drilldownKey: drilldown
        ? `${drilldown.kind}/${drilldown.namespace}/${drilldown.name}`
        : "",
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
    isCurrentTypeDeletable() {
      const type = this.availableTypes.find((t) => t.id === this.objectType);
      return type ? type.deletable === true : false;
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
      useRouter().push({
        path: "/settings",
        query: { return: route.fullPath },
      });
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

    // Ensure first objectType is a selected one, but never override a type
    // explicitly requested in the URL (e.g. a shared deep link to a type the
    // viewer has not enabled in their resource selection) or the pod type
    // implied by a workload drill-down link.
    if (!route.query.objectType && !this.drilldown) {
      const selectedIds = KubernetesObjectStore().selectedTypes;
      if (selectedIds.length > 0 && !selectedIds.includes(this.objectType)) {
        this.objectType = selectedIds[0];
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
    "$route.query": {
      deep: true,
      handler(query) {
        this.applyDrilldownFromRoute(query);
      },
    },
    objectType(newType) {
      // The drill-down owns objectType while it is active; the query watcher
      // restores the plain list state when the drill-down is left.
      if (this.drilldown) {
        return;
      }
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
      // Dialogs do not survive object type switches
      delete query.dialog;
      delete query.name;
      delete query.dialogNamespace;
      // Workload drill-downs do not survive object type switches either
      delete query.workload;
      delete query.workloadName;
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
  },
  methods: {
    applyDrilldownFromRoute(query) {
      const next = ParseWorkloadRoute(query || {});
      const nextKey = next
        ? `${next.kind}/${next.namespace}/${next.name}`
        : "";
      if (nextKey === this.drilldownKey) {
        // Same drill-down: nothing to reinitialize (only search/dialog
        // parameters may have changed).
        this.drilldown = next;
        return;
      }
      this.drilldownKey = nextKey;
      this.drilldown = next;
      if (next) {
        this.objectType = "pod";
        this.selectedNamespace = next.namespace;
        this.searchFilter = query.search || "";
        this.kubernetesObjectStore.setFilterNamespace(next.namespace);
        this.kubernetesObjectStore.setFilterKeyword(this.searchFilter);
        ListPaginationService.reset("pod");
        return;
      }
      // Left the drill-down: restore the plain list for the target type
      const type = query.objectType || "pod";
      const namespace =
        query.namespace && query.namespace !== "*" ? query.namespace : "*";
      this.objectType = type;
      this.selectedNamespace = namespace;
      this.searchFilter = query.search || "";
      this.kubernetesObjectStore.setFilterNamespace(
        namespace === "*" ? "" : namespace,
      );
      this.kubernetesObjectStore.setFilterKeyword(this.searchFilter);
      ListPaginationService.reset(type);
      KubernetesObjectStore().invalidateAndRefresh(type);
    },
    exitDrilldown() {
      if (!this.drilldown) {
        return;
      }
      this.drilldown = null;
      this.drilldownKey = "";
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query };
      delete query.workload;
      delete query.workloadName;
      router.replace({
        path: route.path,
        query,
      });
    },
    async onObjectTypeChange(event) {
      const newType = event.target.value;
      if (this.drilldown) {
        this.exitDrilldown();
      }
      try {
        // Wait for the dialog deep link to be removed before mounting the
        // list of the new type: otherwise it reads the stale route and
        // writes the previous dialog params back into the URL.
        await clearDialogRoute(useRouter(), useRoute());
      } finally {
        this.objectType = newType;
      }
      ListPaginationService.reset(newType);
    },
    refreshObject() {
      if (this.drilldown && this.$refs.workloadView) {
        this.$refs.workloadView.refresh();
        return;
      }
      KubernetesObjectStore().refreshLast();
    },
    onKeywordChanged: debounce(async function (e) {
      KubernetesObjectStore().setFilterKeyword(this.searchFilter);
      this.syncSearchToRoute();
      ListPaginationService.reset(this.objectType);
    }, 500),
    isTypeEnabled(featureId) {
      return KubernetesObjectStore().selectedTypes.includes(featureId);
    },
    // Keeps the URL shareable without writing to it on every keystroke: this
    // only runs from the debounced keyword handler (and never per input event).
    syncSearchToRoute() {
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query, objectType: this.objectType };
      if (this.searchFilter) {
        query.search = this.searchFilter;
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
    onNamespaceChange() {
      this.exitDrilldown();
      KubernetesObjectStore().setFilterNamespace(
        this.selectedNamespace && this.selectedNamespace !== "*"
          ? this.selectedNamespace
          : "",
      );
      ListPaginationService.reset(this.objectType);
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query };
      delete query.workload;
      delete query.workloadName;
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
  grid-template-rows: auto auto auto 1fr;
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

/* Sortable list headers */
#object-list th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
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

/* Refresh bar shown at top of list during background refresh.
 * Keep the z-index low: it only needs to sit above the list rows, never
 * above navigation elements or dialogs (dialogs are teleported to <body>). */
.refresh-bar {
  position: sticky;
  top: 0;
  z-index: 2;
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
