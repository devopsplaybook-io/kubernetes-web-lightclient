<template>
  <div>
    <h3>PVCs</h3>
    <table>
      <thead>
        <tr>
          <th>Namespace</th>
          <th>PVC</th>
          <th>Age</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kubeObject of kubernetesObjectStore.data.pvcs" v-bind:key="kubeObject.metadata.uid">
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
    KubernetesObjectStore().getPVCs();
    setInterval(() => {
      KubernetesObjectStore().getPVCs();
    }, 10000);
  },
  methods: {},
};
</script>

<style scoped></style>
