<template>
  <div>
    <h3>Secrets</h3>
    <table>
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Secret</th>
          <th>Age</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kubeObject of kubernetesObjectStore.data.secrets" v-bind:key="kubeObject.metadata.uid">
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
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
    KubernetesObjectStore().getSecrets();
    setInterval(() => {
      0;
      KubernetesObjectStore().getSecrets();
    }, 1000);
  },
  methods: {},
};
</script>

<style scoped></style>
