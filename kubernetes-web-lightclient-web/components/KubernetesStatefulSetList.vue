<template>
  <div>
    <table
      class="striped"
      v-if="kubernetesObjectStore.data.statefulsets.length > 0"
    >
      <thead>
        <tr>
          <th>Namespace</th>
          <th>StatefulSet</th>
          <th>Age</th>
          <th>Ready</th>
          <th>Details</th>
          <th>Restart</th>
          <th v-if="deletable">Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.statefulsets"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td>
            {{ kubeObject.status.readyReplicas }}/{{
              kubeObject.status.replicas
            }}
          </td>
          <td>
            <i
              class="bi bi-eye-fill"
              v-on:click="
                showDetails(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name,
                )
              "
            ></i>
          </td>
          <td>
            <i
              class="bi bi-arrow-clockwise"
              v-on:click="
                statefulsetRestart(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name,
                )
              "
            ></i>
          </td>
          <td v-if="deletable">
            <i
              class="bi bi-x-circle-fill"
              v-on:click="confirmDelete(kubeObject)"
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
    <DialogConfirm
      v-if="dialogConfirm.enable"
      :title="dialogConfirm.title"
      :message="dialogConfirm.message"
      @onConfirm="onConfirmRestart()"
      @onCancel="onCancelRestart()"
    />
    <DialogConfirm
      v-if="dialogConfirmDelete.enable"
      :title="dialogConfirmDelete.title"
      :message="dialogConfirmDelete.message"
      @onConfirm="onConfirmDelete()"
      @onCancel="onCancelDelete()"
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
  props: {
    deletable: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      dialogConfirmDelete: {
        enable: false,
        title: "",
        message: "",
        pendingDelete: null,
      },
      dialogDetails: {
        enable: false,
        title: "",
        text: "",
      },
      dialogConfirm: {
        enable: false,
        title: "",
        message: "",
        pendingRestart: null,
      },
    };
  },
  async created() {
    KubernetesObjectStore().getStatefulSets();
  },
  methods: {
    confirmDelete(kubeObject) {
      this.dialogConfirmDelete = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete statefulset ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirmDelete.pendingDelete;
      this.dialogConfirmDelete.enable = false;
      const payload = {
        object: "statefulset",
        command: "delete",
        argument: kubeObject.metadata.name,
        noJson: true,
      };
      if (kubeObject.metadata.namespace) {
        payload.namespace = kubeObject.metadata.namespace;
      }
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          payload,
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: `${kubeObject.metadata.name} deleted`,
          });
          EventBus.emit(EventTypes.OBJECT_CHANGED, "statefulset");
        })
        .catch(handleError);
    },
    onCancelDelete() {
      this.dialogConfirmDelete.enable = false;
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
            object: "statefulset",
            command: "describe",
            argument: objectName,
            noJson: true,
          },
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.dialogDetails.text = await UtilsDecompressData(res.data.result);
        })
        .catch(handleError);
    },
    async statefulsetRestart(namespace, statefulsetName) {
      this.dialogConfirm = {
        enable: true,
        title: "Confirm Restart",
        message: `Perform a rollout restart of statefulset ${statefulsetName} (${namespace})?`,
        pendingRestart: { namespace, statefulsetName },
      };
    },
    async onConfirmRestart() {
      const { namespace, statefulsetName } = this.dialogConfirm.pendingRestart;
      this.dialogConfirm.enable = false;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace,
            object: "statefulset",
            command: "rollout restart",
            argument: statefulsetName,
            noJson: true,
          },
          await AuthService.getAuthHeader(),
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Rollout Restart Started",
          });
          EventBus.emit(EventTypes.OBJECT_CHANGED, "statefulset");
        })
        .catch(handleError);
    },
    onCancelRestart() {
      this.dialogConfirm.enable = false;
    },
  },
};
</script>
