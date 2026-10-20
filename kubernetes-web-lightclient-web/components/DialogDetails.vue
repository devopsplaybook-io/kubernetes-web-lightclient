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
          <span class="actions"
            ><i
              class="bi bi-clipboard"
              title="Copy"
              v-on:click="copyText()"
            ></i
          ></span>
        </section>
        <pre id="dialog-details-text">{{ activeText }}</pre>
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

export default {
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
    };
  },
  computed: {
    headerTitle() {
      return this.title || `Details: ${this.objectName}`;
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
      }
    },
    async fetchDescribe() {
      try {
        this.describeText = await describeObject(
          this.objectType,
          this.namespace,
          this.objectName,
        );
      } catch (error) {
        staleAwareHandler(this.objectType)(error);
      }
    },
    async fetchYaml() {
      if (this.yamlLoaded || this.yamlLoading) {
        return;
      }
      this.yamlLoading = true;
      try {
        this.yamlText = await getObjectManifestYaml(
          this.objectType,
          this.namespace,
          this.objectName,
        );
        this.yamlLoaded = true;
      } catch (error) {
        staleAwareHandler(this.objectType)(error);
      } finally {
        this.yamlLoading = false;
      }
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
</style>
