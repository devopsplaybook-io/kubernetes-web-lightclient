<template>
  <Teleport to="body">
    <dialog id="dialog-details-logs" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click.prevent="clickClose()"
          ></a>
          {{ headerText }}
        </header>
        <section class="log-controls-primary">
          <div class="log-controls-row">
            <select v-model="logTime" @change="fetchLogs()">
              <option value="all">All</option>
              <option value="10m">Last 10min</option>
              <option value="1h">Last 1h</option>
              <option value="24h">Last 1 day</option>
            </select>
            <span class="actions"
              ><i
                class="bi bi-clipboard"
                title="Copy logs"
                v-on:click="copyLogs()"
              ></i
              ><i
                class="bi bi-download"
                title="Download logs"
                v-on:click="downloadLogs()"
              ></i
              ><i class="bi bi-arrow-clockwise" v-on:click="fetchLogs()"></i
            ></span>
          </div>
          <a
            href="#"
            class="advanced-toggle"
            v-on:click.prevent="showAdvancedOptions = !showAdvancedOptions"
          >
            <i
              :class="
                showAdvancedOptions
                  ? 'bi bi-chevron-down'
                  : 'bi bi-chevron-right'
              "
            ></i>
            Advanced
          </a>
          <div v-if="showAdvancedOptions" class="log-controls-advanced">
            <select
              v-if="merged ? containers.length > 0 : containers.length > 1"
              v-model="selectedContainer"
              @change="fetchLogs"
            >
              <option v-if="merged" value="">Default container</option>
              <option
                v-for="container in containers"
                :key="container"
                :value="container"
              >
                {{ container }}
              </option>
            </select>
            <label>
              <input type="checkbox" v-model="wrapText" />
              Wrap
            </label>
            <label>
              <input
                type="checkbox"
                v-model="showTimestamps"
                @change="fetchLogs()"
              />
              Timestamps
            </label>
            <label>
              <input
                type="checkbox"
                v-model="autoRefresh"
                @change="onAutoRefreshChange"
              />
              Auto-refresh
            </label>
            <label>
              <input type="checkbox" v-model="follow" @change="onFollowChange" />
              Follow
            </label>
            <label v-if="restartCount > 0">
              <input
                type="checkbox"
                v-model="showPreviousLog"
                @change="onPreviousChange"
              />
              Previous ({{ restartCount }} restarts)
            </label>
            <input
              type="text"
              class="filter-input"
              v-model="filterText"
              placeholder="Filter logs"
              @input="debouncedFilter"
            />
            <label>
              <input
                type="checkbox"
                :checked="filterMode === 'regex'"
                @change="onFilterModeChange"
              />
              Regex
            </label>
            <label>
              <input
                type="checkbox"
                v-model="filterCaseSensitive"
                @change="onFilterCaseChange"
              />
              Case
            </label>
            <span class="filter-summary">{{ filterSummary }}</span>
            <div
              v-if="merged && allPods.length > maxPods"
              class="log-pod-cap"
            >
              <span v-if="selectedPods.length === maxPods">
                Showing logs for the first {{ maxPods }} of
                {{ allPods.length }} pods —
              </span>
              <span v-else>
                Showing logs for {{ selectedPods.length }} of
                {{ allPods.length }} pods —
              </span>
              <a href="#" @click.prevent="showPodPicker = !showPodPicker">
                choose pods
              </a>
              <div v-if="showPodPicker" class="log-pod-picker">
                <label v-for="pod in allPods" :key="pod.metadata.name">
                  <input
                    type="checkbox"
                    :value="pod.metadata.name"
                    v-model="selectedPodNames"
                    @change="onPodSelectionChange"
                  />
                  {{ pod.metadata.name }}
                </label>
              </div>
            </div>
          </div>
        </section>
        <div class="log-output">
          <p v-if="regexError" class="log-filter-error">{{ regexError }}</p>
          <section v-if="waitingDisplay" class="log-waiting">
            <p>
              <strong
                >Container is waiting: {{ waitingDisplay.reason }}</strong
              >
            </p>
            <p>{{ waitingDisplay.guidance }}</p>
            <p class="log-waiting-meta">
              <span v-if="waitingDisplay.podName"
                >Pod: {{ waitingDisplay.podName }}</span
              >
              <span v-if="waitingDisplay.container">
                · Container: {{ waitingDisplay.container }}
              </span>
              <span v-if="waitingPhase"> · Phase: {{ waitingPhase }}</span>
            </p>
            <ul v-if="waitingConditions.length" class="log-waiting-conditions">
              <li v-for="condition in waitingConditions" :key="condition.type">
                {{ condition.type }}={{ condition.status }}
                <template v-if="condition.reason"
                  >({{ condition.reason }})</template
                >
              </li>
            </ul>
            <div v-if="waitingEvents.length" class="log-waiting-events">
              <p><strong>Warning events</strong></p>
              <ul>
                <li v-for="(event, index) in waitingEvents" :key="index">
                  {{ event.reason }}: {{ event.message }}
                </li>
              </ul>
            </div>
            <button type="button" @click="retry()">Retry</button>
          </section>
          <ul v-if="partialErrors.length" class="log-errors">
            <li v-for="failure in partialErrors" :key="failure.pod">
              {{ failure.pod }}: {{ failure.message }}
            </li>
          </ul>
          <pre
            id="dialog-details-logs-text"
            ref="logsText"
            :style="{ whiteSpace: wrapText ? 'pre-wrap' : 'pre' }"
            v-html="displayHtml"
          ></pre>
        </div>
      </article>
    </dialog>
  </Teleport>
