<template>
  <Teleport to="body">
    <dialog id="dialog-details" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click.prevent="clickClose()"
          ></a>
          <a
            v-if="backStack.length > 0"
            href="#"
            class="details-back"
            v-on:click.prevent="goBack()"
            >← Back</a
          >
          {{ headerTitle }}
        </header>
        <section class="details-tabs" role="tablist">
          <button
            class="details-tab"
            :class="{ active: activeTab === 'describe' }"
            role="tab"
            :aria-selected="activeTab === 'describe'"
            v-on:click="selectTab('describe')"
          >
            Describe
          </button>
          <button
            class="details-tab"
            :class="{ active: activeTab === 'yaml' }"
            role="tab"
            :aria-selected="activeTab === 'yaml'"
            v-on:click="selectTab('yaml')"
          >
            YAML
          </button>
          <button
            class="details-tab"
            :class="{ active: activeTab === 'related' }"
            role="tab"
            :aria-selected="activeTab === 'related'"
            v-on:click="selectTab('related')"
          >
            Related
          </button>
          <span v-if="activeTab !== 'related'" class="actions"
            ><i
              class="bi bi-clipboard"
              title="Copy"
              v-on:click="copyText()"
            ></i
          ></span>
        </section>
        <pre v-if="activeTab !== 'related'" id="dialog-details-text">{{
          activeText
        }}</pre>
        <RelatedTab
          v-else
          :result="relatedResult"
          :object-type="currentObjectType"
          :object-name="currentObjectName"
          :object-namespace="currentNamespace"
          :kind="relatedResult.kind || currentTypeName"
          :loading="relatedLoading"
          :error="relatedError"
          v-on:navigate="onNavigate"
          v-on:openEvents="openEvents()"
          v-on:openWorkload="openWorkload"
          v-on:retry="fetchRelated(true)"
        />
      </article>
    </dialog>
  </Teleport>
</template>

<script>
import {
  describeObject,
  getObjectManifestYaml,
} from "~~/services/ManifestService";
import { staleAwareHandler } from "~~/services/KubernetesUtils";
import { EventBus, EventTypes } from "~~/services/EventBus";
import { writeDialogRoute } from "~~/services/DialogDeepLink";
import { ResourceService } from "~~/services/ResourceService";
import { FetchRelatedObjects } from "~~/services/RelatedObjectsService";
import { DetailsPath, FilteredListPath } from "~~/services/ObjectLinks";
import { WorkloadDrilldownQuery } from "~~/services/WorkloadPods";
import RelatedTab from "~~/components/RelatedTab.vue";

const BACK_STACK_LIMIT = 10;

function EmptyRelatedResult() {
  return {
    kind: "",
    owners: [],
    pods: [],
    replicaSets: [],
    services: [],
    ingresses: [],
    configMaps: [],
    secrets: [],
    node: null,
    events: [],
    usedByPods: [],
    errors: [],
  };
}

