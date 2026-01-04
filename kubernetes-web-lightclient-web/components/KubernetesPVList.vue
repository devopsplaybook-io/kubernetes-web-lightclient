<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>PV</th>
          <th>Capacity</th>
          <th>Access Modes</th>
          <th>Reclaim Policy</th>
          <th>Status</th>
          <th>Claim</th>
          <th>Age</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.pvs"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.spec.capacity?.storage || "N/A" }}</td>
          <td>{{ kubeObject.spec.accessModes?.join(", ") || "N/A" }}</td>
          <td>{{ kubeObject.spec.persistentVolumeReclaimPolicy || "N/A" }}</td>
          <td>{{ kubeObject.status?.phase || "Unknown" }}</td>
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
        </tr>
      </tbody>
    </table>
    <DialogDetails
      v-if="dialogDetails.enable"
      :text="dialogDetails.text"
      :title="dialogDetails.title"
      @onClose="onCloseDetails()"
    />
  </div>
</template>

<script setup>
import { UtilsRelativeTime } from "~~/services/Utils";
const kubernetesObjectStore = KubernetesObjectStore();
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
    };
  },
  async created() {
    KubernetesObjectStore().getPVs();
  },
  methods: {
    formatClaim(claimRef) {
      if (!claimRef) return "N/A";
      return `${claimRef.namespace}/${claimRef.name}`;
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        title: "",
        text: "",
      };
    },
    async showDetails(objectName) {
      this.dialogDetails = {
        enable: true,
        title: "Details",
        text: "",
      };
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            object: "pv",
            command: "describe",
            argument: objectName,
            noJson: true,
          },
          await AuthService.getAuthHeader()
        )
        .then(async (res) => {
          this.dialogDetails.text = await UtilsDecompressData(res.data.result);
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped></style>
