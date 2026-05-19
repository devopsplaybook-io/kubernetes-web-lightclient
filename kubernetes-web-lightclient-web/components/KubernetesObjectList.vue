<template>
  <div>
    <table class="striped" v-if="items.length > 0">
      <thead>
        <tr>
          <th v-if="isNamespaced">Namespace</th>
          <th>Name</th>
          <th>Age</th>
          <th v-if="objectType === 'pod'">Status</th>
          <th>Details</th>
          <th v-if="objectType === 'pod'">Logs</th>
          <th>Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kubeObject of items" v-bind:key="kubeObject.metadata.uid || kubeObject.metadata.name">
          <td v-if="isNamespaced">{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}</td>
          <td v-if="objectType === 'pod'" :class="podStatusClass(getPodStatus(kubeObject))">
            {{ getPodStatus(kubeObject) }}
          </td>
          <td>
            <i class="bi bi-eye-fill" v-on:click="showDetails(kubeObject)"></i>
          </td>
          <td v-if="objectType === 'pod'">
            <i class="bi bi-file-text-fill" v-on:click="showLogs(kubeObject)"></i>
          </td>
          <td>
            <i class="bi bi-x-circle-fill" v-on:click="confirmDelete(kubeObject)"></i>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else-if="!kubernetesObjectStore.loading && kubernetesObjectStore.hasEverLoaded" class="empty-state">
      No {{ objectType }} found.
    </div>
    <DialogDetails
      v-if="dialogDetails.enable"
      :text="dialogDetails.text"
      :title="dialogDetails.title"
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
const kubernetesObjectStore = KubernetesObjectStore();

const props = defineProps({
  objectType: { type: String, required: true },
  isNamespaced: { type: Boolean, default: true },
});
</script>

<script>
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UtilsDecompressData } from "~/services/Utils";
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  data() {
    return {
      dialogDetails: {
        enable: false,
        title: "",
        text: "",
      },
      dialogLogs: {
        enable: false,
        podname: "",
        namespace: "",
        title: "",
      },
      dialogConfirm: {
        enable: false,
        title: "",
        message: "",
        pendingDelete: null,
      },
    };
  },
  computed: {
    items() {
      return kubernetesObjectStore.data[this.objectType] || [];
    },
  },
  watch: {
    objectType(newType) {
      this.fetchData(newType);
    },
  },
  async created() {
    this.fetchData(this.objectType);
  },
  methods: {
    fetchData(type) {
      const kubectlObject = type;
      const isClusterScoped = !this.isNamespaced;
      kubernetesObjectStore.getObject(type, {
        object: kubectlObject,
        command: "get",
        argument: isClusterScoped ? "" : "-A",
      });
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        title: "",
        text: "",
      };
      this.dialogLogs = {
        enable: false,
        podname: "",
        namespace: "",
        title: "",
      };
    },
    async showDetails(kubeObject) {
      this.dialogDetails = {
        enable: true,
        title: `Details: ${kubeObject.metadata.name}`,
        text: "",
      };
      const namespace = kubeObject.metadata.namespace;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace: namespace || undefined,
            object: this.objectType,
            command: "describe",
            argument: kubeObject.metadata.name,
            noJson: true,
          },
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.dialogDetails.text = await UtilsDecompressData(res.data.result);
        })
        .catch(handleError);
    },
    async showLogs(kubeObject) {
      this.dialogLogs = {
        enable: true,
        podname: kubeObject.metadata.name,
        namespace: kubeObject.metadata.namespace,
        title: `Logs: ${kubeObject.metadata.name}`,
      };
    },
    confirmDelete(kubeObject) {
      this.dialogConfirm = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete ${this.objectType} ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirm.pendingDelete;
      this.dialogConfirm.enable = false;
      const namespace = kubeObject.metadata.namespace;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace: namespace || undefined,
            object: this.objectType,
            command: "delete",
            argument: kubeObject.metadata.name,
            noJson: true,
          },
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: `${this.objectType} ${kubeObject.metadata.name} deleted`,
          });
          setTimeout(() => {
            this.fetchData(this.objectType);
          }, 1000);
        })
        .catch(handleError);
    },
    onCancelDelete() {
      this.dialogConfirm.enable = false;
    },
    getPodStatus(pod) {
      const phase = pod.status?.phase || "Unknown";
      if (pod.metadata?.deletionTimestamp) return "Terminating";
      const initStatuses = pod.status?.initContainerStatuses || [];
      for (const cs of initStatuses) {
        if (cs.state?.waiting?.reason) return `Init:${cs.state.waiting.reason}`;
        if (cs.state?.terminated?.reason && cs.state.terminated.reason !== "Completed") {
          return `Init:${cs.state.terminated.reason}`;
        }
      }
      const containerStatuses = pod.status?.containerStatuses || [];
      for (const cs of containerStatuses) {
        if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
        if (cs.state?.terminated?.reason) return cs.state.terminated.reason;
      }
      return phase;
    },
    podStatusClass(status) {
      if (!status) return "status-neutral";
      const s = status.toLowerCase();
      if (s === "running" || s === "succeeded" || s === "completed") return "status-ok";
      if (s === "pending" || s === "containercreating" || s === "podscheduled" || s === "terminating" || s.startsWith("init:")) return "status-warning";
      if (s === "failed" || s === "unknown" || s === "crashloopbackoff" || s === "imagepullbackoff" || s === "errimagepull" || s === "oomkilled" || s === "error" || s === "evicted" || s === "startuperror" || s === "createcontainerconfigerror" || s === "invalidimagename") return "status-error";
      return "status-neutral";
    },
  },
};
</script>

<style scoped>
.empty-state {
  text-align: center;
  padding: 2em;
  opacity: 0.6;
}
</style>