export default {
  components: { RelatedTab },
  props: {
    objectType: {
      type: String,
      required: true,
    },
    objectName: {
      type: String,
      required: true,
    },
    namespace: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      default: "",
    },
  },
  data() {
    return {
      activeTab: "describe",
      describeText: "",
      yamlText: "",
      yamlLoaded: false,
      yamlLoading: false,
      relatedResult: EmptyRelatedResult(),
      relatedLoaded: false,
      relatedLoading: false,
      relatedError: "",
      currentObjectType: this.objectType,
      currentObjectName: this.objectName,
      currentNamespace: this.namespace,
      currentTypeName: this.objectType,
      backStack: [],
      _fetchEpoch: 0,
    };
  },
  computed: {
    headerTitle() {
      if (this.currentObjectName !== this.objectName) {
        return `Details: ${this.currentObjectName}`;
      }
      return this.title || `Details: ${this.currentObjectName}`;
    },
    activeText() {
      if (this.activeTab === "yaml") {
        return this.yamlText || (this.yamlLoading ? "Loading..." : "");
      }
      return this.describeText || "Loading...";
    },
  },
  async created() {
    await this.fetchDescribe();
  },
  methods: {
    async clickClose() {
      this.$emit("onClose", {});
    },
    selectTab(tab) {
      this.activeTab = tab;
      if (tab === "yaml") {
        this.fetchYaml();
      } else if (tab === "related") {
        this.fetchRelated(false);
      }
    },
    async fetchDescribe() {
      const epoch = this._fetchEpoch;
      const objectType = this.currentObjectType;
      const namespace = this.currentNamespace;
      const name = this.currentObjectName;
      try {
        const text = await describeObject(objectType, namespace, name);
        if (epoch === this._fetchEpoch) {
          this.describeText = text;
        }
      } catch (error) {
        if (epoch === this._fetchEpoch) {
          staleAwareHandler(objectType)(error);
        }
      }
    },
    async fetchYaml() {
      if (this.yamlLoaded || this.yamlLoading) {
        return;
      }
      this.yamlLoading = true;
      const epoch = this._fetchEpoch;
      const objectType = this.currentObjectType;
      try {
        const text = await getObjectManifestYaml(
          objectType,
          this.currentNamespace,
          this.currentObjectName,
        );
        if (epoch === this._fetchEpoch) {
          this.yamlText = text;
          this.yamlLoaded = true;
        }
      } catch (error) {
        if (epoch === this._fetchEpoch) {
          staleAwareHandler(objectType)(error);
        }
      } finally {
        if (epoch === this._fetchEpoch) {
          this.yamlLoading = false;
        }
      }
    },
    async fetchRelated(force) {
      if (!force && (this.relatedLoaded || this.relatedLoading)) {
        return;
      }
      const epoch = this._fetchEpoch;
      const objectType = this.currentObjectType;
      this.relatedLoading = true;
      this.relatedError = "";
      try {
        const types = await ResourceService.getAvailableTypes();
        const typeInfo = types.find((type) => type.id === objectType);
        if (typeInfo) {
          this.currentTypeName = typeInfo.name;
        }
        const result = await FetchRelatedObjects({
          objectType,
          namespace: this.currentNamespace,
          name: this.currentObjectName,
          types,
        });
        if (epoch === this._fetchEpoch) {
          this.relatedResult = result;
          this.relatedLoaded = true;
        }
      } catch (error) {
        if (epoch === this._fetchEpoch) {
          staleAwareHandler(objectType)(error);
          this.relatedError =
            error && error.message
              ? error.message
              : "Failed to load the related objects.";
        }
      } finally {
        if (epoch === this._fetchEpoch) {
          this.relatedLoading = false;
        }
      }
    },
    resetForObject() {
      this._fetchEpoch += 1;
      this.activeTab = "describe";
      this.describeText = "";
      this.yamlText = "";
      this.yamlLoaded = false;
      this.yamlLoading = false;
      this.relatedResult = EmptyRelatedResult();
      this.relatedLoaded = false;
      this.relatedLoading = false;
      this.relatedError = "";
    },
    onNavigate({ objectType, namespace, name }) {
      if (objectType === this.currentObjectType) {
        this.backStack = [
          ...this.backStack,
          {
            objectType: this.currentObjectType,
            name: this.currentObjectName,
            namespace: this.currentNamespace,
          },
        ].slice(-BACK_STACK_LIMIT);
        this.currentObjectName = name;
        this.currentNamespace = namespace;
        this.resetForObject();
        this.fetchDescribe();
        writeDialogRoute(
          this.$router,
          this.$route,
          "details",
          name,
          namespace,
        );
        return;
      }
      this.$router.push(DetailsPath(objectType, namespace, name));
    },
    openEvents() {
      this.$router.push(
        FilteredListPath("events", this.currentNamespace, this.currentObjectName),
      );
    },
    openWorkload({ kind, name, namespace }) {
      const query = new URLSearchParams(
        WorkloadDrilldownQuery(kind, name, namespace),
      );
      this.$router.push(`/kubernetes?${query.toString()}`);
    },
    goBack() {
      const previous = this.backStack[this.backStack.length - 1];
      if (!previous) {
        return;
      }
      this.backStack = this.backStack.slice(0, -1);
      this.currentObjectName = previous.name;
      this.currentNamespace = previous.namespace;
      this.resetForObject();
      this.fetchDescribe();
      writeDialogRoute(
        this.$router,
        this.$route,
        "details",
        previous.name,
        previous.namespace,
      );
    },
    async copyText() {
      const text = this.activeText;
      try {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Plain-HTTP deployments have no secure context: fall back to a
          // temporary textarea and the legacy execCommand clipboard API
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!copied) {
            throw new Error("Clipboard copy failed");
          }
        }
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Copied to clipboard",
        });
      } catch {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Failed to copy to clipboard",
        });
      }
    },
  },
};
</script>

<style scoped>
#dialog-details article {
  min-width: 90dvw;
  height: 90dvh;
  display: grid;
  grid-template-rows: auto auto 1fr;
}
#dialog-details-text {
  overflow: auto;
}
#dialog-details .details-tabs {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  border-bottom: 1px solid var(--pico-muted-border-color, #ccc);
  margin-bottom: 0.5rem;
}
#dialog-details .details-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0.25rem 1rem;
  margin-bottom: -1px;
  opacity: 0.6;
}
#dialog-details .details-tab:hover {
  opacity: 1;
}
#dialog-details .details-tab.active {
  opacity: 1;
  border-bottom-color: var(--pico-primary, #3cabff);
}
#dialog-details .details-tabs .actions {
  margin-left: auto;
  font-size: 1.1em;
}
#dialog-details .details-tabs .actions i {
  cursor: pointer;
}
#dialog-details .details-back {
  margin-right: 0.75rem;
  font-size: 0.8em;
}
</style>
