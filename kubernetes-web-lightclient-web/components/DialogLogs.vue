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
            <select v-model="logTime" @change="fetchLogs">
              <option value="all">All</option>
              <option value="10m">Last 10min</option>
              <option value="1h">Last 1h</option>
              <option value="24h">Last 1 day</option>
            </select>
            <label>
              <input type="checkbox" v-model="wrapText" />
              Wrap
            </label>
            <label>
              <input
                type="checkbox"
                v-model="showTimestamps"
                @change="fetchLogs"
              />
              Timestamps
            </label>
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
            <span class="actions"
              ><i class="bi bi-arrow-clockwise" v-on:click="fetchLogs"></i
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
            <input
              type="text"
              v-model="filterText"
              placeholder="Filter logs"
              @input="debouncedFilter"
            />
            <label v-if="restartCount > 0">
              <input
                type="checkbox"
                v-model="showPreviousLog"
                @change="fetchLogs"
              />
              Previous ({{ restartCount }} restarts)
            </label>
          </div>
        </section>
        <pre
          id="dialog-details-logs-text"
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
      wrapText: false,
      logTime: "10m",
      showTimestamps: true,
      showAdvancedOptions: false,
      filterText: "",
      debouncedFilter: null,
      containers: [],
      selectedContainer: "",
      restartCount: 0,
      showPreviousLog: false,
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
  async created() {
    this.debouncedFilter = debounce(() => {
      this.filterText = this.filterText;
    }, 300);
    await this.fetchPodDetails();
    await this.fetchLogs();
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
    async fetchLogs() {
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
      this.text = "Loading logs...";
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/logs`,
          payload,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.text = await UtilsDecompressData(res.data.result);
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
 * Controls row: responsive grid.
 * Each control gets an equal-width column on wide screens; columns are
 * automatically dropped and controls wrap onto multiple rows as the dialog
 * gets narrower (down to a single stacked column on small screens).
 */
#dialog-details-logs .log-controls-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.5rem 0.75rem;
  align-items: center;
}

#dialog-details-logs .log-controls-row select,
#dialog-details-logs .log-controls-row input[type="text"] {
  width: 100%;
  margin: 0;
}

#dialog-details-logs .log-controls-row label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  white-space: nowrap;
}

#dialog-details-logs .log-controls-row label input[type="checkbox"] {
  margin: 0;
}

/* Refresh action stays aligned to the end of its column */
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

/* Advanced options grid: filter grows, previous-log toggle hugs its content */
#dialog-details-logs .log-controls-advanced {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 0.75rem;
  align-items: center;
  margin-top: 0.4rem;
}

#dialog-details-logs .log-controls-advanced input[type="text"] {
  margin: 0;
  min-width: 0;
}

#dialog-details-logs .log-controls-advanced label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  white-space: nowrap;
}

/* Responsive: stack advanced options on narrow screens */
@media (max-width: 700px) {
  #dialog-details-logs .log-controls-advanced {
    grid-template-columns: 1fr;
  }
}
</style>