</template>

<script>
import { AuthService } from "~~/services/AuthService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import { staleAwareHandler } from "~~/services/KubernetesUtils";
import { PreferencesService } from "~~/services/PreferencesService";
import { UtilsDecompressData } from "~/services/Utils";
import {
  DetectPodWaiting,
  MergeLogStreams,
  PodConditions,
  PodRestartCount,
  WaitingGuidance,
  WorkloadKindLabel,
} from "~~/services/WorkloadPods";
import { FetchWarningEvents } from "~~/services/WorkloadPodsService";
import {
  EscapeHtml,
  FilterLogLines,
  HighlightLogLine,
} from "~~/services/LogFilter";
import axios from "axios";
import Config from "~~/services/Config.ts";
import { debounce } from "lodash";

const AUTO_REFRESH_INTERVAL_MS = 10000;
const FOLLOW_INTERVAL_MS = 4000;
const BUSY_RETRY_DELAY_MS = 1000;
const MERGED_LOG_CONCURRENCY = 3;

function PodContainers(pod) {
  return [
    ...(pod?.spec?.containers || []),
    ...(pod?.spec?.initContainers || []),
  ]
    .map((container) => container.name)
    .filter(Boolean);
}

export default {
  props: {
    podname: {
      type: String,
      default: "",
    },
    namespace: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      default: "",
    },
    pods: {
      type: Array,
      default: () => [],
    },
    workloadKind: {
      type: String,
      default: "",
    },
    workloadName: {
      type: String,
      default: "",
    },
    maxPods: {
      type: Number,
      default: 10,
    },
  },
  data() {
    return {
      text: "",
      wrapText: PreferencesService.getStoredBoolean(
        PreferencesService.LOG_WRAP_KEY,
        false,
      ),
      logTime: "10m",
      showTimestamps: PreferencesService.getStoredBoolean(
        PreferencesService.LOG_TIMESTAMPS_KEY,
        true,
      ),
      showAdvancedOptions: false,
      filterText: "",
      appliedFilterText: "",
      filterMode: PreferencesService.getStoredBoolean(
        PreferencesService.LOG_FILTER_REGEX_KEY,
        false,
      )
        ? "regex"
        : "text",
      filterCaseSensitive: PreferencesService.getStoredBoolean(
        PreferencesService.LOG_FILTER_CASE_KEY,
        false,
      ),
      debouncedFilter: null,
      containers: [],
      selectedContainer: "",
      podDetails: null,
      singleRestartCount: 0,
      selectedPodNames: [],
      showPodPicker: false,
      showPreviousLog: false,
      autoRefresh: false,
      autoRefreshTimer: null,
      follow: false,
      followTimer: null,
      fetchInFlight: false,
      waitingEntries: [],
      waitingEvents: [],
      partialErrors: [],
    };
  },
  computed: {
    merged() {
      return Array.isArray(this.pods) && this.pods.length > 0;
    },
    allPods() {
      return [...this.pods].sort((a, b) =>
        String(a.metadata?.name).localeCompare(String(b.metadata?.name)),
      );
    },
    selectedPods() {
      const selected = new Set(this.selectedPodNames);
      return this.allPods.filter((pod) => selected.has(pod.metadata?.name));
    },
    headerText() {
      if (this.merged) {
        return `${WorkloadKindLabel(this.workloadKind)} ${this.workloadName} logs — ${this.selectedPods.length} pod(s) (${this.namespace})`;
      }
      return `Pod Log: ${this.podname} (${this.namespace})`;
    },
    restartCount() {
      if (!this.merged) {
        return this.singleRestartCount;
      }
      return this.allPods.reduce(
        (maximum, pod) => Math.max(maximum, PodRestartCount(pod)),
        0,
      );
    },
    filterOptions() {
      return {
        query: this.appliedFilterText,
        mode: this.filterMode,
        caseSensitive: this.filterCaseSensitive,
      };
    },
    filterResult() {
      return FilterLogLines(this.text, this.filterOptions);
    },
    filteredText() {
      return this.filterResult.lines.join("\n");
    },
    displayHtml() {
      if (!this.appliedFilterText) {
        return EscapeHtml(this.text);
      }
      return this.filterResult.lines
        .map((line) => HighlightLogLine(line, this.filterOptions))
        .join("\n");
    },
    regexError() {
      return this.appliedFilterText ? this.filterResult.error : "";
    },
    filterSummary() {
      if (this.filterResult.error) {
        return "";
      }
      if (!this.appliedFilterText) {
        return `${this.filterResult.total} lines`;
      }
      return `${this.filterResult.matched} of ${this.filterResult.total} lines`;
    },
    blockedPodNames() {
      return new Set(this.waitingEntries.map((entry) => entry.podName));
    },
    waitingDisplay() {
      return this.waitingEntries[0] || null;
    },
    waitingPhase() {
      return this.waitingDisplay?.pod?.status?.phase || "";
    },
    waitingConditions() {
      return PodConditions(this.waitingDisplay?.pod);
    },
  },
  watch: {
    wrapText(value) {
      PreferencesService.storeBoolean(
        PreferencesService.LOG_WRAP_KEY,
        value,
      );
    },
    showTimestamps(value) {
      PreferencesService.storeBoolean(
        PreferencesService.LOG_TIMESTAMPS_KEY,
        value,
      );
    },
  },
  async created() {
    this.debouncedFilter = debounce(() => {
      this.appliedFilterText = this.filterText;
    }, 300);
    if (this.merged) {
      this.selectedPodNames = this.allPods
        .slice(0, this.maxPods)
        .map((pod) => pod.metadata.name);
      await this.applyMergedDetails();
    } else {
      await this.fetchPodDetails();
    }
    await this.fetchLogs();
  },
  beforeUnmount() {
    this.stopAutoRefresh();
    this.stopFollow();
  },
  methods: {
    async clickClose() {
      this.$emit("onClose", {});
    },
    async fetchPodDetails() {
      // Single-pod mode only: containers and restart count come from the pod.
      try {
        const res = await axios.post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            object: "pod",
            command: "get",
            namespace: this.namespace,
            argument: this.podname,
          },
          await AuthService.getAuthHeader(),
        );
        const pod = JSON.parse(await UtilsDecompressData(res.data.result));
        this.podDetails = pod;
        this.containers = PodContainers(pod);
        this.selectedContainer = this.containers[0] || "";
        this.singleRestartCount = PodRestartCount(pod);
        this.rebuildWaitingEntries();
      } catch (e) {
        staleAwareHandler("pod")(e);
      }
    },
    async applyMergedDetails() {
      // Merged mode: derive everything from the supplied pod objects, so
      // opening the dialog never adds a request per pod.
      const containers = [];
      for (const pod of this.allPods) {
        for (const name of PodContainers(pod)) {
          if (!containers.includes(name)) {
            containers.push(name);
          }
        }
      }
      this.containers = containers;
      if (this.selectedContainer && !containers.includes(this.selectedContainer)) {
        this.selectedContainer = "";
      }
      this.singleRestartCount = 0;
      this.rebuildWaitingEntries();
    },
    podEntries() {
      if (!this.merged) {
        return this.podDetails
          ? [{ podName: this.podname, pod: this.podDetails }]
          : [];
      }
      return this.selectedPods.map((pod) => ({
        podName: pod.metadata?.name,
        pod,
      }));
    },
    rebuildWaitingEntries() {
      const entries = [];
      for (const { podName, pod } of this.podEntries()) {
        const waiting = DetectPodWaiting(pod);
        if (!waiting) {
          continue;
        }
        const canReadPrevious =
          this.showPreviousLog && PodRestartCount(pod) > 0;
        if (canReadPrevious) {
          continue;
        }
        entries.push({
          podName,
          container: waiting.container,
          reason: waiting.reason,
          guidance: WaitingGuidance(waiting.reason),
          pod,
        });
      }
      this.waitingEntries = entries;
      if (entries.length > 0) {
        this.loadWarningEvents(entries.map((entry) => entry.podName));
      } else {
        this.waitingEvents = [];
      }
    },
    async loadWarningEvents(podNames) {
      try {
        this.waitingEvents = await FetchWarningEvents(this.namespace, podNames);
      } catch {
        this.waitingEvents = [];
      }
    },
    addWaitingFromResponse(podName, error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 409) {
        return false;
      }
      const data = error.response.data || {};
      if (typeof data.reason !== "string") {
        return false;
      }
      if (this.blockedPodNames.has(podName)) {
        return true;
      }
      this.waitingEntries = [
        ...this.waitingEntries,
        {
          podName,
          container: typeof data.container === "string" ? data.container : "",
          reason: data.reason,
          guidance: WaitingGuidance(data.reason),
          pod: null,
        },
      ];
      this.loadWarningEvents([podName]);
      return true;
    },
    async onPreviousChange() {
      if (this.merged) {
        await this.applyMergedDetails();
      } else if (this.podDetails) {
        this.rebuildWaitingEntries();
      }
      await this.fetchLogs();
    },
    async onFilterModeChange(event) {
      this.filterMode = event.target.checked ? "regex" : "text";
      PreferencesService.storeBoolean(
        PreferencesService.LOG_FILTER_REGEX_KEY,
        this.filterMode === "regex",
      );
      this.appliedFilterText = this.filterText;
    },
    async onFilterCaseChange() {
      PreferencesService.storeBoolean(
        PreferencesService.LOG_FILTER_CASE_KEY,
        this.filterCaseSensitive,
      );
      this.appliedFilterText = this.filterText;
    },
    async onPodSelectionChange() {
      if (this.selectedPodNames.length > this.maxPods) {
        this.selectedPodNames = this.selectedPodNames.slice(-this.maxPods);
      }
      await this.applyMergedDetails();
      await this.fetchLogs();
    },
    onAutoRefreshChange() {
      if (this.autoRefresh) {
        this.follow = false;
        this.stopFollow();
        this.fetchLogs(true);
        this.autoRefreshTimer = setInterval(
          () => this.fetchLogs(true),
          AUTO_REFRESH_INTERVAL_MS,
        );
      } else {
        this.stopAutoRefresh();
      }
    },
    stopAutoRefresh() {
      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer);
        this.autoRefreshTimer = null;
      }
    },
    onFollowChange() {
      if (this.follow) {
        this.autoRefresh = false;
        this.stopAutoRefresh();
        this.fetchLogs(true);
        this.followTimer = setInterval(
          () => this.fetchLogs(true),
          FOLLOW_INTERVAL_MS,
        );
      } else {
        this.stopFollow();
      }
    },
    stopFollow() {
      if (this.followTimer) {
        clearInterval(this.followTimer);
        this.followTimer = null;
      }
    },
    async copyLogs() {
      const text = this.filteredText;
      try {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Plain-HTTP deployments have no secure context: fall back to a
          // temporary textarea and the legacy execCommand clipboard API
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!copied) {
            throw new Error("Clipboard copy failed");
          }
        }
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Logs copied to clipboard",
        });
      } catch {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Failed to copy logs to clipboard",
        });
      }
    },
    downloadLogs() {
      const blob = new Blob([this.filteredText], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      if (this.merged) {
        link.download = `${this.namespace}_${this.workloadKind}_${this.workloadName}.log`;
      } else {
        const containerSuffix = this.selectedContainer
          ? `_${this.selectedContainer}`
          : "";
        link.download = `${this.namespace}_${this.podname}${containerSuffix}.log`;
      }
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    },
    LogArgument(previous) {
      const parts = [];
      if (this.logTime !== "all") {
        parts.push(`--since=${this.logTime}`);
      }
      if (previous) {
        parts.push("--previous");
      }
      return parts.join(" ");
    },
    async postLogs(payload) {
      const url = `${(await Config.get()).SERVER_URL}/kubectl/logs`;
      const headers = await AuthService.getAuthHeader();
      try {
        return await axios.post(url, payload, headers);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          await new Promise((resolve) =>
            setTimeout(resolve, BUSY_RETRY_DELAY_MS),
          );
          return axios.post(url, payload, headers);
        }
        throw error;
      }
    },
    containerForPod(pod) {
      const containers = PodContainers(pod);
      if (this.selectedContainer) {
        return containers.includes(this.selectedContainer)
          ? this.selectedContainer
          : null;
      }
      return containers[0] || "";
    },
    async fetchLogs(silent = false) {
      if (this.merged) {
        return this.fetchMergedLogs(silent);
      }
      return this.fetchSingleLogs(silent);
    },
    async fetchSingleLogs(silent = false) {
      // Skip this tick when a fetch is already pending: slow responses must
      // not stack up behind the Follow/Auto-refresh intervals.
      if (this.fetchInFlight) {
        return;
      }
      if (this.waitingEntries.length > 0) {
        return;
      }
      this.fetchInFlight = true;
      try {
        const payload = {
          namespace: this.namespace,
          pod: this.podname,
          container: this.selectedContainer,
          argument: this.LogArgument(this.showPreviousLog),
          timestamps: this.showTimestamps,
        };
        const logsElement = this.$refs.logsText;
        const previousScrollTop = logsElement ? logsElement.scrollTop : 0;
        const wasAtBottom = logsElement
          ? logsElement.scrollHeight -
              logsElement.scrollTop -
              logsElement.clientHeight <
            40
          : true;
        if (!silent) {
          this.text = "Loading logs...";
        }
        await this.postLogs(payload)
          .then(async (res) => {
            const newText = await UtilsDecompressData(res.data.result);
            if (silent && newText === this.text) {
              return;
            }
            this.text = newText;
            if (silent) {
              await this.restoreScroll(previousScrollTop, wasAtBottom);
            }
          })
          .catch((error) => {
            if (this.addWaitingFromResponse(this.podname, error)) {
              return;
            }
            staleAwareHandler("pod")(error);
          });
      } finally {
        this.fetchInFlight = false;
      }
    },
    async fetchMergedLogs(silent = false) {
      if (this.fetchInFlight) {
        return;
      }
      const pods = this.selectedPods.filter(
        (pod) =>
          !this.blockedPodNames.has(pod.metadata?.name) &&
          this.containerForPod(pod) !== null,
      );
      if (pods.length === 0) {
        this.text = "";
        return;
      }
      this.fetchInFlight = true;
      try {
        const logsElement = this.$refs.logsText;
        const previousScrollTop = logsElement ? logsElement.scrollTop : 0;
        const wasAtBottom = logsElement
          ? logsElement.scrollHeight -
              logsElement.scrollTop -
              logsElement.clientHeight <
            40
          : true;
        if (!silent) {
          this.text = "Loading logs...";
        }
        const results = {};
        const failures = [];
        let nextIndex = 0;
        const workers = Array.from(
          {
            length: Math.min(MERGED_LOG_CONCURRENCY, pods.length),
          },
          async () => {
            while (true) {
              const index = nextIndex++;
              if (index >= pods.length) {
                return;
              }
              const pod = pods[index];
              const podName = pod.metadata.name;
              const container = this.containerForPod(pod);
              const previous =
                this.showPreviousLog && PodRestartCount(pod) > 0;
              try {
                const response = await this.postLogs({
                  namespace: this.namespace,
                  pod: podName,
                  container,
                  argument: this.LogArgument(previous),
                  // The merge needs timestamps on every line; the display
                  // toggle only decides whether they are kept.
                  timestamps: true,
                });
                results[podName] = await UtilsDecompressData(
                  response.data.result,
                );
              } catch (error) {
                if (this.addWaitingFromResponse(podName, error)) {
                  continue;
                }
                const data = axios.isAxiosError(error)
                  ? error.response?.data
                  : null;
                failures.push({
                  pod: podName,
                  message:
                    typeof data?.error === "string"
                      ? data.error
                      : "logs unavailable",
                });
              }
            }
          },
        );
        await Promise.all(workers);
        const merged = MergeLogStreams(
          Object.entries(results).map(([pod, text]) => ({ pod, text })),
          this.showTimestamps,
        );
        this.partialErrors = failures;
        if (silent && merged.text === this.text) {
          return;
        }
        this.text = merged.text;
        if (silent) {
          await this.restoreScroll(previousScrollTop, wasAtBottom);
        }
      } finally {
        this.fetchInFlight = false;
      }
    },
    async restoreScroll(previousScrollTop, wasAtBottom) {
      // Keep the reading position: new lines are appended at the bottom
      // without resetting the view. When already following the latest lines,
      // keep following them.
      await this.$nextTick();
      const updatedElement = this.$refs.logsText;
      if (updatedElement) {
        updatedElement.scrollTop = wasAtBottom
          ? updatedElement.scrollHeight
          : previousScrollTop;
      }
    },
    async retry() {
      this.partialErrors = [];
      this.waitingEvents = [];
      this.waitingEntries = [];
      if (this.merged) {
        await this.applyMergedDetails();
      } else {
        await this.fetchPodDetails();
      }
      await this.fetchLogs();
    },
  },
};
</script>

