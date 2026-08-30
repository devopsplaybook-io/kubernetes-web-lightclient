<template>
  <Teleport to="body">
    <dialog id="dialog-details-logs" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="clickClose()"
          ></a>
          Pod Log: {{ podname }} ({{ namespace }})
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
              v-if="containers.length > 1"
              v-model="selectedContainer"
              @change="fetchLogs"
            >
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
            <label v-if="restartCount > 0">
              <input
                type="checkbox"
                v-model="showPreviousLog"
                @change="fetchLogs()"
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
          </div>
        </section>
        <pre
          id="dialog-details-logs-text"
          ref="logsText"
          :style="{ whiteSpace: wrapText ? 'pre-wrap' : 'pre' }"
          >{{ filteredText }}</pre
        >
      </article>
    </dialog>
  </Teleport>
</template>

<script>
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { PreferencesService } from "~~/services/PreferencesService";
import { UtilsDecompressData } from "~/services/Utils";
import axios from "axios";
import Config from "~~/services/Config.ts";
import { debounce } from "lodash";

export default {
  props: {
    podname: "",
    namespace: "",
    title: "",
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
      debouncedFilter: null,
      containers: [],
      selectedContainer: "",
      restartCount: 0,
      showPreviousLog: false,
      autoRefresh: false,
      autoRefreshTimer: null,
    };
  },
  computed: {
    filteredText() {
      if (!this.filterText) return this.text;
      const filterLower = this.filterText.toLowerCase();
      return this.text
        .split("\n")
        .filter((line) => line.toLowerCase().includes(filterLower))
        .join("\n");
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
      this.filterText = this.filterText;
    }, 300);
    await this.fetchPodDetails();
    await this.fetchLogs();
  },
  beforeUnmount() {
    this.stopAutoRefresh();
  },
  methods: {
    async clickClose(namespace, podname) {
      this.$emit("onClose", {});
    },
    async fetchPodDetails() {
      // Fetch pod details to get containers and restart count
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
        const containers = (pod.spec.containers || []).map((c) => c.name);
        const initContainers = (pod.spec.initContainers || []).map(
          (c) => c.name,
        );
        this.containers = [...containers, ...initContainers];
        this.selectedContainer = this.containers[0] || "";
        const containerRestarts = (pod.status.containerStatuses || []).reduce(
          (sum, cs) => sum + (cs.restartCount || 0),
          0,
        );
        const initRestarts = (pod.status.initContainerStatuses || []).reduce(
          (sum, cs) => sum + (cs.restartCount || 0),
          0,
        );
        this.restartCount = containerRestarts + initRestarts;
      } catch (e) {
        handleError(e);
      }
    },
    onAutoRefreshChange() {
      if (this.autoRefresh) {
        this.fetchLogs(true);
        this.autoRefreshTimer = setInterval(
          () => this.fetchLogs(true),
          10000,
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
    async fetchLogs(silent = false) {
      const payload = {
        namespace: this.namespace,
        pod: this.podname,
        container: this.selectedContainer,
        argument: "",
      };
      if (this.logTime !== "all") {
        payload.argument += ` --since=${this.logTime} `;
      }
      if (this.showPreviousLog) {
        payload.argument += ` --previous `;
      }
      payload.timestamps = this.showTimestamps;
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
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/logs`,
          payload,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          const newText = await UtilsDecompressData(res.data.result);
          if (silent && newText === this.text) {
            return;
          }
          this.text = newText;
          if (silent) {
            // Keep the reading position: new lines are appended at the
            // bottom without resetting the view. When already following
            // the latest lines, keep following them.
            await this.$nextTick();
            const updatedElement = this.$refs.logsText;
            if (updatedElement) {
              updatedElement.scrollTop = wasAtBottom
                ? updatedElement.scrollHeight
                : previousScrollTop;
            }
          }
        })
        .catch(handleError);
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
#dialog-details-logs-text {
  overflow: auto;
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

#dialog-details-logs .log-controls-advanced .filter-input {
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
</style>
