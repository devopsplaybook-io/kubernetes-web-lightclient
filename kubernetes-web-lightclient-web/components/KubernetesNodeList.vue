<template>
  <div>
    <h3>Nodes</h3>
    <table>
      <thead>
        <tr>
          <th>Node</th>
          <th>Version</th>
          <th>Age</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kubeObject of kubernetesObjectStore.data.nodes" v-bind:key="kubeObject.metadata.uid">
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.status.nodeInfo.kubeletVersion }}</td>
          <td>{{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}</td>
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
export default {
  data() {
    return {};
  },
  async created() {
    KubernetesObjectStore().getNodes();
    setInterval(() => {
      KubernetesObjectStore().getNodes();
    }, 10000);
  },
  methods: {},
};
</script>

<style scoped></style>
