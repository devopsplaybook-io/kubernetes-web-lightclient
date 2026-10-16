<template>
  <div>
    <label class="events-warnings-only">
      <input type="checkbox" v-model="warningsOnly" />
      Warnings only
    </label>
    <table class="striped" v-if="visibleEvents.length > 0">
      <thead>
        <tr>
          <th>Type</th>
          <th>Reason</th>
          <th>Message</th>
          <th>Involved Object</th>
          <th>Count</th>
          <th>Age</th>
          <th>Logs</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="event of visibleEvents"
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
      Showing latest {{ maxEvents }} of {{ sortedEvents.length }} events
    </p>
    <DialogLogs
      v-if="dialogLogs.enable"
      :podname="dialogLogs.podname"
      :namespace="dialogLogs.namespace"
      @onClose="onCloseLogs()"
    />
  </div>
</template>

<script>
import { UtilsRelativeTime } from "~~/services/Utils";
import { PreferencesService } from "~~/services/PreferencesService";
import {
  clearDialogRoute,
  readDialogRoute,
  writeDialogRoute,
} from "~~/services/DialogDeepLink";

export default {
  data() {
    return {
      warningsOnly: PreferencesService.getStoredBoolean(
        PreferencesService.EVENTS_WARNINGS_ONLY,
        true,
      ),
      maxEvents: 200,
      dialogLogs: {
        enable: false,
        podname: "",
        namespace: "",
      },
    };
  },
  computed: {
    sortedEvents() {
      const events = KubernetesObjectStore().data.events || [];
      const withSortKey = events.map((event) => ({
        event,
        sortKey: this.eventTime(event) || "",
      }));
      withSortKey.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
      return withSortKey.map((entry) => entry.event);
    },
    warningEvents() {
      return this.sortedEvents.filter((event) => event.type === "Warning");
    },
    visibleEvents() {
      const source = this.warningsOnly ? this.warningEvents : this.sortedEvents;
      return source.slice(0, this.maxEvents);
    },
    isTruncated() {
      const source = this.warningsOnly ? this.warningEvents : this.sortedEvents;
      return source.length > this.maxEvents;
    },
  },
  watch: {
    warningsOnly(value) {
      PreferencesService.storeBoolean(
        PreferencesService.EVENTS_WARNINGS_ONLY,
        value,
      );
    },
  },
  async created() {
    KubernetesObjectStore().getEvents();
    const dialogRoute = readDialogRoute(this.$route?.query);
    if (dialogRoute && dialogRoute.kind === "logs") {
      this.showLogs(dialogRoute.namespace, dialogRoute.name);
    }
  },
  methods: {
    eventAge(event) {
      return UtilsRelativeTime(this.eventTime(event));
    },
    eventTime(event) {
      return (
        event.lastTimestamp ||
        event.eventTime ||
        event.firstTimestamp ||
        event.metadata?.creationTimestamp ||
        ""
      );
    },
    eventKey(event) {
      return (
        event.metadata?.uid ||
        `${event.involvedObject?.namespace || ""}/${event.involvedObject?.name || ""}/${event.reason}/${this.eventTime(event)}`
      );
    },
    involvedObjectLabel(event) {
      const involved = event.involvedObject || {};
      return `${involved.kind || ""} ${involved.name || ""}`.trim();
    },
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
.events-warnings-only {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.5rem 0;
}
.events-warnings-only input[type="checkbox"] {
  margin: 0;
}
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
