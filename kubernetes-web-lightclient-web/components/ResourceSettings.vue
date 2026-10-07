<template>
  <section class="settings-section">
    <h2>Resources</h2>
    <p>Select which Kubernetes resource types to display in the explorer.</p>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else>
      <h3>Built-in Resources</h3>
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

      <h3 v-if="crdResources.length > 0">Custom Resources (CRDs)</h3>
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
  </section>
</template>

<script>
import { ResourceService } from "~~/services/ResourceService";
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
        const selectedIds = Array.from(this.selectedIds);
        await ResourceService.saveUserSelections(selectedIds);
        // Update store directly so changes reflect immediately
        KubernetesObjectStore().selectedTypes = selectedIds;
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
h3 {
  margin-top: var(--space-lg, 1.5rem);
}
.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-sm, 0.5rem);
  margin-top: var(--space-sm, 0.5rem);
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
  overflow-wrap: break-word;
  word-break: break-word;
}
.resource-item input[type="checkbox"] {
  margin-right: var(--space-sm, 0.5rem);
  cursor: pointer;
}
.actions-bar {
  margin-top: var(--space-lg, 1.5rem);
  display: flex;
  gap: var(--space-sm, 0.5rem);
}
.last-refresh {
  margin-top: var(--space-base, 1rem);
  font-size: var(--text-sm, 0.875rem);
  opacity: 0.6;
}
</style>
