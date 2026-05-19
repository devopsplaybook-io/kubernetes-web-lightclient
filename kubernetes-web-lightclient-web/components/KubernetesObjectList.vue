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
        <tr
          v-for="kubeObject of items"
          v-bind:key="kubeObject.metadata.uid || kubeObject.metadata.name"
        >
          <td v-if="isNamespaced">{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td
            v-if="objectType === 'pod'"
            :class="podStatusClass(getPodStatus(kubeObject))"
          >
            {{ getPodStatus(kubeObject) }}
          </td>
          <td>
            <i class="bi bi-eye-fill" v-on:click="showDetails(kubeObject)"></i>
          </td>
          <td v-if="objectType === 'pod'">
            <i
              class="bi bi-file-text-fill"
              v-on:click="showLogs(kubeObject)"
            ></i>
          </td>
          <td>
            <i
              class="bi bi-x-circle-fill"
              v-on:click="confirmDelete(kubeObject)"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>
    <div
      v-else-if="
        !kubernetesObjectStore.loading && kubernetesObjectStore.hasEverLoaded
      "
      class="empty-state"
    >
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
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UtilsDecompressData } from "~/services/Utils";
import axios from "axios";
import Config from "~~/services/Config.ts";
import { ref, computed, watch, onMounted } from "vue";

const kubernetesObjectStore = KubernetesObjectStore();

const props = defineProps({
  objectType: { type: String, required: true },
  isNamespaced: { type: Boolean, default: true },
});

const dialogDetails = ref({ enable: false, title: "", text: "" });
const dialogLogs = ref({
  enable: false,
  podname: "",
  namespace: "",
  title: "",
});
const dialogConfirm = ref({
  enable: false,
  title: "",
  message: "",
  pendingDelete: null,
});

const items = computed(() => {
  return kubernetesObjectStore.data[props.objectType] || [];
});

watch(
  () => props.objectType,
  (newType) => {
    fetchData(newType);
  },
);

onMounted(() => {
  fetchData(props.objectType);
});

function fetchData(type) {
  const isClusterScoped = !props.isNamespaced;
  kubernetesObjectStore.getObject(type, {
    object: type,
    command: "get",
    argument: isClusterScoped ? "" : "-A",
  });
}

function onCloseDetails() {
  dialogDetails.value = { enable: false, title: "", text: "" };
  dialogLogs.value = { enable: false, podname: "", namespace: "", title: "" };
}

async function showDetails(kubeObject) {
  dialogDetails.value = {
    enable: true,
    title: `Details: ${kubeObject.metadata.name}`,
    text: "",
  };
  const namespace = kubeObject.metadata.namespace;
  try {
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/kubectl/command`,
      {
        namespace: namespace || undefined,
        object: props.objectType,
        command: "describe",
        argument: kubeObject.metadata.name,
        noJson: true,
      },
      await AuthService.getAuthHeader(),
    );
    dialogDetails.value.text = await UtilsDecompressData(res.data.result);
  } catch (error) {
    handleError(error);
  }
}

function showLogs(kubeObject) {
  dialogLogs.value = {
    enable: true,
    podname: kubeObject.metadata.name,
    namespace: kubeObject.metadata.namespace,
    title: `Logs: ${kubeObject.metadata.name}`,
  };
}

function confirmDelete(kubeObject) {
  dialogConfirm.value = {
    enable: true,
    title: "Confirm Delete",
    message: `Delete ${props.objectType} ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
    pendingDelete: kubeObject,
  };
}

async function onConfirmDelete() {
  const kubeObject = dialogConfirm.value.pendingDelete;
  dialogConfirm.value.enable = false;
  const namespace = kubeObject.metadata.namespace;
  try {
    await axios.post(
      `${(await Config.get()).SERVER_URL}/kubectl/command`,
      {
        namespace: namespace || undefined,
        object: props.objectType,
        command: "delete",
        argument: kubeObject.metadata.name,
        noJson: true,
      },
      await AuthService.getAuthHeader(),
    );
    EventBus.emit(EventTypes.ALERT_MESSAGE, {
      type: "info",
      text: `${props.objectType} ${kubeObject.metadata.name} deleted`,
    });
    setTimeout(() => {
      fetchData(props.objectType);
    }, 1000);
  } catch (error) {
    handleError(error);
  }
}

function onCancelDelete() {
  dialogConfirm.value.enable = false;
}

function getPodStatus(pod) {
  const phase = pod.status?.phase || "Unknown";
  if (pod.metadata?.deletionTimestamp) return "Terminating";
  const initStatuses = pod.status?.initContainerStatuses || [];
  for (const cs of initStatuses) {
    if (cs.state?.waiting?.reason) return `Init:${cs.state.waiting.reason}`;
    if (
      cs.state?.terminated?.reason &&
      cs.state.terminated.reason !== "Completed"
    ) {
      return `Init:${cs.state.terminated.reason}`;
    }
  }
  const containerStatuses = pod.status?.containerStatuses || [];
  for (const cs of containerStatuses) {
    if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
    if (cs.state?.terminated?.reason) return cs.state.terminated.reason;
  }
  return phase;
}

function podStatusClass(status) {
  if (!status) return "status-neutral";
  const s = status.toLowerCase();
  if (s === "running" || s === "succeeded" || s === "completed")
    return "status-ok";
  if (
    s === "pending" ||
    s === "containercreating" ||
    s === "podscheduled" ||
    s === "terminating" ||
    s.startsWith("init:")
  )
    return "status-warning";
  if (
    s === "failed" ||
    s === "unknown" ||
    s === "crashloopbackoff" ||
    s === "imagepullbackoff" ||
    s === "errimagepull" ||
    s === "oomkilled" ||
    s === "error" ||
    s === "evicted" ||
    s === "startuperror" ||
    s === "createcontainerconfigerror" ||
    s === "invalidimagename"
  )
    return "status-error";
  return "status-neutral";
}
</script>

<style scoped>
.empty-state {
  text-align: center;
  padding: 2em;
  opacity: 0.6;
}
</style>
