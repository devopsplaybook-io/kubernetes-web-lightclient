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
    <div id="object-list">
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
        <KubernetesObjectList
          v-if="objectType"
          :objectType="objectType"
          :isNamespaced="isCurrentTypeNamespaced"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
const kubernetesObjectStore = KubernetesObjectStore();
</script>

<script>
import { debounce } from "lodash";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { ResourceService } from "~~/services/ResourceService";

export default {
  data() {
    const namespaceStore = NamespaceStore();
    return {
      objectType: "pod",
      searchFilter: "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      namespaceStore,
      selectedNamespace: "*",
      availableTypes: [],
      typesLoaded: false,
    };
  },
  computed: {
    enabledFeatures() {
      const selectedIds = kubernetesObjectStore.selectedTypes;
      return this.availableTypes.filter((t) => selectedIds.includes(t.id));
    },
    isCurrentTypeNamespaced() {
      const type = this.availableTypes.find((t) => t.id === this.objectType);
      return type ? type.namespaced : true;
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
      return;
    }

    // Load available types and user selections
    try {
      this.availableTypes = await ResourceService.getAvailableTypes();
      await kubernetesObjectStore.loadSelectedTypes();
      this.typesLoaded = true;
    } catch (e) {
      console.error("Failed to load resource types", e);
    }

    await this.namespaceStore.loadNamespaces();

    const route = useRoute();
    if (route.query.objectType) {
      this.objectType = route.query.objectType;
    }
    if (route.query.namespace) {
      this.selectedNamespace = route.query.namespace;
      KubernetesObjectStore().setFilterNamespace(route.query.namespace);
    } else {
      this.selectedNamespace = "*";
      KubernetesObjectStore().setFilterNamespace("");
    }
    if (route.query.search) {
      this.searchFilter = route.query.search;
      KubernetesObjectStore().setFilterKeyword(this.searchFilter);
    } else {
      this.searchFilter = "";
      KubernetesObjectStore().setFilterKeyword("");
    }

    KubernetesObjectStore().refreshLast();

    this.refreshIntervalValue = RefreshIntervalService.get();

    // Ensure first objectType is a selected one
    const selectedIds = kubernetesObjectStore.selectedTypes;
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
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  watch: {
    objectType(newType) {
      // Reset namespace if type is not namespaced
      const typeInfo = this.availableTypes.find((t) => t.id === newType);
      if (typeInfo && !typeInfo.namespaced) {
        this.selectedNamespace = "*";
      }

      const router = useRouter();
      const route = useRoute();
      const query = {
        ...route.query,
        objectType: newType,
        ...(this.searchFilter ? { search: this.searchFilter } : {}),
      };
      if (
        typeInfo &&
        typeInfo.namespaced &&
        this.selectedNamespace !== "*"
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
      return kubernetesObjectStore.selectedTypes.includes(featureId);
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
