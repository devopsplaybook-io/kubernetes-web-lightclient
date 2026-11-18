<template>
  <article class="overview-tile">
    <header class="overview-tile-header">
      <h5>
        <i v-if="icon" class="bi" :class="icon" aria-hidden="true"></i>
        <NuxtLink v-if="to" :to="to" class="overview-tile-title">{{
          title
        }}</NuxtLink>
        <span v-else>{{ title }}</span>
      </h5>
      <NuxtLink
        v-if="to"
        :to="to"
        class="overview-tile-more"
        :aria-label="`Open ${title}`"
        title="Open the filtered list"
      >
        <i class="bi bi-arrow-right-circle" aria-hidden="true"></i>
      </NuxtLink>
    </header>
    <div v-if="noAccessScope" class="overview-tile-state overview-tile-denied">
      <p>
        <i class="bi bi-shield-lock" aria-hidden="true"></i>
        {{ denialMessage }}
      </p>
      <button
        v-if="showSettingsLink"
        type="button"
        class="outline overview-tile-settings"
        v-on:click="openSettings()"
      >
        Manage access in Settings
      </button>
    </div>
    <div v-else-if="loading" class="overview-tile-state">
      <Loading size="small" />
    </div>
    <div v-else-if="error" class="overview-tile-state overview-tile-error">
      <p>{{ error }}</p>
      <button type="button" class="outline" v-on:click="$emit('retry')">
        Retry
      </button>
    </div>
    <div v-else class="overview-tile-body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="overview-tile-footer">
      <slot name="footer" />
    </footer>
  </article>
</template>

<script>
import Loading from "@devopsplaybook.io/common-web/components/Loading.vue";
import { denialForScope } from "~~/services/PermissionErrors";

export default {
  components: { Loading },
  props: {
    title: {
      type: String,
      required: true,
    },
    icon: {
      type: String,
      default: "",
    },
    // Header deep link to the corresponding filtered list
    to: {
      type: [String, Object],
      default: null,
    },
    loading: {
      type: Boolean,
      default: false,
    },
    error: {
      type: String,
      default: "",
    },
    // Missing scope (e.g. "k8s:read"); empty means access is allowed
    noAccessScope: {
      type: String,
      default: "",
    },
    showSettingsLink: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["retry"],
  computed: {
    denialMessage() {
      return (
        denialForScope(this.noAccessScope)?.message ||
        "You do not have permission to view this content."
      );
    },
  },
  methods: {
    openSettings() {
      if (this.$router) {
        this.$router.push({ path: "/settings", query: { tab: "users" } });
      }
    },
  },
};
</script>

<style scoped>
.overview-tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 0.5rem);
  height: 100%;
  margin: 0;
  padding: var(--space-base, 1rem);
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 0.5rem;
  background: var(--pico-card-background-color, transparent);
}

.overview-tile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm, 0.5rem);
}

.overview-tile-header h5 {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  margin: 0;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.overview-tile-title {
  color: inherit;
  text-decoration: none;
}

.overview-tile-title:hover {
  text-decoration: underline;
}

.overview-tile-more {
  color: inherit;
  opacity: 0.7;
}

.overview-tile-body {
  flex: 1;
  min-height: 0;
}

.overview-tile-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm, 0.5rem);
}

.overview-tile-state p {
  margin: 0;
}

.overview-tile-state button {
  width: auto;
  margin: 0;
  padding: 0.25rem 0.8rem;
  font-size: 0.85em;
}

.overview-tile-denied p {
  color: var(--pico-muted-color, #666);
}

.overview-tile-footer {
  border-top: 1px solid var(--pico-muted-border-color, #ccc);
  padding-top: var(--space-sm, 0.5rem);
  font-size: 0.85em;
}
</style>
