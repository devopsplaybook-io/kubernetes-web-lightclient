<template>
  <div>
    <table
      class="striped"
      v-if="kubernetesObjectStore.data.cronjobs.length > 0"
    >
      <thead>
        <tr>
          <th
            class="sortable"
            :aria-sort="ariaSort('namespace')"
            v-on:click="onSortToggle('namespace')"
          >Namespace {{ sortArrow("namespace") }}</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('name')"
            v-on:click="onSortToggle('name')"
          >CronJob {{ sortArrow("name") }}</th>
          <th>Schedule</th>
          <th>Suspend</th>
          <th>Active</th>
          <th
            class="sortable"
            :aria-sort="ariaSort('age')"
            v-on:click="onSortToggle('age')"
          >Age {{ sortArrow("age") }}</th>
          <th>Details</th>
          <th>Trigger</th>
          <th v-if="deletable">Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of visibleItems"
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
                  kubeObject.metadata.name,
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
                  kubeObject.metadata.name,
                )
              "
              title="Trigger CronJob"
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
      v-if="dialogConfirm.enable"
      :title="dialogConfirm.title"
      :message="dialogConfirm.message"
      @onConfirm="onConfirmTrigger()"
      @onCancel="onCancelTrigger()"
    />
    <DialogAlert
      v-if="dialogAlert.enable"
      :title="dialogAlert.title"
      :message="dialogAlert.message"
      @onClose="onCloseAlert()"
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
const namespaceStore = NamespaceStore();

const { visibleItems, onSortToggle, sortArrow, ariaSort } = useListTriage("cronjob", {
  rawItems: () => kubernetesObjectStore.data.cronjobs,
  accessors: {
    namespace: (kubeObject) => kubeObject.metadata.namespace || "",
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
      dialogConfirm: {
        enable: false,
        title: "",
        message: "",
        pendingTrigger: null,
      },
      dialogAlert: {
        enable: false,
        title: "",
        message: "",
      },
    };
  },
  async created() {
    KubernetesObjectStore().getCronJobs();
    const dialogRoute = readDialogRoute(this.$route?.query);
    if (dialogRoute && dialogRoute.kind === "details") {
      this.showDetails(dialogRoute.namespace, dialogRoute.name);
    }
  },
  methods: {
    confirmDelete(kubeObject) {
      this.dialogConfirmDelete = {
        enable: true,
        title: "Confirm Delete",
        message: `Delete cronjob ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirmDelete.pendingDelete;
      this.dialogConfirmDelete.enable = false;
      const payload = {
        object: "cronjob",
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
          EventBus.emit(EventTypes.OBJECT_CHANGED, "cronjob");
        })
        .catch(staleAwareHandler("cronjob"));
    },
    onCancelDelete() {
      this.dialogConfirmDelete.enable = false;
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
    async showDetails(namespace, objectName) {
      this.dialogDetails = {
        enable: true,
        objectType: "cronjob",
        namespace,
        objectName,
      };
      writeDialogRoute(this.$router, this.$route, "details", objectName, namespace);
    },
    async triggerCronJob(namespace, objectName) {
      const jobName = `${objectName}-manual-${Date.now()}`;
      this.dialogConfirm = {
        enable: true,
        title: "Confirm Trigger",
        message: `Trigger CronJob "${objectName}" as job "${jobName}"?`,
        pendingTrigger: { namespace, objectName, jobName },
      };
    },
    async onConfirmTrigger() {
      const { namespace, objectName, jobName } =
        this.dialogConfirm.pendingTrigger;
      this.dialogConfirm.enable = false;
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
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          this.dialogAlert = {
            enable: true,
            title: "Success",
            message: `Job "${jobName}" created successfully from CronJob "${objectName}"`,
          };
        })
        .catch(staleAwareHandler("cronjob"));
    },
    onCancelTrigger() {
      this.dialogConfirm.enable = false;
    },
    onCloseAlert() {
      this.dialogAlert.enable = false;
    },
  },
};
</script>
