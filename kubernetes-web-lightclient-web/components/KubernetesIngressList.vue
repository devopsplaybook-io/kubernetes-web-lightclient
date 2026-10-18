<template>
  <div>
    <table class="striped">
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
          >Ingress {{ sortArrow("name") }}</th>
          <th>Class</th>
          <th>Hosts</th>
          <th>Address</th>
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
import { UtilsRelativeTime } from "~~/services/Utils";
import { useListTriage } from "~~/composables/useListTriage";
const kubernetesObjectStore = KubernetesObjectStore();
const namespaceStore = NamespaceStore();

const { visibleItems, onSortToggle, sortArrow, ariaSort } = useListTriage("ingress", {
  rawItems: () => kubernetesObjectStore.data.ingresses,
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
    };
  },
  async created() {
    KubernetesObjectStore().getIngresses();
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
        message: `Delete ingress ${kubeObject.metadata.name}${kubeObject.metadata.namespace ? ` (${kubeObject.metadata.namespace})` : ""}?`,
        pendingDelete: kubeObject,
      };
    },
    async onConfirmDelete() {
      const kubeObject = this.dialogConfirmDelete.pendingDelete;
      this.dialogConfirmDelete.enable = false;
      const payload = {
        object: "ingress",
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
          EventBus.emit(EventTypes.OBJECT_CHANGED, "ingress");
        })
        .catch(staleAwareHandler("ingress"));
    },
    onCancelDelete() {
      this.dialogConfirmDelete.enable = false;
    },
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
        objectType: "",
        namespace: "",
        objectName: "",
      };
      clearDialogRoute(this.$router, this.$route);
    },
    async showDetails(namespace, objectName) {
      this.dialogDetails = {
        enable: true,
        objectType: "ingress",
        namespace,
        objectName,
      };
      writeDialogRoute(this.$router, this.$route, "details", objectName, namespace);
    },
  },
};
</script>