<style scoped>
#dialog-details-logs article {
  min-width: 90dvw;
  height: 90dvh;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 0;
}
#dialog-details-logs .log-output {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
#dialog-details-logs-text {
  flex: 1 1 auto;
  overflow: auto;
  margin: 0;
}

/* Primary controls container — wraps everything except header and log text */
#dialog-details-logs .log-controls-primary {
  margin-bottom: 0.5rem;
}

/*
 * Primary controls row: time range takes the available width, refresh
 * action stays on the same line aligned to the end.
 */
#dialog-details-logs .log-controls-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 0.75rem;
  align-items: center;
}

#dialog-details-logs .log-controls-row select {
  width: 100%;
  margin: 0;
}

#dialog-details-logs .log-controls-row .actions {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

/* Advanced toggle link */
#dialog-details-logs .advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85em;
  opacity: 0.6;
  cursor: pointer;
  margin-top: 0.25rem;
  text-decoration: none;
  color: inherit;
}
#dialog-details-logs .advanced-toggle:hover {
  opacity: 1;
}

/*
 * Advanced options: responsive grid. Each control gets an equal-width
 * column on wide screens; columns are automatically dropped and controls
 * wrap onto multiple rows as the dialog gets narrower. The filter input
 * always spans the full width.
 */
#dialog-details-logs .log-controls-advanced {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.5rem 0.75rem;
  align-items: center;
  margin-top: 0.4rem;
}

