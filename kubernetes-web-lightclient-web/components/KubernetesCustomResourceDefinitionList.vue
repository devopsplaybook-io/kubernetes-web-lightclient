<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th
            class="sortable"
            :aria-sort="ariaSort('name')"
            v-on:click="onSortToggle('name')"
          >Name {{ sortArrow("name") }}</th>
          <th>Group</th>
          <th>Version</th>
          <th>Scope</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('age')"
            v-on:click="onSortToggle('age')"
          >Age {{ sortArrow("age") }}</th>
          <th>Details</th>
          <th v-if="deletable">Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of visibleItems"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.spec?.group || "N/A" }}</td>
          <td>{{ formatVersions(kubeObject.spec?.versions) }}</td>
          <td>{{ kubeObject.spec?.scope || "N/A" }}</td>
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
      :object-type="dialogDetails.objectType"
      :object-name="dialogDetails.objectName"
      :namespace="dialogDetails.namespace"
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
import { useListTriage } from "~~/composables/useListTriage";
const kubernetesObjectStore = KubernetesObjectStore();

const { visibleItems, onSortToggle, sortArrow, ariaSort } = useListTriage("customresourcedefinition", {
  rawItems: () => kubernetesObjectStore.data.customResourceDefinitions,
  accessors: {
    name: (kubeObject) => kubeObject.metadata.name || "",
    age: (kubeObject) => kubeObject.metadata.creationTimestamp || "",
  },
});
</script>

<script>
import { AuthService } from "~~/services/AuthService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import { staleAwareHandler } from "~~/services/KubernetesUtils";
import {
  clearDialogRoute,
  readDialogRoute,
  writeDialogRoute,
} from "~~/services/DialogDeepLink";
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
        objectType: "",
        namespace: "",
        objectName: "",
      },
    };
  },
  async created() {
    KubernetesObjectStore().getCustomResourceDefinitions();
    const dialogRoute = readDialogRoute(this.$route?.query);
    if (dialogRoute && dialogRoute.kind === "details") {
      this.showDetails(dialogRoute.name);
    }
  },
  methods: {
    confirmDelete(kubeObject) {
      this.dialogConfirmDelete = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete customresourcedefinition ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirmDelete.pendingDelete;
      this.dialogConfirmDelete.enable = false;
      const payload = {
        object: "customresourcedefinition",
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
          EventBus.emit(EventTypes.OBJECT_CHANGED, "customresourcedefinition");
        })
        .catch(staleAwareHandler("customresourcedefinition"));
    },
    onCancelDelete() {
      this.dialogConfirmDelete.enable = false;
    },
    formatVersions(versions) {
      if (!versions || !Array.isArray(versions)) return "N/A";
      const versionNames = versions.filter((v) => v.served).map((v) => v.name);
      return versionNames.length > 0 ? versionNames.join(", ") : "N/A";
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        objectType: "",
        namespace: "",
        objectName: "",
      };
      clearDialogRoute(this.$router, this.$route);
    },
    async showDetails(objectName) {
      this.dialogDetails = {
        enable: true,
        objectType: "customresourcedefinition",
        namespace: "",
        objectName,
      };
      writeDialogRoute(this.$router, this.$route, "details", objectName);
    },
  },
};
</script>
