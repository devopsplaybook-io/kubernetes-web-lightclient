<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Age</th>
          <th>Details</th>
          <th v-if="deletable">Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.namespaces"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.name }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td>
            <i
              class="bi bi-eye-fill"
              v-on:click="showDetails(kubeObject.metadata.name)"
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
    };
  },
  async created() {
    KubernetesObjectStore().getNamespaces();
  },
  methods: {
    confirmDelete(kubeObject) {
      this.dialogConfirmDelete = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete namespace ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirmDelete.pendingDelete;
      this.dialogConfirmDelete.enable = false;
      const payload = {
        object: "namespace",
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
          EventBus.emit(EventTypes.OBJECT_CHANGED, "namespace");
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
            object: "namespace",
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
  },
};
</script>