#dialog-details-logs .log-controls-advanced select,
#dialog-details-logs .log-controls-advanced input[type="text"] {
  width: 100%;
  margin: 0;
  min-width: 0;
}

#dialog-details-logs .log-controls-advanced .filter-input,
#dialog-details-logs .log-controls-advanced .log-pod-cap {
  grid-column: 1 / -1;
}

#dialog-details-logs .log-controls-advanced label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  white-space: nowrap;
}

#dialog-details-logs .log-controls-advanced label input[type="checkbox"] {
  margin: 0;
}

#dialog-details-logs .filter-summary {
  font-size: 0.85em;
  opacity: 0.7;
}

#dialog-details-logs .log-pod-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.25rem 0.75rem;
  margin-top: 0.25rem;
}

#dialog-details-logs .log-waiting {
  border-left: 4px solid var(--pico-del-color, #d93526);
  background: var(--pico-card-sectioning-background-color, #f7f7f7);
  padding: 0.5rem 0.75rem;
  margin: 0;
}
#dialog-details-logs .log-waiting p {
  margin: 0 0 0.35rem 0;
}
#dialog-details-logs .log-waiting-conditions,
#dialog-details-logs .log-waiting-events ul {
  margin: 0 0 0.35rem 1rem;
  font-size: 0.9em;
}
#dialog-details-logs .log-filter-error {
  color: var(--pico-del-color, #d93526);
  margin: 0;
  font-size: 0.9em;
}
#dialog-details-logs .log-errors {
  margin: 0 0 0 1rem;
  font-size: 0.9em;
}
</style>
