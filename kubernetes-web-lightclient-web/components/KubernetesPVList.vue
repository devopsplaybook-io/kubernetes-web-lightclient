<template>
  <div>
    <ListTriageToolbar
      :filters="availableFilters"
      :active="activeFilters"
      @toggle="toggleFilter"
      @clear="clearAll"
    />
    <table class="striped">
      <thead>
        <tr>
          <th
            class="sortable"
            :aria-sort="ariaSort('name')"
            v-on:click="onSortToggle('name')"
          >PV {{ sortArrow("name") }}</th>
          <th>Capacity</th>
          <th>Access Modes</th>
          <th>Reclaim Policy</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('status')"
            v-on:click="onSortToggle('status')"
          >Status {{ sortArrow("status") }}</th>
          <th>Claim</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('age')"
            v-on:click="onSortToggle('age')"
          >Age {{ sortArrow("age") }}</th>
          <th>Details</th>
          <th v-if="deletable">Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of visibleItems"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.spec.capacity?.storage || "N/A" }}</td>
          <td>{{ kubeObject.spec.accessModes?.join(", ") || "N/A" }}</td>
          <td>{{ kubeObject.spec.persistentVolumeReclaimPolicy || "N/A" }}</td>
          <td :class="pvStatusClass(kubeObject.status?.phase)">
            {{ kubeObject.status?.phase || "Unknown" }}
          </td>
          <td>{{ formatClaim(kubeObject.spec.claimRef) }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td>
            <i
              class="bi bi-eye-fill"
              v-on:click="showDetails(kubeObject.metadata.name)"
            ></i>
          </td>
          <td v-if="deletable">
            <i
              class="bi bi-x-circle-fill"
              v-on:click="confirmDelete(kubeObject)"
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
    <DialogConfirm
      v-if="dialogConfirmDelete.enable"
      :title="dialogConfirmDelete.title"
      :message="dialogConfirmDelete.message"
      @onConfirm="onConfirmDelete()"
      @onCancel="onCancelDelete()"
    />
  </div>
</template>

<script setup>
import { UtilsRelativeTime } from "~~/services/Utils";
import { useListTriage } from "~~/composables/useListTriage";
import ListTriageToolbar from "~~/components/ListTriageToolbar.vue";
const kubernetesObjectStore = KubernetesObjectStore();

// Local predicate next to the existing status helper: a PV "has warnings"
// when it reached the Failed phase
function pvHasWarnings(pv) {
  return pv.status?.phase === "Failed";
}

const { visibleItems, onSortToggle, availableFilters, activeFilters, toggleFilter, clearAll, sortArrow, ariaSort } = useListTriage("pv", {
  rawItems: () => kubernetesObjectStore.data.pvs,
  accessors: {
    name: (pv) => pv.metadata.name || "",
    status: (pv) => pv.status?.phase || "Unknown",
    age: (pv) => pv.metadata.creationTimestamp || "",
  },
  filterDefs: [
    {
      id: "has-warnings",
      label: "Has warnings",
      predicate: pvHasWarnings,
    },
  ],
});
</script>

<script>
import { AuthService } from "~~/services/AuthService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import { staleAwareHandler } from "~~/services/KubernetesUtils";
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
      dialogConfirmDelete: {
        enable: false,
        title: "",
        message: "",
        pendingDelete: null,
      },
      dialogDetails: {
        enable: false,
        objectType: "",
        namespace: "",
        objectName: "",
      },
    };
  },
  async created() {
    KubernetesObjectStore().getPvs();
    const dialogRoute = readDialogRoute(this.$route?.query);
    if (dialogRoute && dialogRoute.kind === "details") {
      this.showDetails(dialogRoute.name);
    }
  },
  methods: {
    confirmDelete(kubeObject) {
      this.dialogConfirmDelete = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete pv ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirmDelete.pendingDelete;
      this.dialogConfirmDelete.enable = false;
      const payload = {
        object: "pv",
        command: "delete",
        argument: kubeObject.metadata.name,
        noJson: true,
      };
      if (kubeObject.metadata.namespace) {
        payload.namespace = kubeObject.metadata.namespace;
      }
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          payload,
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: `${kubeObject.metadata.name} deleted`,
          });
          EventBus.emit(EventTypes.OBJECT_CHANGED, "pv");
        })
        .catch(staleAwareHandler("pv"));
    },
    onCancelDelete() {
      this.dialogConfirmDelete.enable = false;
    },
    pvStatusClass(phase) {
      if (!phase) return "status-neutral";
      const p = phase.toLowerCase();
      if (p === "bound") return "status-ok";
      if (p === "available") return "status-warning";
      if (p === "released" || p === "failed") return "status-error";
      return "status-neutral";
    },
    formatClaim(claimRef) {
      if (!claimRef) return "N/A";
      return `${claimRef.namespace}/${claimRef.name}`;
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        objectType: "",
        namespace: "",
        objectName: "",
      };
      clearDialogRoute(this.$router, this.$route);
    },
    async showDetails(objectName) {
      this.dialogDetails = {
        enable: true,
        objectType: "pv",
        namespace: "",
        objectName,
      };
      writeDialogRoute(this.$router, this.$route, "details", objectName);
    },
  },
};
</script>
