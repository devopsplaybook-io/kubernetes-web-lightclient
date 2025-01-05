<template>
  <div>
    <h3>Pods</h3>
    <table>
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Pod</th>
          <th>Status</th>
          <th>Age</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kubeObject of kubernetesObjectStore.data.pods" v-bind:key="kubeObject.metadata.uuid">
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.status.phase }}</td>
          <td>{{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}</td>
          <td>
            <i
              class="bi bi-x-circle-fill"
              v-on:click="podDelete(kubeObject.metadata.namespace, kubeObject.metadata.name)"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { UtilsRelativeTime } from "~~/services/Utils";
const kubernetesObjectStore = KubernetesObjectStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {};
  },
  async created() {
    KubernetesObjectStore().getPods();
    setInterval(() => {
      KubernetesObjectStore().getPods();
    }, 10000);
  },
  methods: {
    async podDelete(namespace, podname) {
      if (!confirm(`Delete pod ${podname} (${namespace})`)) {
        return;
      }
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          { namespace, object: "pods", command: "delete", argument: podname, noOutput: true },
          await AuthService.getAuthHeader()
        )
        .then((res) => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Pod Deleted",
          });
          KubernetesObjectStore().getPods();
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped></style>
