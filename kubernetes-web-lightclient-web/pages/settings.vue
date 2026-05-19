<template>
  <div>
    <h1>Resource Settings</h1>
    <p>Select which Kubernetes resource types to display in the explorer.</p>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else>
      <h2>Built-in Resources</h2>
      <div class="resources-grid">
        <div
          v-for="resource in builtInResources"
          :key="resource.id"
          class="resource-item"
        >
          <label>
            <input
              type="checkbox"
              :checked="selectedIds.has(resource.id)"
              @change="toggleResource(resource.id)"
            />
            {{ resource.name }}
          </label>
        </div>
      </div>

      <h2 v-if="crdResources.length > 0">Custom Resources (CRDs)</h2>
      <div v-if="crdResources.length > 0" class="resources-grid">
        <div
          v-for="resource in crdResources"
          :key="resource.id"
          class="resource-item"
        >
          <label>
            <input
              type="checkbox"
              :checked="selectedIds.has(resource.id)"
              @change="toggleResource(resource.id)"
            />
            {{ resource.name }}
          </label>
        </div>
      </div>

      <div class="actions-bar">
        <button @click="saveSelections" :disabled="saving">
          {{ saving ? "Saving..." : "Save Selections" }}
        </button>
        <button @click="refreshCrds" :disabled="refreshing" class="secondary">
          {{ refreshing ? "Scanning..." : "Refresh CRDs from Cluster" }}
        </button>
      </div>

      <div v-if="lastRefresh" class="last-refresh">
        Last CRD scan: {{ lastRefresh }}
      </div>
    </div>
  </div>
</template>

<script setup>
const kubernetesObjectStore = KubernetesObjectStore();
</script>

<script>
import {
  ResourceService,
} from "~~/services/ResourceService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      allResources: [],
      selectedIds: new Set(),
      loading: true,
      saving: false,
      refreshing: false,
      lastRefresh: "",
    };
  },
  computed: {
    builtInResources() {
      return this.allResources.filter((r) => !r.isCrd);
    },
    crdResources() {
      return this.allResources.filter((r) => r.isCrd);
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
      return;
    }
    await this.loadData();
  },
  methods: {
    async loadData() {
      this.loading = true;
      try {
        const [types, selections] = await Promise.all([
          ResourceService.getAvailableTypes(),
          ResourceService.getUserSelections(),
        ]);
        this.allResources = types;
        this.selectedIds = new Set(selections);
      } catch (error) {
        handleError(error);
      }
      this.loading = false;
    },
    toggleResource(id) {
      const newSet = new Set(this.selectedIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      this.selectedIds = newSet;
    },
    async saveSelections() {
      this.saving = true;
      try {
        await ResourceService.saveUserSelections(Array.from(this.selectedIds));
        await kubernetesObjectStore.loadSelectedTypes();
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Resource selections saved",
        });
      } catch (error) {
        handleError(error);
      }
      this.saving = false;
    },
    async refreshCrds() {
      this.refreshing = true;
      try {
        const types = await ResourceService.refreshTypes();
        this.allResources = types;
        this.lastRefresh = new Date().toLocaleString();
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "CRD scan completed",
        });
      } catch (error) {
        handleError(error);
      }
      this.refreshing = false;
    },
  },
};
</script>

<style scoped>
h1 {
  margin-top: 0;
}
h2 {
  margin-top: 1.5em;
}
.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.5em;
  margin-top: 0.5em;
}
.resource-item {
  display: flex;
  align-items: center;
}
.resource-item label {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}
.resource-item input[type="checkbox"] {
  margin-right: 0.5em;
  cursor: pointer;
}
.actions-bar {
  margin-top: 1.5em;
  display: flex;
  gap: 0.5em;
}
.actions-bar button {
  margin-right: 0.5em;
}
.last-refresh {
  margin-top: 1em;
  font-size: 0.85em;
  opacity: 0.6;
}
</style>
