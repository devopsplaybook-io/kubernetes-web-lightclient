<template>
  <section class="access-denied" role="alert">
    <h3><i class="bi bi-shield-lock"></i> {{ title }}</h3>
    <p v-if="scope" class="access-denied-scope">
      <code>{{ scope }}</code>
    </p>
    <p class="access-denied-message">{{ message }}</p>
    <div class="access-denied-actions">
      <button type="button" class="secondary" v-on:click="$emit('retry')">
        Retry
      </button>
      <button
        v-if="showSettingsLink"
        type="button"
        v-on:click="openSettings()"
      >
        Manage access in Settings
      </button>
    </div>
  </section>
</template>

<script>
export default {
  props: {
    scope: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      default: "Access denied",
    },
    message: {
      type: String,
      default:
        "You do not have permission to view this content. Ask an administrator to review your role and scopes.",
    },
    showSettingsLink: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["retry"],
  methods: {
    openSettings() {
      const router = this.$router;
      if (router) {
        router.push({ path: "/settings", query: { tab: "users" } });
      }
    },
  },
};
</script>

<style scoped>
.access-denied {
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-left: 4px solid var(--pico-del-color, #c62828);
  border-radius: 0.5em;
  padding: 1.25em;
  margin: 1em 0;
  background: var(--pico-card-background-color, transparent);
}
.access-denied h3 {
  margin-top: 0;
  margin-bottom: 0.5em;
}
.access-denied h3 i {
  margin-right: 0.35em;
}
.access-denied-scope {
  margin: 0 0 0.5em 0;
}
.access-denied-scope code {
  font-size: 0.95em;
  padding: 0.1em 0.4em;
  border-radius: 0.3em;
  background: var(--pico-code-background-color, rgba(0, 0, 0, 0.08));
}
.access-denied-message {
  margin-bottom: 1em;
}
.access-denied-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
}
.access-denied-actions button {
  width: auto;
  margin: 0;
}
</style>
