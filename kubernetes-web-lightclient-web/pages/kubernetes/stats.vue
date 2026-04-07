<template>
  <div id="stats-page">
    <div class="section">
      <h2 class="section-title">Metrics</h2>
      <div id="stats-layout">
        <apexchart
          width="100%"
          type="line"
          :options="cpuChartOptions"
          :series="cpuChartSeries"
        />
        <apexchart
          width="100%"
          type="line"
          :options="memoryChartOptions"
          :series="memoryChartSeries"
        />
        <apexchart
          width="100%"
          type="line"
          :options="podsChartOptions"
          :series="podsChartSeries"
        />
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Pod Requests</h2>
      <div v-if="podResources.length === 0" class="no-data">
        No pod resource data available
      </div>
      <div v-else>
        <table class="striped">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Pod</th>
              <th>Node</th>
              <th>CPU Request</th>
              <th>CPU Limit</th>
              <th>CPU Usage</th>
              <th>Mem Request</th>
              <th>Mem Limit</th>
              <th>Mem Usage</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="pod in sortedPodResources"
              :key="`${pod.namespace}-${pod.name}`"
            >
              <td>{{ pod.namespace }}</td>
              <td>{{ pod.name }}</td>
              <td>{{ pod.node }}</td>
              <td>{{ pod.cpuRequest || "-" }}</td>
              <td>{{ pod.cpuLimit || "-" }}</td>
              <td>{{ pod.cpuUsage || "-" }}</td>
              <td>{{ pod.memoryRequest || "-" }}</td>
              <td>{{ pod.memoryLimit || "-" }}</td>
              <td>{{ pod.memoryUsage || "-" }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="podResourcesTimestamp" class="timestamp-info">
          Last updated: {{ formatTimestamp(podResourcesTimestamp) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";
import axios from "axios";
import Config from "~~/services/Config.ts";
import VueApexCharts from "vue3-apexcharts";

export default {
  components: {
    apexchart: VueApexCharts,
  },
  data() {
    return {
      stats: [],
      podResources: [],
      podResourcesTimestamp: null,
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      cpuChartOptions: {
        chart: { id: "cpu-line" },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
        yaxis: { min: 0, max: 100 },
        title: { text: "CPU Usage (%)" },
      },
      cpuChartSeries: [],
      memoryChartOptions: {
        chart: { id: "memory-line" },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
        yaxis: { min: 0, max: 100 },
        title: { text: "Memory Usage (%)" },
      },
      memoryChartSeries: [],
      podsChartOptions: {
        chart: { id: "pods-line" },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
        yaxis: { min: 0 },
        title: { text: "Pods per Node" },
      },
      podsChartSeries: [],
    };
  },
  computed: {
    sortedPodResources() {
      return [...this.podResources].sort((a, b) => {
        if (a.namespace !== b.namespace) {
          return a.namespace.localeCompare(b.namespace);
        }
        return a.name.localeCompare(b.name);
      });
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshStats();
    this.refreshPodResources();
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshStats();
        this.refreshPodResources();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  methods: {
    async refreshStats() {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/stats/nodes`,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.stats = res.data.stats;
          this.updateCharts();
        })
        .catch(handleError);
    },
    async refreshPodResources() {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/stats/pod-resources`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.podResources = res.data.podResources;
          if (this.podResources.length > 0) {
            this.podResourcesTimestamp = this.podResources[0].timestamp;
          }
        })
        .catch(handleError);
    },
    updateCharts() {
      const statsByNode = {};
      for (const s of this.stats) {
        if (!statsByNode[s.node]) statsByNode[s.node] = [];
        statsByNode[s.node].push(s);
      }

      Object.values(statsByNode).forEach((arr) =>
        arr.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
      );

      this.cpuChartSeries = Object.keys(statsByNode).map((node) => ({
        name: node,
        data: statsByNode[node].map((s) => [
          new Date(s.timestamp).getTime(),
          Number(s.cpuUsage?.toFixed(2) || 0),
        ]),
      }));
      this.memoryChartSeries = Object.keys(statsByNode).map((node) => ({
        name: node,
        data: statsByNode[node].map((s) => [
          new Date(s.timestamp).getTime(),
          Number(s.memoryUsage?.toFixed(2) || 0),
        ]),
      }));
      this.podsChartSeries = Object.keys(statsByNode).map((node) => ({
        name: node,
        data: statsByNode[node].map((s) => [
          new Date(s.timestamp).getTime(),
          s.pods || 0,
        ]),
      }));
    },
    formatTimestamp(timestamp) {
      if (!timestamp) return "";
      const date = new Date(timestamp);
      return date.toLocaleString();
    },
  },
};
</script>

<style scoped>
#stats-page {
  display: flex;
  flex-direction: column;
  gap: 2em;
}

.section-title {
  margin: 0 0 1em 0;
}

#stats-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(25em, 1fr));
  gap: 2em;
}

.no-data {
  text-align: center;
  padding: 2em;
}

.timestamp-info {
  margin-top: 1em;
  font-size: 0.85em;
}
</style>

<style>
.apexcharts-tooltip {
  color: #333;
}
:root[data-theme="dark"] .apexcharts-xaxis text,
:root[data-theme="dark"] .apexcharts-yaxis text {
  fill: #eee !important;
}
:root[data-theme="dark"] .apexcharts-legend-text {
  color: #eee !important;
}
:root[data-theme="dark"] .apexcharts-title-text {
  fill: #eee !important;
  color: #eee !important;
}
</style>
