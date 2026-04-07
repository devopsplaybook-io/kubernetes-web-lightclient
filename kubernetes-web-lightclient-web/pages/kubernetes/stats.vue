<template>
  <div id="stats-page">
    <h2>Metrics</h2>
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
    <h2>Requests/Limits/Usage</h2>
    <h6>By Pods</h6>
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
            <th>CPU Req / Limit</th>
            <th>CPU Usage</th>
            <th>Mem Req / Limit</th>
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
            <td class="resource-cell">
              {{ pod.cpuRequest || "-" }} / {{ pod.cpuLimit || "-" }}
            </td>
            <td>{{ pod.cpuUsage || "-" }}</td>
            <td class="resource-cell">
              {{ pod.memoryRequest || "-" }} / {{ pod.memoryLimit || "-" }}
            </td>
            <td>{{ pod.memoryUsage || "-" }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="podResourcesTimestamp" class="timestamp-info">
        Last updated: {{ formatTimestamp(podResourcesTimestamp) }}
      </div>
    </div>

    <h6>By Namespace</h6>
    <div v-if="podResources.length === 0" class="no-data">
      No pod resource data available
    </div>
    <div v-else>
      <table class="striped">
        <thead>
          <tr>
            <th>Namespace</th>
            <th>CPU Req / Limit</th>
            <th>CPU Usage</th>
            <th>Mem Req / Limit</th>
            <th>Mem Usage</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in namespaceAggregates" :key="row.namespace">
            <td>{{ row.namespace }}</td>
            <td class="resource-cell">
              {{ row.cpuRequest }} / {{ row.cpuLimit }}
            </td>
            <td>{{ row.cpuUsage }}</td>
            <td class="resource-cell">
              {{ row.memoryRequest }} / {{ row.memoryLimit }}
            </td>
            <td>{{ row.memoryUsage }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h6>By Node</h6>
    <div v-if="podResources.length === 0" class="no-data">
      No pod resource data available
    </div>
    <div v-else>
      <table class="striped">
        <thead>
          <tr>
            <th>Node</th>
            <th>CPU Req / Limit</th>
            <th>CPU Usage</th>
            <th>Mem Req / Limit</th>
            <th>Mem Usage</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in nodeAggregates" :key="row.node">
            <td>{{ row.node }}</td>
            <td class="resource-cell">
              {{ row.cpuRequest }} / {{ row.cpuLimit }}
            </td>
            <td>{{ row.cpuUsage }}</td>
            <td class="resource-cell">
              {{ row.memoryRequest }} / {{ row.memoryLimit }}
            </td>
            <td>{{ row.memoryUsage }}</td>
          </tr>
        </tbody>
      </table>
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
    namespaceAggregates() {
      return this._buildAggregates("namespace");
    },
    nodeAggregates() {
      return this._buildAggregates("node");
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
    // Parse Kubernetes CPU string to millicores (number)
    _parseCpuToMillicores(val) {
      if (!val) return null;
      // handle compound values like "100m+200m"
      if (val.includes("+")) {
        return val.split("+").reduce((sum, v) => {
          const p = this._parseCpuToMillicores(v);
          return p !== null ? sum + p : sum;
        }, 0);
      }
      if (val.endsWith("m")) return parseFloat(val);
      return parseFloat(val) * 1000;
    },
    // Parse Kubernetes memory string to MiB (number)
    _parseMemoryToMiB(val) {
      if (!val) return null;
      if (val.includes("+")) {
        return val.split("+").reduce((sum, v) => {
          const p = this._parseMemoryToMiB(v);
          return p !== null ? sum + p : sum;
        }, 0);
      }
      if (val.endsWith("Ki")) return parseFloat(val) / 1024;
      if (val.endsWith("Mi")) return parseFloat(val);
      if (val.endsWith("Gi")) return parseFloat(val) * 1024;
      if (val.endsWith("Ti")) return parseFloat(val) * 1024 * 1024;
      if (val.endsWith("k") || val.endsWith("K")) return parseFloat(val) / 1000;
      if (val.endsWith("M")) return parseFloat(val);
      if (val.endsWith("G")) return parseFloat(val) * 1000;
      return parseFloat(val) / (1024 * 1024);
    },
    _formatCpu(millicores) {
      if (millicores === null || isNaN(millicores)) return "-";
      if (millicores >= 1000) return `${(millicores / 1000).toFixed(2)}`;
      return `${Math.round(millicores)}m`;
    },
    _formatMemory(mib) {
      if (mib === null || isNaN(mib)) return "-";
      if (mib >= 1024) return `${(mib / 1024).toFixed(2)}Gi`;
      return `${Math.round(mib)}Mi`;
    },
    _buildAggregates(groupKey) {
      const groups = {};
      for (const pod of this.podResources) {
        const key = pod[groupKey] || "N/A";
        if (!groups[key]) {
          groups[key] = {
            cpuReq: 0,
            cpuLim: 0,
            cpuUse: 0,
            memReq: 0,
            memLim: 0,
            memUse: 0,
            hasCpuReq: false,
            hasCpuLim: false,
            hasCpuUse: false,
            hasMemReq: false,
            hasMemLim: false,
            hasMemUse: false,
          };
        }
        const g = groups[key];
        const cpuReq = this._parseCpuToMillicores(pod.cpuRequest);
        const cpuLim = this._parseCpuToMillicores(pod.cpuLimit);
        const cpuUse = this._parseCpuToMillicores(pod.cpuUsage);
        const memReq = this._parseMemoryToMiB(pod.memoryRequest);
        const memLim = this._parseMemoryToMiB(pod.memoryLimit);
        const memUse = this._parseMemoryToMiB(pod.memoryUsage);
        if (cpuReq !== null && !isNaN(cpuReq)) {
          g.cpuReq += cpuReq;
          g.hasCpuReq = true;
        }
        if (cpuLim !== null && !isNaN(cpuLim)) {
          g.cpuLim += cpuLim;
          g.hasCpuLim = true;
        }
        if (cpuUse !== null && !isNaN(cpuUse)) {
          g.cpuUse += cpuUse;
          g.hasCpuUse = true;
        }
        if (memReq !== null && !isNaN(memReq)) {
          g.memReq += memReq;
          g.hasMemReq = true;
        }
        if (memLim !== null && !isNaN(memLim)) {
          g.memLim += memLim;
          g.hasMemLim = true;
        }
        if (memUse !== null && !isNaN(memUse)) {
          g.memUse += memUse;
          g.hasMemUse = true;
        }
      }
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, g]) => ({
          [groupKey]: key,
          cpuRequest: g.hasCpuReq ? this._formatCpu(g.cpuReq) : "-",
          cpuLimit: g.hasCpuLim ? this._formatCpu(g.cpuLim) : "-",
          cpuUsage: g.hasCpuUse ? this._formatCpu(g.cpuUse) : "-",
          memoryRequest: g.hasMemReq ? this._formatMemory(g.memReq) : "-",
          memoryLimit: g.hasMemLim ? this._formatMemory(g.memLim) : "-",
          memoryUsage: g.hasMemUse ? this._formatMemory(g.memUse) : "-",
        }));
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

.resource-cell {
  white-space: nowrap;
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
