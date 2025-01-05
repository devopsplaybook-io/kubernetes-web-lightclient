<template>
  <div>
    <h3>Deployemts</h3>
    <table>
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Deployemt</th>
          <th>Ready</th>
          <th>Age</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kubeObject of kubernetesObjectStore.data.deployments" v-bind:key="kubeObject.metadata.uid">
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.status.readyReplicas }}/{{ kubeObject.status.replicas }}</td>
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
    KubernetesObjectStore().getDeployments();
    setInterval(() => {
      KubernetesObjectStore().getDeployments();
    }, 10000);
  },
  methods: {},
};
</script>

<style scoped></style>
