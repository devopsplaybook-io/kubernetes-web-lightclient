<template>
  <div>
    <ListTriageToolbar
      :filters="availableFilters"
      :active="activeFilters"
      @toggle="toggleFilter"
      @clear="clearAll"
    />
    <table class="striped" v-if="kubernetesObjectStore.data.pods.length > 0">
      <thead>
        <tr>
          <th
            class="sortable"
            :aria-sort="ariaSort('namespace')"
            v-on:click="onSortToggle('namespace')"
          >Namespace {{ sortArrow("namespace") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('name')"
            v-on:click="onSortToggle('name')"
          >Pod {{ sortArrow("name") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('status')"
            v-on:click="onSortToggle('status')"
          >Status {{ sortArrow("status") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('age')"
            v-on:click="onSortToggle('age')"
          >Age {{ sortArrow("age") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('ready')"
            v-on:click="onSortToggle('ready')"
          >Ready {{ sortArrow("ready") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('restarts')"
            v-on:click="onSortToggle('restarts')"
          >Restarts {{ sortArrow("restarts") }}</th>
          <th>Details</th>
          <th>Logs</th>
          <th v-if="deletable">Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row of podRows"
          v-bind:key="row.pod.metadata.uid || row.pod.metadata.name"
        >
          <td>{{ row.pod.metadata.namespace }}</td>
          <td>{{ row.pod.metadata.name }}</td>
          <td :class="row.statusClass">{{ row.status }}</td>
          <td>
            {{ UtilsRelativeTime(row.pod.metadata.creationTimestamp) }}
          </td>
          <td>{{ row.ready }}/{{ row.total }}</td>
          <td>
            {{ row.restartCount }}
            ({{
              row.lastRestartAt ? UtilsRelativeTime(row.lastRestartAt) : "-"
            }})
          </td>
          <td>
            <i
              class="bi bi-eye-fill"
              v-on:click="
                showDetails(
                  row.pod.metadata.namespace,
                  row.pod.metadata.name,
                )
              "
            ></i>
          </td>
          <td>
            <i
              class="bi bi-file-text-fill"
              v-on:click="
                showLogs(
                  row.pod.metadata.namespace,
                  row.pod.metadata.name,
                )
              "
            ></i>
          </td>
          <td v-if="deletable">
            <i
              class="bi bi-x-circle-fill"
              v-on:click="
                podDelete(
                  row.pod.metadata.namespace,
                  row.pod.metadata.name,
                )
              "
            ></i>
          </td>
        </tr>
      </tbody>
    </table>
    <DialogDetails
      v-if="dialogDetails.enable"
      :object-type="dialogDetails.objectType"
      :object-name="dialogDetails.objectName"
      :namespace="dialogDetails.namespace"
      @onClose="onCloseDetails()"
    />
    <DialogLogs
      v-if="dialogLogs.enable"
      :podname="dialogLogs.podname"
      :namespace="dialogLogs.namespace"
      :title="dialogLogs.title"
      @onClose="onCloseDetails()"
    />
    <DialogConfirm
      v-if="dialogConfirm.enable"
      :title="dialogConfirm.title"
      :message="dialogConfirm.message"
      @onConfirm="onConfirmDelete()"
      @onCancel="onCancelDelete()"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { UtilsRelativeTime } from "~~/services/Utils";
import {
  getPodDisplayRow,
  staleAwareHandler,
} from "~~/services/KubernetesUtils";
import { createPodFilters } from "~~/services/ListTriage";
import { useListTriage } from "~~/composables/useListTriage";
import ListTriageToolbar from "~~/components/ListTriageToolbar.vue";
const kubernetesObjectStore = KubernetesObjectStore();
const namespaceStore = NamespaceStore();

const { visibleItems, onSortToggle, availableFilters, activeFilters, toggleFilter, clearAll, sortArrow, ariaSort } = useListTriage(
  "pod",
  {
    rawItems: () => kubernetesObjectStore.data.pods,
    accessors: {
      namespace: (pod) => pod.metadata.namespace || "",
      name: (pod) => pod.metadata.name || "",
      status: (pod) => getPodDisplayRow(pod).status,
      age: (pod) => pod.metadata.creationTimestamp || "",
      ready: (pod) => getPodDisplayRow(pod).readyRatio,
      restarts: (pod) => getPodDisplayRow(pod).restartCount,
    },
    filterDefs: createPodFilters(),
    defaultSortDirections: { restarts: "desc" },
  },
);

const podRows = computed(() =>
  visibleItems.value.map((pod) => getPodDisplayRow(pod)),
);
</script>

<script>
import { AuthService } from "~~/services/AuthService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import {
  clearDialogRoute,
  readDialogRoute,
  writeDialogRoute,
} from "~~/services/DialogDeepLink";
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  props: {
    deletable: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      dialogDetails: {
        enable: false,
        objectType: "",
        namespace: "",
        objectName: "",
      },
      dialogLogs: {
        enable: false,
        podname: "",
        namespace: "",
      },
      dialogConfirm: {
        enable: false,
        title: "",
        message: "",
        pendingDelete: null,
      },
    };
  },
  async created() {
    KubernetesObjectStore().getPods();
    const dialogRoute = readDialogRoute(this.$route?.query);
    if (dialogRoute) {
      if (dialogRoute.kind === "details") {
        this.showDetails(dialogRoute.namespace, dialogRoute.name);
      } else {
        this.showLogs(dialogRoute.namespace, dialogRoute.name);
      }
    }
  },
  methods: {
    async podDelete(namespace, podname) {
      this.dialogConfirm = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete pod ${podname} (${namespace})?`,
        pendingDelete: { namespace, podname },
      };
    },
    async onConfirmDelete() {
      const { namespace, podname } = this.dialogConfirm.pendingDelete;
      this.dialogConfirm.enable = false;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace,
            object: "pod",
            command: "delete",
            argument: podname,
            noJson: true,
          },
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Pod Deleted",
          });
          EventBus.emit(EventTypes.OBJECT_CHANGED, "pod");
        })
        .catch(staleAwareHandler("pod"));
    },
    onCancelDelete() {
      this.dialogConfirm.enable = false;
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        objectType: "",
        namespace: "",
        objectName: "",
      };
      this.dialogLogs = {
        enable: false,
        podname: "",
        namespace: "",
      };
      clearDialogRoute(this.$router, this.$route);
    },
    async showDetails(namespace, objectName) {
      this.dialogDetails = {
        enable: true,
        objectType: "pod",
        namespace,
        objectName,
      };
      writeDialogRoute(this.$router, this.$route, "details", objectName, namespace);
    },
    async showLogs(namespace, podname) {
      this.dialogLogs = {
        enable: true,
        podname,
        namespace,
      };
      writeDialogRoute(this.$router, this.$route, "logs", podname, namespace);
    },
  },
};
</script>

