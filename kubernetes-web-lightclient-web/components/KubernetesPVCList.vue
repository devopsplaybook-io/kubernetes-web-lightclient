<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Namespace</th>
          <th>PVC</th>
          <th>Age</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of filteredPVCs"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td>
            <i
              class="bi bi-eye-fill"
              v-on:click="
                showDetails(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name
                )
              "
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
const namespaceStore = NamespaceStore();
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
    KubernetesObjectStore().getPVCs();
  },
  computed: {
    filteredPVCs() {
      const pvcs = this.kubernetesObjectStore.data.pvcs || [];
      if (this.namespaceStore.selectedNamespace === "all") {
        return pvcs;
      }
      return pvcs.filter(
        (pvc) =>
          pvc.metadata.namespace === this.namespaceStore.selectedNamespace
      );
    },
    kubernetesObjectStore() {
      return KubernetesObjectStore();
    },
    namespaceStore() {
      return NamespaceStore();
    },
  },
  methods: {
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        title: "",
        text: "",
      };
    },
    async showDetails(namespace, objectName) {
      this.dialogDetails = {
        enable: true,
        title: "Details",
        text: "",
      };
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace,
            object: "pvc",
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
