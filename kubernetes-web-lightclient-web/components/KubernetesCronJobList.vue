<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Namespace</th>
          <th>CronJob</th>
          <th>Schedule</th>
          <th>Suspend</th>
          <th>Active</th>
          <th>Age</th>
          <th>Details</th>
          <th>Trigger</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of filteredCronJobs"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.spec.schedule }}</td>
          <td>{{ kubeObject.spec.suspend || false }}</td>
          <td>{{ kubeObject.status?.active?.length || 0 }}</td>
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
          <td>
            <i
              class="bi bi-play-circle-fill"
              v-on:click="
                triggerCronJob(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name
                )
              "
              title="Trigger CronJob"
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
    KubernetesObjectStore().getCronJobs();
  },
  computed: {
    filteredCronJobs() {
      const cronjobs = this.kubernetesObjectStore.data.cronjobs || [];
      if (this.namespaceStore.selectedNamespace === "all") {
        return cronjobs;
      }
      return cronjobs.filter(
        (cronjob) =>
          cronjob.metadata.namespace === this.namespaceStore.selectedNamespace
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
            object: "cronjob",
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
    async triggerCronJob(namespace, objectName) {
      const jobName = `${objectName}-manual-${Date.now()}`;
      if (!confirm(`Trigger CronJob "${objectName}" as job "${jobName}"?`)) {
        return;
      }
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace,
            object: "job",
            command: "create",
            argument: `--from=cronjob/${objectName} ${jobName}`,
            noJson: true,
          },
          await AuthService.getAuthHeader()
        )
        .then(async (res) => {
          alert(
            `Job "${jobName}" created successfully from CronJob "${objectName}"`
          );
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped></style>
