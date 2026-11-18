<template>
  <div class="workload-pods">
    <div class="workload-pods-header">
      <div class="workload-pods-title">
        <strong>{{ kindLabel }} {{ name }}</strong>
        <span class="workload-pods-meta"
          >{{ namespace }} · {{ pods.length }} pod(s)</span
        >
      </div>
      <span class="actions">
        <button
          type="button"
          :disabled="pods.length === 0"
          v-on:click="openMergedLogDialog()"
        >
          <i class="bi bi-file-text-fill"></i> Merged logs
        </button>
        <a href="#" v-on:click.prevent="goBack()">Back to {{ kindLabel }}s</a>
      </span>
    </div>
    <Loading v-if="loading" />
    <div v-else-if="error" class="workload-pods-state">
      <p>{{ error }}</p>
      <button type="button" v-on:click="load()">Retry</button>
    </div>
    <div v-else-if="pods.length === 0" class="workload-pods-state">
      <p>No pods found for this workload.</p>
      <p class="workload-pods-hint">
        Check the namespace and the workload's pod selector.
      </p>
    </div>
    <div v-else-if="filteredPods.length === 0" class="workload-pods-state">
      <p>No pods match the current search.</p>
    </div>
    <KubernetesPodList
      v-else
      :pods="filteredPods"
      :auto-fetch="false"
      :deletable="deletable"
    />
    <DialogLogs
      v-if="showMergedLogs"
      :pods="filteredPods"
      :namespace="namespace"
      :workload-kind="kind"
      :workload-name="name"
      @onClose="closeMergedLogs()"
    />
  </div>
</template>

<script>
import Loading from "@devopsplaybook.io/common-web/components/Loading.vue";
import KubernetesPodList from "~~/components/KubernetesPodList.vue";
import DialogLogs from "~~/components/DialogLogs.vue";
import { clearDialogRoute } from "~~/services/DialogDeepLink";
import { FilterKubernetesItems, ParseKeywords } from "~~/services/KeywordFilter";
import { FetchWorkloadPods } from "~~/services/WorkloadPodsService";
import { permissionDenialForError } from "~~/services/PermissionErrors";
import { WorkloadKindLabel } from "~~/services/WorkloadPods";

export default {
  components: {
    Loading,
    KubernetesPodList,
    DialogLogs,
  },
  props: {
    kind: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    namespace: {
      type: String,
      default: "",
    },
    search: {
      type: String,
      default: "",
    },
    deletable: {
      type: Boolean,
      default: false,
    },
    openMergedLogs: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      loading: true,
      error: "",
      pods: [],
      strategy: "",
      showMergedLogs: false,
    };
  },
  computed: {
    kindLabel() {
      return WorkloadKindLabel(this.kind);
    },
    filteredPods() {
      return FilterKubernetesItems(
        this.pods,
        this.namespace,
        ParseKeywords(this.search),
      );
    },
  },
  watch: {
    kind() {
      this.load();
    },
    name() {
      this.load();
    },
    namespace() {
      this.load();
    },
    openMergedLogs(value) {
      if (value) {
        this.showMergedLogs = true;
      }
    },
  },
  async created() {
    await this.load();
    if (this.openMergedLogs) {
      this.showMergedLogs = true;
    }
  },
  methods: {
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const result = await FetchWorkloadPods({
          kind: this.kind,
          name: this.name,
          namespace: this.namespace,
        });
        this.pods = result.pods;
        this.strategy = result.strategy;
      } catch (e) {
        const denial = permissionDenialForError(e);
        if (denial) {
          this.error = denial.message;
        } else {
          this.error =
            e && e.message
              ? e.message
              : "Failed to load the pods for this workload.";
        }
        this.pods = [];
      } finally {
        this.loading = false;
      }
    },
    async refresh() {
      await this.load();
    },
    async openMergedLogDialog() {
      this.showMergedLogs = true;
      await this.$router.replace({
        path: this.$route.path,
        query: { ...this.$route.query, dialog: "merged-logs" },
      });
    },
    async closeMergedLogs() {
      this.showMergedLogs = false;
      await clearDialogRoute(this.$router, this.$route);
    },
    goBack() {
      const query = { ...this.$route.query };
      delete query.workload;
      delete query.workloadName;
      delete query.dialog;
      query.objectType = this.kind;
      if (this.namespace) {
        query.namespace = this.namespace;
      } else {
        delete query.namespace;
      }
      this.$router.replace({
        path: this.$route.path,
        query,
      });
    },
  },
};
</script>

<style scoped>
.workload-pods {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.workload-pods-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.workload-pods-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}
.workload-pods-meta {
  font-size: 0.9em;
  opacity: 0.7;
}
.workload-pods-header .actions {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}
.workload-pods-header .actions button {
  margin: 0;
  width: auto;
  padding: 0.35rem 0.75rem;
}
.workload-pods-state {
  padding: 1rem;
  text-align: center;
}
.workload-pods-state p {
  margin: 0 0 0.5rem 0;
}
.workload-pods-state button {
  width: auto;
}
.workload-pods-hint {
  font-size: 0.9em;
  opacity: 0.7;
}
</style>
