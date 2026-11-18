<template>
  <div id="overview-page">
    <div class="overview-heading">
      <div>
        <h3>Cluster overview</h3>
        <p class="overview-subtitle">Is anything wrong right now?</p>
      </div>
      <nav class="overview-nav" aria-label="Shortcuts">
        <NuxtLink to="/kubernetes">
          <i class="bi bi-list-ul" aria-hidden="true"></i>
          Browse all resources
        </NuxtLink>
        <NuxtLink to="/kubernetes/stats">
          <i class="bi bi-speedometer" aria-hidden="true"></i>
          Stats
        </NuxtLink>
      </nav>
    </div>

    <div id="overview-grid">
      <OverviewTile
        title="Node readiness"
        icon="bi-hdd-rack"
        :to="nodeProblemsPath"
        :loading="nodesLoading"
        :error="loadErrors.node || ''"
        :no-access-scope="k8sNoAccessScope"
        :show-settings-link="currentUserStore.isAdmin"
        v-on:retry="retryNodes()"
      >
        <p class="tile-kpi">
          <strong>{{ nodeHealth.ready }}/{{ nodeHealth.total }}</strong> ready
        </p>
        <p v-if="nodeHealth.total === 0" class="tile-muted">
          No nodes reported.
        </p>
        <p v-else-if="nodeHealth.notReady.length === 0" class="tile-ok">
          <i class="bi bi-check-circle" aria-hidden="true"></i> All nodes ready
        </p>
        <ul v-else class="tile-list">
          <li v-for="node in visibleNotReadyNodes" :key="nodeKey(node)">
            <NuxtLink :to="nodeDetailsPath(node)">{{
              node.metadata.name
            }}</NuxtLink>
          </li>
          <li v-if="nodeHealth.notReady.length > MAX_ROWS" class="tile-muted">
            +{{ nodeHealth.notReady.length - MAX_ROWS }} more
          </li>
        </ul>
      </OverviewTile>

      <OverviewTile
        title="Pods not running"
        icon="bi-box-seam"
        :to="podsNotRunningPath"
        :loading="podsLoading"
        :error="loadErrors.pod || ''"
        :no-access-scope="k8sNoAccessScope"
        :show-settings-link="currentUserStore.isAdmin"
        v-on:retry="retryPods()"
      >
        <p class="tile-kpi">
          <strong>{{ podHealth.notRunning }}</strong> of {{ podHealth.total }}
          pods not running
        </p>
        <p v-if="podHealth.total === 0" class="tile-muted">
          No pods reported.
        </p>
        <p v-else-if="podHealth.notRunning === 0" class="tile-ok">
          <i class="bi bi-check-circle" aria-hidden="true"></i> All pods running
        </p>
        <ul v-else class="tile-list">
          <li v-for="state in podStateRows" :key="state.id">
            <NuxtLink :to="state.path" class="tile-row-link">
              <span class="tile-row-label">{{ state.label }}</span>
              <span class="tile-row-count">{{ state.count }}</span>
            </NuxtLink>
            <span class="tile-row-sub">{{ podNamesSummary(state.names) }}</span>
          </li>
        </ul>
      </OverviewTile>

      <OverviewTile
        title="Recent warnings"
        icon="bi-exclamation-triangle"
        :to="warningsPath"
        :loading="eventsLoading"
        :error="loadErrors.events || ''"
        :no-access-scope="k8sNoAccessScope"
        :show-settings-link="currentUserStore.isAdmin"
        v-on:retry="retryEvents()"
      >
        <p v-if="recentWarnings.length === 0" class="tile-ok">
          <i class="bi bi-check-circle" aria-hidden="true"></i> No recent
          warnings
        </p>
        <ul v-else class="tile-list">
          <li v-for="warning in recentWarnings" :key="warningKey(warning)">
            <NuxtLink
              v-if="warningPath(warning)"
              :to="warningPath(warning)"
              class="tile-row-link"
            >
              <span class="tile-row-label">{{ warning.reason }}</span>
            </NuxtLink>
            <span v-else class="tile-row-label">{{ warning.reason }}</span>
            <span class="tile-row-sub">
              {{ warning.kind }} {{ warning.name
              }}<template v-if="warning.namespace">
                ({{ warning.namespace }})</template
              >
              &middot; {{ warning.count }}&times; &middot;
              {{ relativeTime(warning.time) }}
            </span>
            <span class="tile-row-message">{{ warning.message }}</span>
          </li>
        </ul>
      </OverviewTile>

      <OverviewTile
        title="Most restarts"
        icon="bi-arrow-repeat"
        :to="podsRestartsPath"
        :loading="podsLoading || deploymentsLoading"
        :error="restartsError"
        :no-access-scope="k8sNoAccessScope"
        :show-settings-link="currentUserStore.isAdmin"
        v-on:retry="retryRestarts()"
      >
        <p v-if="restartRows.length === 0" class="tile-ok">
          <i class="bi bi-check-circle" aria-hidden="true"></i> No restarts
          recorded
        </p>
        <ul v-else class="tile-list">
          <li
            v-for="workload in restartRows"
            :key="`${workload.kind}/${workload.namespace}/${workload.name}`"
          >
            <NuxtLink
              v-if="workload.path"
              :to="workload.path"
              class="tile-row-link"
            >
              <span class="tile-row-label">{{ workload.name }}</span>
              <span class="tile-row-count">{{ workload.restarts }}</span>
            </NuxtLink>
            <span v-else class="tile-row-label">
              {{ workload.name }}
              <span class="tile-row-count">{{ workload.restarts }}</span>
            </span>
            <span class="tile-row-sub">
              {{ workload.kind }} &middot; {{ workload.namespace
              }}<template v-if="workload.lastRestartAt">
                &middot; last {{ relativeTime(workload.lastRestartAt) }}</template
              >
            </span>
          </li>
        </ul>
      </OverviewTile>

      <OverviewTile
        title="Capacity"
        icon="bi-speedometer2"
        to="/kubernetes/stats"
        :loading="nodesLoading || podsLoading"
        :error="capacityError"
        :no-access-scope="k8sNoAccessScope"
        :show-settings-link="currentUserStore.isAdmin"
        v-on:retry="retryCapacity()"
      >
        <div class="capacity-rows">
          <div class="capacity-row">
            <span class="capacity-label">CPU</span>
            <span class="capacity-detail">
              allocatable {{ formatCpu(capacity.cpuAllocatableMillicores) }}
            </span>
            <span class="capacity-detail">
              requests {{ formatCpu(capacity.cpuRequestsMillicores) }} ({{
                formatRatio(capacity.cpuRequestRatio)
              }})
            </span>
            <span class="capacity-detail">
              limits {{ formatCpu(capacity.cpuLimitsMillicores) }} ({{
                formatRatio(capacity.cpuLimitRatio)
              }})
            </span>
            <span class="capacity-usage">
              <template v-if="statsDenied"
                >No access &mdash; {{ statsDenialMessage }}</template
              >
              <template v-else-if="metricsLoading">Loading metrics&hellip;</template>
              <template v-else-if="metricsUnavailable"
                >Metrics unavailable (metrics-server not installed)</template
              >
              <template v-else
                >usage {{ formatCpu(capacity.cpuUsageMillicores) }} ({{
                  formatRatio(capacity.cpuUsageRatio)
                }})</template
              >
            </span>
          </div>
          <div class="capacity-row">
            <span class="capacity-label">Memory</span>
            <span class="capacity-detail">
              allocatable {{ formatMemory(capacity.memoryAllocatableKiB) }}
            </span>
            <span class="capacity-detail">
              requests {{ formatMemory(capacity.memoryRequestsKiB) }} ({{
                formatRatio(capacity.memoryRequestRatio)
              }})
            </span>
            <span class="capacity-detail">
              limits {{ formatMemory(capacity.memoryLimitsKiB) }} ({{
                formatRatio(capacity.memoryLimitRatio)
              }})
            </span>
            <span class="capacity-usage">
              <template v-if="statsDenied"
                >No access &mdash; {{ statsDenialMessage }}</template
              >
              <template v-else-if="metricsLoading">Loading metrics&hellip;</template>
              <template v-else-if="metricsUnavailable"
                >Metrics unavailable (metrics-server not installed)</template
              >
              <template v-else
                >usage {{ formatMemory(capacity.memoryUsageKiB) }} ({{
                  formatRatio(capacity.memoryUsageRatio)
                }})</template
              >
            </span>
          </div>
        </div>
        <template #footer>
          <button
            v-if="!statsDenied && metricsUnavailable"
            type="button"
            class="outline tile-retry-metrics"
            v-on:click="refreshPodUsage()"
          >
            Retry metrics
          </button>
          <span v-else class="tile-muted"
            >Full breakdown on the Stats page.</span
          >
        </template>
      </OverviewTile>
    </div>
  </div>
