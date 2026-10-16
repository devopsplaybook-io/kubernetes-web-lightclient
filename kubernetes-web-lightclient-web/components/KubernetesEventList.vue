<template>
  <div>
    <ListTriageToolbar
      :filters="availableFilters"
      :active="activeFilters"
      @toggle="toggleFilter"
      @clear="clearAll"
    />
    <table class="striped" v-if="displayedEvents.length > 0">
      <thead>
        <tr>
          <th
            class="sortable"
            :aria-sort="ariaSort('type')"
            v-on:click="onSortToggle('type')"
          >Type {{ sortArrow("type") }}</th>
          <th>Reason</th>
          <th>Message</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('involved')"
            v-on:click="onSortToggle('involved')"
          >Involved Object {{ sortArrow("involved") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('count')"
            v-on:click="onSortToggle('count')"
          >Count {{ sortArrow("count") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('age')"
            v-on:click="onSortToggle('age')"
          >Age {{ sortArrow("age") }}</th>
          <th>Logs</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="event of displayedEvents"
          v-bind:key="eventKey(event)"
        >
          <td :class="event.type === 'Warning' ? 'status-error' : 'status-neutral'">
            {{ event.type }}
          </td>
          <td>{{ event.reason }}</td>
          <td class="event-message">{{ event.message }}</td>
          <td>{{ involvedObjectLabel(event) }}</td>
          <td>{{ event.count || "–" }}</td>
          <td>{{ eventAge(event) }}</td>
          <td>
            <i
              v-if="event.involvedObject?.kind === 'Pod'"
              class="bi bi-file-text-fill"
              v-on:click="
                showLogs(
                  event.involvedObject.namespace || '',
                  event.involvedObject.name,
                )
              "
            ></i>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="isTruncated" class="events-truncated">
      Showing latest {{ maxEvents }} of {{ sortedFilteredEvents.length }} events
    </p>
    <DialogLogs
      v-if="dialogLogs.enable"
      :podname="dialogLogs.podname"
      :namespace="dialogLogs.namespace"
      @onClose="onCloseLogs()"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { UtilsRelativeTime } from "~~/services/Utils";
import { PreferencesService } from "~~/services/PreferencesService";
import { createEventFilters } from "~~/services/ListTriage";
import { useListTriage } from "~~/composables/useListTriage";
import ListTriageToolbar from "~~/components/ListTriageToolbar.vue";

const kubernetesObjectStore = KubernetesObjectStore();

function eventTime(event) {
  return (
    event.lastTimestamp ||
    event.eventTime ||
    event.firstTimestamp ||
    event.metadata?.creationTimestamp ||
    ""
  );
}

function eventAge(event) {
  return UtilsRelativeTime(eventTime(event));
}

function eventKey(event) {
  return (
    event.metadata?.uid ||
    `${event.involvedObject?.namespace || ""}/${event.involvedObject?.name || ""}/${event.reason}/${eventTime(event)}`
  );
}

function involvedObjectLabel(event) {
  const involved = event.involvedObject || {};
  return `${involved.kind || ""} ${involved.name || ""}`.trim();
}

// Time-descending is the unsorted default order; it always runs first so the
// composable's sort, when active, only re-orders an already newest-first list
function newestFirstEvents() {
  const events = [...(kubernetesObjectStore.data.events || [])];
  events.sort((a, b) => (eventTime(a) < eventTime(b) ? 1 : -1));
  return events;
}

const warningsOnlyStored = PreferencesService.getStoredBoolean(
  PreferencesService.EVENTS_WARNINGS_ONLY,
  true,
);

const {
  visibleItems: sortedFilteredEvents,
  onSortToggle,
  availableFilters,
  activeFilters,
  toggleFilter,
  clearAll,
  sortArrow,
  ariaSort,
} = useListTriage("events", {
  rawItems: newestFirstEvents,
  accessors: {
    type: (event) => event.type || "",
    involved: (event) => involvedObjectLabel(event),
    count: (event) => event.count || 0,
    age: (event) => eventTime(event),
  },
  filterDefs: createEventFilters(),
  defaultSortDirections: { count: "desc" },
  initialFilters: warningsOnlyStored ? ["warnings"] : [],
});

const maxEvents = 200;
const displayedEvents = computed(() =>
  sortedFilteredEvents.value.slice(0, maxEvents),
);
const isTruncated = computed(
  () => sortedFilteredEvents.value.length > maxEvents,
);
</script>

<script>
import {
  clearDialogRoute,
  readDialogRoute,
  writeDialogRoute,
} from "~~/services/DialogDeepLink";

export default {
  data() {
    return {
      dialogLogs: {
        enable: false,
        podname: "",
        namespace: "",
      },
    };
  },
  async created() {
    KubernetesObjectStore().getEvents();
    const dialogRoute = readDialogRoute(this.$route?.query);
    if (dialogRoute && dialogRoute.kind === "logs") {
      this.showLogs(dialogRoute.namespace, dialogRoute.name);
    }
  },
  methods: {
    showLogs(namespace, podname) {
      this.dialogLogs = {
        enable: true,
        podname,
        namespace,
      };
      writeDialogRoute(this.$router, this.$route, "logs", podname, namespace);
    },
    onCloseLogs() {
      this.dialogLogs = {
        enable: false,
        podname: "",
        namespace: "",
      };
      clearDialogRoute(this.$router, this.$route);
    },
  },
};
</script>

<style scoped>
.event-message {
  white-space: normal;
  word-break: break-word;
  max-width: 32rem;
}
.events-truncated {
  font-size: 0.85em;
  opacity: 0.6;
  margin: 0.5rem 0 0 0;
}
</style>
