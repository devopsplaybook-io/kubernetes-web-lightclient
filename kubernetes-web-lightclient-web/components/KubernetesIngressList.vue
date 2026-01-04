<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Ingress</th>
          <th>Class</th>
          <th>Hosts</th>
          <th>Address</th>
          <th>Age</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.ingresses"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.spec?.ingressClassName || "N/A" }}</td>
          <td>{{ formatHosts(kubeObject.spec?.rules) }}</td>
          <td>{{ formatAddress(kubeObject.status?.loadBalancer?.ingress) }}</td>
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
    KubernetesObjectStore().getIngresses();
  },
  methods: {
    formatHosts(rules) {
      if (!rules || !Array.isArray(rules)) return "N/A";
      const hosts = rules.map((rule) => rule.host).filter(Boolean);
      return hosts.length > 0 ? hosts.join(", ") : "*";
    },
    formatAddress(ingress) {
      if (!ingress || !Array.isArray(ingress)) return "N/A";
      const addresses = ingress
        .map((ing) => ing.ip || ing.hostname)
        .filter(Boolean);
      return addresses.length > 0 ? addresses.join(", ") : "N/A";
    },
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
            object: "ingress",
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