</template>

<script>
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { StatsApi } from "~~/services/StatsApi";
import { UtilsRelativeTime } from "~~/services/Utils";
import {
  BuiltInKindToTypeId,
  DetailsPath,
  FilteredListPath,
} from "~~/services/ObjectLinks";
import { denialForScope, permissionDenialForError } from "~~/services/PermissionErrors";
import {
  FormatKiB,
  FormatMillicores,
  FormatRatio,
  GetCapacitySummary,
  GetNodeHealth,
  GetPodHealth,
  GetRecentWarnings,
  GetTopRestartingWorkloads,
  NODE_PROBLEMS_QUERY,
  POD_PROBLEM_STATE_LABELS,
  POD_PROBLEM_STATES,
  PODS_NOT_RUNNING_QUERY,
  PodStateListPath,
  WARNINGS_QUERY,
  WorkloadDrilldownPath,
} from "~~/services/Overview";
import { CurrentUserStore } from "~~/stores/CurrentUserStore";
import OverviewTile from "~~/components/OverviewTile.vue";

const MAX_ROWS = 5;
const MAX_POD_NAMES = 3;

export default {
  components: { OverviewTile },
  data() {
    return {
      k8sRead: true,
      statsRead: true,
      podUsageDenied: false,
      podUsageError: false,
      metricsReady: false,
      podUsageStats: [],
      podUsageEtag: null,
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      // Per-source readiness so one slow source never blocks another tile
      sourceReady: {
        node: false,
        pod: false,
        events: false,
        deployment: false,
      },
      kubernetesObjectStore: KubernetesObjectStore(),
      currentUserStore: CurrentUserStore(),
      MAX_ROWS,
    };
  },
  computed: {
    nodeProblemsPath() {
      return NODE_PROBLEMS_QUERY;
    },
    podsNotRunningPath() {
      return PODS_NOT_RUNNING_QUERY;
    },
    warningsPath() {
      return WARNINGS_QUERY;
    },
    podsRestartsPath() {
      return FilteredListPath("pod", "", "", ["restarts"]);
    },
    loadErrors() {
      return this.kubernetesObjectStore.loadErrors || {};
    },
    loadingTypes() {
      return this.kubernetesObjectStore.loadingTypes || {};
    },
    k8sNoAccessScope() {
      if (this.k8sRead && !this.kubernetesObjectStore.permissionError) {
        return "";
      }
      return this.kubernetesObjectStore.permissionError || "k8s:read";
    },
    k8sAllowed() {
      return this.k8sNoAccessScope === "";
    },
    nodesLoading() {
      return (
        this.k8sAllowed && !this.sourceReady.node && !this.loadErrors.node
      );
    },
    podsLoading() {
      return this.k8sAllowed && !this.sourceReady.pod && !this.loadErrors.pod;
    },
    eventsLoading() {
      return (
        this.k8sAllowed && !this.sourceReady.events && !this.loadErrors.events
      );
    },
    deploymentsLoading() {
      return (
        this.k8sAllowed &&
        !this.sourceReady.deployment &&
        !this.loadErrors.deployment
      );
    },
    restartsError() {
      return this.loadErrors.pod || this.loadErrors.deployment || "";
    },
    capacityError() {
      return this.loadErrors.node || this.loadErrors.pod || "";
    },
    statsDenied() {
      return !this.statsRead || this.podUsageDenied;
    },
    statsDenialMessage() {
      return (
        denialForScope("stats:read")?.message ||
        "You need the stats:read scope to view cluster metrics."
      );
    },
    metricsLoading() {
      return !this.statsDenied && !this.metricsReady;
    },
    metricsUnavailable() {
      if (this.statsDenied || !this.metricsReady) {
        return false;
      }
      return this.podUsageError || !this.capacity.usageAvailable;
    },
    nodeHealth() {
      return GetNodeHealth(this.kubernetesObjectStore.dataFull?.node || []);
    },
    podHealth() {
      return GetPodHealth(this.kubernetesObjectStore.dataFull?.pod || []);
    },
    capacity() {
      return GetCapacitySummary(
        this.kubernetesObjectStore.dataFull?.node || [],
        this.kubernetesObjectStore.dataFull?.pod || [],
        this.podUsageStats,
      );
    },
    recentWarnings() {
      return GetRecentWarnings(
        this.kubernetesObjectStore.dataFull?.events || [],
      );
    },
    visibleNotReadyNodes() {
      return this.nodeHealth.notReady.slice(0, MAX_ROWS);
    },
    podStateRows() {
      const health = this.podHealth;
      return POD_PROBLEM_STATES.filter(
        (state) => health.states[state].length > 0,
      ).map((state) => ({
        id: state,
        label: POD_PROBLEM_STATE_LABELS[state] || state,
        count: health.states[state].length,
        names: health.states[state].map((pod) => pod.metadata?.name || ""),
        path: PodStateListPath(state),
      }));
    },
    restartRows() {
      return GetTopRestartingWorkloads(
        this.kubernetesObjectStore.dataFull?.pod || [],
        this.kubernetesObjectStore.dataFull?.deployment || [],
      ).map((workload) => ({
        ...workload,
        path:
          WorkloadDrilldownPath(
            workload.kind,
            workload.name,
            workload.namespace,
          ) || "",
      }));
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({
        path: "/settings",
        query: { tab: "profile", return: useRoute().fullPath },
      });
      return;
    }
    await this.currentUserStore.ensureLoaded();
    // A failed scope load (not a 401) must not deny everything: fetch anyway
    // and let per-tile 403 mapping show the no-access notes.
    const scopesKnown = !this.currentUserStore.error;
    this.k8sRead = scopesKnown
      ? this.currentUserStore.hasScope("k8s:read")
      : true;
    this.statsRead = scopesKnown
      ? this.currentUserStore.hasScope("stats:read")
      : true;
    this.refreshIntervalValue = RefreshIntervalService.get();
    this.refreshKubernetesData();
    this.refreshPodUsage();
    this.startPolling();
  },
  beforeUnmount() {
    this.stopPolling();
  },
  methods: {
    async runSource(type, loader) {
      try {
        await loader();
      } catch {
        // The store records per-type load errors; a tile shows them.
      } finally {
        this.sourceReady[type] = true;
      }
    },
    refreshKubernetesData() {
      if (!this.k8sAllowed) {
        return;
      }
      const store = this.kubernetesObjectStore;
      this.runSource("node", () => store.getNodes());
      this.runSource("pod", () => store.getPods());
      this.runSource("events", () => store.getEvents());
      this.runSource("deployment", () => store.getDeployments());
    },
    async refreshPodUsage() {
      if (this.statsDenied) {
        this.metricsReady = true;
        return;
      }
      try {
        const result = await StatsApi.getPodUsage(this.podUsageEtag);
        this.podUsageEtag = result.etag || this.podUsageEtag;
        if (result.notModified) {
          return;
        }
        this.podUsageStats = result.data?.podUsageStats || [];
        this.podUsageError = false;
      } catch (error) {
        const denial = permissionDenialForError(error);
        if (denial && denial.scope === "stats:read") {
          this.podUsageDenied = true;
          this.podUsageStats = [];
        } else {
          // metrics-server absent or a transient failure: a neutral state,
          // never a page-level error alert
          this.podUsageError = true;
        }
      } finally {
        this.metricsReady = true;
      }
    },
    startPolling() {
      this.stopPolling();
      const interval = parseInt(this.refreshIntervalValue, 10);
      if (!(interval > 0)) {
        return;
      }
      this.refreshIntervalId = setInterval(() => {
        this.refreshKubernetesData();
        this.refreshPodUsage();
      }, interval);
    },
    stopPolling() {
      if (this.refreshIntervalId) {
        clearInterval(this.refreshIntervalId);
        this.refreshIntervalId = null;
      }
    },
    retryNodes() {
      this.sourceReady.node = false;
      this.kubernetesObjectStore.getNodes();
    },
    retryPods() {
      this.sourceReady.pod = false;
      this.kubernetesObjectStore.getPods();
    },
    retryEvents() {
      this.sourceReady.events = false;
      this.kubernetesObjectStore.getEvents();
    },
    retryRestarts() {
      this.sourceReady.pod = false;
      this.sourceReady.deployment = false;
      this.kubernetesObjectStore.getPods();
      this.kubernetesObjectStore.getDeployments();
    },
    retryCapacity() {
      this.sourceReady.node = false;
      this.sourceReady.pod = false;
      this.kubernetesObjectStore.getNodes();
      this.kubernetesObjectStore.getPods();
      this.refreshPodUsage();
    },
    nodeKey(node) {
      return node.metadata?.uid || node.metadata?.name || "";
    },
    nodeDetailsPath(node) {
      return DetailsPath("node", "", node.metadata?.name || "");
    },
    warningKey(warning) {
      return `${warning.kind}/${warning.namespace}/${warning.name}/${warning.reason}`;
    },
    warningPath(warning) {
      const typeId = BuiltInKindToTypeId[warning.kind];
      if (!typeId) {
        return WARNINGS_QUERY;
      }
      return DetailsPath(typeId, warning.namespace, warning.name);
    },
    podNamesSummary(names) {
      const shown = names.slice(0, MAX_POD_NAMES).join(", ");
      return names.length > MAX_POD_NAMES ? `${shown}, +${names.length - MAX_POD_NAMES}` : shown;
    },
    relativeTime(timestamp) {
      return timestamp ? UtilsRelativeTime(timestamp) : "-";
    },
    formatCpu(millicores) {
      return FormatMillicores(millicores);
    },
    formatMemory(kib) {
      return FormatKiB(kib);
    },
    formatRatio(ratio) {
      return FormatRatio(ratio);
    },
  },
};
</script>

