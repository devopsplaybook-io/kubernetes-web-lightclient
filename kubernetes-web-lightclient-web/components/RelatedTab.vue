<template>
  <div class="related-tab">
    <div v-if="loading" class="related-state">
      <p>Loading related objects…</p>
    </div>
    <div v-else-if="error" class="related-state">
      <p>{{ error }}</p>
      <button type="button" v-on:click="$emit('retry')">Retry</button>
    </div>
    <div v-else-if="isEmpty" class="related-state">
      <p>No related objects found for this {{ kindLabel }}.</p>
    </div>
    <template v-else>
      <div
        v-if="result.errors.length > 0"
        class="related-warnings"
        role="status"
      >
        Some sections could not be loaded:
        <span v-for="failure in result.errors" :key="failure.section">
          {{ failure.section }} ({{ failure.message }})
        </span>
      </div>

      <section v-if="isApplicable('owners')" class="related-section">
        <h3>Owners</h3>
        <p v-if="result.owners.length === 0" class="related-empty">
          No owner references.
        </p>
        <ul v-else>
          <li v-for="owner in result.owners" :key="`${owner.kind}/${owner.name}`">
            <a
              v-if="owner.typeId"
              href="#"
              v-on:click.prevent="openDetails(owner.typeId, owner.namespace, owner.name)"
              >{{ owner.kind }} {{ owner.name }}</a
            >
            <span v-else class="related-unlinked">{{ owner.kind }} {{ owner.name }}</span>
            <span class="related-meta">{{ owner.namespace }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('pods')" class="related-section">
        <h3>
          Pods
          <a
            v-if="isWorkload && result.pods.length > 0"
            href="#"
            class="related-action"
            v-on:click.prevent="openWorkload()"
            >Open pods view</a
          >
        </h3>
        <p v-if="result.pods.length === 0" class="related-empty">
          No pods selected by this {{ kindLabel }}.
        </p>
        <ul v-else>
          <li v-for="pod in result.pods" :key="pod.metadata?.uid || pod.metadata?.name">
            <a
              href="#"
              v-on:click.prevent="openDetails('pod', objectNamespaceOf(pod), pod.metadata?.name)"
              >{{ pod.metadata?.name }}</a
            >
            <span class="related-meta">{{ objectNamespaceOf(pod) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('replicaSets')" class="related-section">
        <h3>ReplicaSets</h3>
        <p v-if="result.replicaSets.length === 0" class="related-empty">
          No ReplicaSets owned by this Deployment.
        </p>
        <ul v-else>
          <li
            v-for="replicaSet in result.replicaSets"
            :key="replicaSet.metadata?.uid || replicaSet.metadata?.name"
          >
            <a
              href="#"
              v-on:click.prevent="openDetails('replicaset', objectNamespaceOf(replicaSet), replicaSet.metadata?.name)"
              >{{ replicaSet.metadata?.name }}</a
            >
            <span class="related-meta">{{ objectNamespaceOf(replicaSet) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('services')" class="related-section">
        <h3>Services</h3>
        <p v-if="result.services.length === 0" class="related-empty">
          No Service selects these labels.
        </p>
        <ul v-else>
          <li v-for="service in result.services" :key="service.metadata?.uid || service.metadata?.name">
            <a
              href="#"
              v-on:click.prevent="openDetails('service', objectNamespaceOf(service), service.metadata?.name)"
              >{{ service.metadata?.name }}</a
            >
            <span class="related-meta">{{ objectNamespaceOf(service) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('ingresses')" class="related-section">
        <h3>Ingresses</h3>
        <p v-if="result.ingresses.length === 0" class="related-empty">
          No Ingress routes to this object.
        </p>
        <ul v-else>
          <li v-for="ingress in result.ingresses" :key="ingress.metadata?.uid || ingress.metadata?.name">
            <a
              href="#"
              v-on:click.prevent="openDetails('ingress', objectNamespaceOf(ingress), ingress.metadata?.name)"
              >{{ ingress.metadata?.name }}</a
            >
            <span class="related-meta">{{ objectNamespaceOf(ingress) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('configMaps')" class="related-section">
        <h3>Referenced ConfigMaps</h3>
        <p v-if="result.configMaps.length === 0" class="related-empty">
          No ConfigMap is referenced by the pod template.
        </p>
        <ul v-else>
          <li v-for="entry in result.configMaps" :key="entry.name">
            <a
              href="#"
              v-on:click.prevent="openDetails('configmap', objectNamespace, entry.name)"
              >{{ entry.name }}</a
            >
            <span class="related-meta">{{ entry.via }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('secrets')" class="related-section">
        <h3>Referenced Secrets</h3>
        <p v-if="result.secrets.length === 0" class="related-empty">
          No Secret is referenced by the pod template.
        </p>
        <ul v-else>
          <li v-for="entry in result.secrets" :key="entry.name">
            <a
              href="#"
              v-on:click.prevent="openDetails('secret', objectNamespace, entry.name)"
              >{{ entry.name }}</a
            >
            <span class="related-meta">{{ entry.via }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('node')" class="related-section">
        <h3>Node</h3>
        <p v-if="!result.node" class="related-empty">
          This pod is not scheduled on a node.
        </p>
        <ul v-else>
          <li>
            <a
              href="#"
              v-on:click.prevent="openDetails('node', '', result.node.metadata?.name)"
              >{{ result.node.metadata?.name }}</a
            >
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('usedByPods')" class="related-section">
        <h3>Referenced by pods</h3>
        <p v-if="result.usedByPods.length === 0" class="related-empty">
          No pod references this {{ kindLabel }}.
        </p>
        <ul v-else>
          <li v-for="pod in result.usedByPods" :key="pod.metadata?.uid || pod.metadata?.name">
            <a
              href="#"
              v-on:click.prevent="openDetails('pod', objectNamespaceOf(pod), pod.metadata?.name)"
              >{{ pod.metadata?.name }}</a
            >
            <span class="related-meta">{{ objectNamespaceOf(pod) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="isApplicable('events')" class="related-section">
        <h3>
          Events
          <a
            v-if="result.events.length > 0"
            href="#"
            class="related-action"
            v-on:click.prevent="$emit('openEvents')"
            >View all events</a
          >
        </h3>
        <p v-if="result.events.length === 0" class="related-empty">
          No events for this object.
        </p>
        <table v-else class="related-events">
          <thead>
            <tr>
              <th>Type</th>
              <th>Reason</th>
              <th>Message</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="event in result.events"
              :key="event.metadata?.uid || event.metadata?.name"
              class="related-event-row"
              v-on:click="$emit('openEvents')"
            >
              <td>{{ event.type }}</td>
              <td>{{ event.reason }}</td>
              <td class="related-event-message">{{ event.message }}</td>
              <td>{{ relativeTime(event) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script>
import { UtilsRelativeTime } from "~~/services/Utils";

const WORKLOAD_TYPES = [
  "deployment",
  "statefulset",
  "daemonset",
  "job",
  "cronjob",
];

export default {
  props: {
    result: {
      type: Object,
      default: () => ({
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
      }),
    },
    objectType: {
      type: String,
      required: true,
    },
    objectName: {
      type: String,
      required: true,
    },
    objectNamespace: {
      type: String,
      default: "",
    },
    kind: {
      type: String,
      default: "",
    },
    loading: {
      type: Boolean,
      default: false,
    },
    error: {
      type: String,
      default: "",
    },
  },
  emits: ["navigate", "openEvents", "openWorkload", "retry"],
  computed: {
    kindLabel() {
      return this.kind || this.objectType;
    },
    isWorkload() {
      return WORKLOAD_TYPES.includes(this.objectType);
    },
    applicableSections() {
      const sections = new Set(["owners", "events"]);
      if (
        this.isWorkload ||
        ["service", "replicaset"].includes(this.objectType) ||
        (this.objectType === "pod" && this.result.pods.length > 0)
      ) {
        sections.add("pods");
      }
      if (this.objectType === "deployment") {
        sections.add("replicaSets");
      }
      if (
        this.isWorkload ||
        ["pod", "replicaset", "service"].includes(this.objectType)
      ) {
        sections.add("services");
        sections.add("ingresses");
      }
      if (this.objectType === "ingress") {
        sections.add("services");
      }
      if (this.isWorkload || ["pod", "replicaset"].includes(this.objectType)) {
        sections.add("configMaps");
        sections.add("secrets");
      }
      if (this.objectType === "pod") {
        sections.add("node");
      }
      if (["configmap", "secret"].includes(this.objectType)) {
        sections.add("usedByPods");
      }
      return sections;
    },
    isEmpty() {
      if (this.result.errors.length > 0) {
        return false;
      }
      const data = {
        owners: this.result.owners.length,
        pods: this.result.pods.length,
        replicaSets: this.result.replicaSets.length,
        services: this.result.services.length,
        ingresses: this.result.ingresses.length,
        configMaps: this.result.configMaps.length,
        secrets: this.result.secrets.length,
        node: this.result.node ? 1 : 0,
        events: this.result.events.length,
        usedByPods: this.result.usedByPods.length,
      };
      return Array.from(this.applicableSections).every(
        (section) => data[section] === 0,
      );
    },
  },
  methods: {
    isApplicable(section) {
      return this.applicableSections.has(section);
    },
    objectNamespaceOf(object) {
      return object?.metadata?.namespace || "";
    },
    openDetails(objectType, namespace, name) {
      this.$emit("navigate", { objectType, namespace, name });
    },
    openWorkload() {
      this.$emit("openWorkload", {
        kind: this.objectType,
        name: this.objectName,
        namespace: this.objectNamespace,
      });
    },
    relativeTime(event) {
      const timestamp =
        event?.lastTimestamp ||
        event?.eventTime ||
        event?.metadata?.creationTimestamp;
      return timestamp ? UtilsRelativeTime(timestamp) : "";
    },
  },
};
</script>

<style scoped>
.related-tab {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.related-state {
  padding: 1rem;
}
.related-warnings {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 4px;
  font-size: 0.85em;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.related-section h3 {
  font-size: 0.95em;
  margin: 0 0 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.related-action {
  font-size: 0.8em;
}
.related-section ul {
  margin: 0;
  padding-left: 1.1rem;
}
.related-section li {
  margin: 0.1rem 0;
}
.related-meta {
  margin-left: 0.5rem;
  font-size: 0.8em;
  opacity: 0.65;
}
.related-empty {
  margin: 0;
  font-size: 0.85em;
  opacity: 0.65;
}
.related-unlinked {
  opacity: 0.7;
}
.related-events {
  width: 100%;
  font-size: 0.85em;
}
.related-events th,
.related-events td {
  padding: 0.25rem 0.4rem;
}
.related-event-row {
  cursor: pointer;
}
.related-event-message {
  white-space: normal;
}
</style>
