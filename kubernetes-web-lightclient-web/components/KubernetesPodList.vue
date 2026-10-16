<template>
  <div>
    <ListTriageToolbar
      :filters="availableFilters"
      :active="activeFilters"
      @toggle="toggleFilter"
      @clear="clearAll"
    />
    <table class="striped table-cards" v-if="kubernetesObjectStore.data.pods.length > 0">
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
          v-for="kubeObject of visibleItems"
          v-bind:key="kubeObject.metadata.uid || kubeObject.metadata.name"
        >
          <td data-label="Namespace">{{ kubeObject.metadata.namespace }}</td>
          <td data-label="Pod" class="cell-name">{{ kubeObject.metadata.name }}</td>
          <td
            data-label="Status"
            :class="podStatusClass(getPodStatus(kubeObject))"
          >
            {{ getPodStatus(kubeObject) }}
          </td>
          <td data-label="Age">
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td data-label="Ready">
            {{ getPodReadyCount(kubeObject).ready }}/{{
              getPodReadyCount(kubeObject).total
            }}
          </td>
          <td data-label="Restarts">
            {{ getPodRestartCount(kubeObject) }}
            ({{
              getPodLastRestartAt(kubeObject)
                ? UtilsRelativeTime(getPodLastRestartAt(kubeObject))
                : "-"
            }})
          </td>
          <td data-label="Details">
            <i
              class="bi bi-eye-fill"
              v-on:click="
                showDetails(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name,
                )
              "
            ></i>
          </td>
          <td data-label="Logs">
            <i
              class="bi bi-file-text-fill"
              v-on:click="
                showLogs(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name,
                )
              "
            ></i>
          </td>
          <td v-if="deletable" data-label="Delete">
            <i
              class="bi bi-x-circle-fill"
              v-on:click="
                podDelete(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name,
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
import { UtilsRelativeTime } from "~~/services/Utils";
import {
  getPodLastRestartAt,
  getPodReadyCount,
  getPodRestartCount,
  getPodStatus,
  podStatusClass,
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
      status: (pod) => getPodStatus(pod),
      age: (pod) => pod.metadata.creationTimestamp || "",
      ready: (pod) => {
        const counts = getPodReadyCount(pod);
        return counts.total === 0 ? -1 : counts.ready / counts.total;
      },
      restarts: (pod) => getPodRestartCount(pod),
    },
    filterDefs: createPodFilters(),
    defaultSortDirections: { restarts: "desc" },
  },
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

<style scoped>
.cell-name {
  word-break: break-all;
}
</style>