<style scoped>
#overview-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg, 1.5rem);
}

.overview-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm, 0.5rem);
}

.overview-heading h3 {
  margin: 0;
}

.overview-subtitle {
  margin: 0.2rem 0 0 0;
  opacity: 0.7;
  font-size: 0.9em;
}

.overview-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-base, 1rem);
  font-size: 0.9em;
}

.overview-nav a {
  color: inherit;
}

.overview-nav i {
  margin-right: 0.25rem;
}

#overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: var(--space-base, 1rem);
  align-items: stretch;
}

.tile-kpi {
  margin: 0 0 0.5rem 0;
}

.tile-kpi strong {
  font-size: 1.4em;
}

.tile-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tile-list li {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--pico-muted-border-color, #eee);
  font-size: 0.9em;
}

.tile-list li:last-child {
  border-bottom: none;
}

.tile-row-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: inherit;
  text-decoration: none;
}

.tile-row-link:hover .tile-row-label {
  text-decoration: underline;
}

.tile-row-label {
  font-weight: 600;
}

.tile-row-count {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.tile-row-sub,
.tile-muted {
  opacity: 0.7;
  font-size: 0.85em;
}

.tile-row-message {
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tile-ok {
  margin: 0;
  color: var(--pico-ins-color, #1a7f37);
}

.capacity-rows {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.capacity-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.15rem 0.75rem;
  font-size: 0.88em;
}

.capacity-label {
  grid-row: span 3;
  font-weight: 700;
  align-self: start;
}

.capacity-detail,
.capacity-usage {
  opacity: 0.85;
}

.capacity-usage {
  margin-top: 0.25rem;
}

.tile-retry-metrics {
  width: auto;
  margin: 0;
  padding: 0.2rem 0.7rem;
  font-size: 0.85em;
}
</style>
