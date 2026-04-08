<template>
  <div id="stats-page">
    <h3>Metrics</h3>
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
    <h3>Requests/Limits/Usage</h3>
    <h6>By Pods</h6>
    <div v-if="mergedPodRows.length === 0" class="no-data">
      No pod data available
    </div>
    <div v-else class="table-scroll">
      <table class="striped">
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Pod</th>
            <th>Node</th>
            <th>CPU Req / Limit</th>
            <th>CPU Usage (min / latest / max)</th>
            <th>Mem Req / Limit</th>
            <th>Mem Usage (min / latest / max)</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="pod in mergedPodRows"
            :key="`${pod.namespace}-${pod.name}`"
          >
            <td>{{ pod.namespace }}</td>
            <td>{{ pod.name }}</td>
            <td>{{ pod.node }}</td>
            <td>{{ pod.cpuRequest || "-" }} / {{ pod.cpuLimit || "-" }}</td>
            <td>
              <span class="usage-range">
                <span class="range-bound">{{ pod.cpuMin }}</span>
                <span class="range-sep"> &lt; </span>
                <span class="range-latest">{{ pod.cpuLatest }}</span>
                <span class="range-sep"> &lt; </span>
                <span class="range-bound">{{ pod.cpuMax }}</span>
              </span>
            </td>
            <td>
              {{ pod.memoryRequest || "-" }} / {{ pod.memoryLimit || "-" }}
            </td>
            <td>
              <span class="usage-range">
                <span class="range-bound">{{ pod.memMin }}</span>
                <span class="range-sep"> &lt; </span>
                <span class="range-latest">{{ pod.memLatest }}</span>
                <span class="range-sep"> &lt; </span>
                <span class="range-bound">{{ pod.memMax }}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h6>By Namespace</h6>
    <div v-if="podResources.length === 0" class="no-data">
      No pod resource data available
    </div>
    <div v-else class="table-scroll">
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
            <td>{{ row.cpuRequest }} / {{ row.cpuLimit }}</td>
            <td>{{ row.cpuUsage }}</td>
            <td>{{ row.memoryRequest }} / {{ row.memoryLimit }}</td>
            <td>{{ row.memoryUsage }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h6>By Node</h6>
    <div v-if="podResources.length === 0" class="no-data">
      No pod resource data available
    </div>
    <div v-else class="table-scroll">
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
            <td>{{ row.cpuRequest }} / {{ row.cpuLimit }}</td>
            <td>{{ row.cpuUsage }}</td>
            <td>{{ row.memoryRequest }} / {{ row.memoryLimit }}</td>
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
      podUsageStats: [],
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
    sortedPodUsageStats() {
      return [...this.podUsageStats].sort((a, b) => {
        if (a.namespace !== b.namespace) {
          return a.namespace.localeCompare(b.namespace);
        }
        return a.name.localeCompare(b.name);
      });
    },
    mergedPodRows() {
      const usageMap = new Map();
      for (const u of this.podUsageStats) {
        usageMap.set(`${u.namespace}/${u.name}`, u);
      }
      // Start from podResources as the base (has req/limit), union with usage-only pods
      const rows = [];
      const seen = new Set();
      for (const r of this.sortedPodResources) {
        const key = `${r.namespace}/${r.name}`;
        seen.add(key);
        const u = usageMap.get(key);
        rows.push({
          namespace: r.namespace,
          name: r.name,
          node: r.node,
          cpuRequest: r.cpuRequest,
          cpuLimit: r.cpuLimit,
          memoryRequest: r.memoryRequest,
          memoryLimit: r.memoryLimit,
          cpuMin: u ? this.formatCpuRaw(u.cpuMin) : "-",
          cpuLatest: u ? this.formatCpuRaw(u.cpuLatest) : "-",
          cpuMax: u ? this.formatCpuRaw(u.cpuMax) : "-",
          memMin: u ? this.formatMemRaw(u.memoryMin) : "-",
          memLatest: u ? this.formatMemRaw(u.memoryLatest) : "-",
          memMax: u ? this.formatMemRaw(u.memoryMax) : "-",
        });
      }
      // Add pods only in usageStats but not in podResources
      for (const u of this.sortedPodUsageStats) {
        const key = `${u.namespace}/${u.name}`;
        if (!seen.has(key)) {
          rows.push({
            namespace: u.namespace,
            name: u.name,
            node: u.node,
            cpuRequest: null,
            cpuLimit: null,
            memoryRequest: null,
            memoryLimit: null,
            cpuMin: this.formatCpuRaw(u.cpuMin),
            cpuLatest: this.formatCpuRaw(u.cpuLatest),
            cpuMax: this.formatCpuRaw(u.cpuMax),
            memMin: this.formatMemRaw(u.memoryMin),
            memLatest: this.formatMemRaw(u.memoryLatest),
            memMax: this.formatMemRaw(u.memoryMax),
          });
        }
      }
      return rows;
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
    this.refreshPodUsageStats();
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshStats();
        this.refreshPodResources();
        this.refreshPodUsageStats();
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
    async refreshPodUsageStats() {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/stats/pod-usage`,
          await AuthService.getAuthHeader(),
        )
        .then((res) => {
          this.podUsageStats = res.data.podUsageStats;
        })
        .catch(handleError);
    },
    // Format raw millicores number to human-readable CPU string
    formatCpuRaw(millicores) {
      if (millicores === null || millicores === undefined) return "-";
      if (millicores >= 1000) return `${(millicores / 1000).toFixed(2)}`;
      return `${Math.round(millicores)}m`;
    },
    // Format raw KiB number to human-readable memory string
    formatMemRaw(kib) {
      if (kib === null || kib === undefined) return "-";
      if (kib >= 1024 * 1024) return `${(kib / (1024 * 1024)).toFixed(2)}Gi`;
      if (kib >= 1024) return `${(kib / 1024).toFixed(2)}Mi`;
      return `${Math.round(kib)}Ki`;
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
      if (val.endsWith("m")) return parseFloat(val);
      const n = parseFloat(val);
      return isNaN(n) ? null : n * 1000;
    },
    // Parse Kubernetes memory string to MiB (number)
    _parseMemoryToMiB(val) {
      if (!val) return null;
      if (val.endsWith("Ki")) return parseFloat(val) / 1024;
      if (val.endsWith("Mi")) return parseFloat(val);
      if (val.endsWith("Gi")) return parseFloat(val) * 1024;
      if (val.endsWith("Ti")) return parseFloat(val) * 1024 * 1024;
      if (val.endsWith("k") || val.endsWith("K")) return parseFloat(val) / 1000;
      if (val.endsWith("M")) return parseFloat(val);
      if (val.endsWith("G")) return parseFloat(val) * 1000;
      const n = parseFloat(val);
      return isNaN(n) ? null : n / (1024 * 1024);
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

.table-scroll {
  overflow-x: auto;
  width: 100%;
}

.table-scroll td {
  white-space: nowrap;
}

.table-scroll td,
.table-scroll th {
  font-size: 0.9em;
}

.usage-range {
  display: inline-flex;
  align-items: center;
  gap: 0.1em;
}

.range-bound {
  font-size: 0.82em;
  opacity: 0.5;
  font-weight: normal;
}

.range-latest {
  font-size: 1em;
  font-weight: 600;
}

.range-sep {
  font-size: 0.75em;
  opacity: 0.4;
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
