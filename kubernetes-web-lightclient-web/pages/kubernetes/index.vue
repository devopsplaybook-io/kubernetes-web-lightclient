<template>
  <div id="object-layout">
    <div id="object-header">
      <h3>Pods</h3>
    </div>
    <div id="sources-actions" class="actions"></div>
    <div id="object-list">
      <table>
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Pod</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="pod of kubernetesPodStore.data" v-bind:key="pod.metadata.uid">
            <td>{{ pod.metadata.namespace }}</td>
            <td>{{ pod.metadata.name }}</td>
            <td>{{ pod.status.phase }}</td>
            <td>
              <i class="bi bi-x-circle-fill" v-on:click="podDelete(pod.metadata.namespace, pod.metadata.name)"></i>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
const kubernetesPodStore = KubernetesPodStore();
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
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
      return;
    }
    KubernetesPodStore().get();
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
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped></style>
