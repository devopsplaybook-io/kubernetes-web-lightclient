<template>
  <section class="user-access-summary">
    <h2>Your access</h2>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else-if="error" class="access-summary-error">
      <p>{{ error }}</p>
      <button type="button" class="secondary" v-on:click="$emit('retry')">
        Retry
      </button>
    </div>

    <div v-else-if="user">
      <p class="access-summary-identity">
        Signed in as <strong>{{ user.name }}</strong>
        <span class="role-badge">{{ user.role }}</span>
      </p>

      <ul v-if="grantedScopes.length > 0" class="scope-list">
        <li v-for="scope in grantedScopes" :key="scope.id">
          <strong>{{ scope.label }}</strong>
          <code>{{ scope.id }}</code>
          <span class="scope-description">{{ scope.description }}</span>
        </li>
      </ul>
      <p v-else class="access-summary-hint">
        You can sign in but cannot access cluster data until an administrator
        grants scopes.
      </p>

      <p v-if="isAdminRole" class="access-summary-note">
        The <code>admin</code> role bypasses per-scope checks and also grants
        user administration.
      </p>
      <p v-else-if="adminScopeOnly" class="access-summary-note">
        The <code>admin</code> scope grants admin-only cluster actions, but user
        administration still requires the administrator role.
      </p>
    </div>
  </section>
</template>

<script>
import {
  SCOPE_DEFINITIONS,
  hasAdminScope,
  isAdminRole,
  normalizeScopes,
} from "~~/services/Scopes";

export default {
  props: {
    user: {
      type: Object,
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
  },
  emits: ["retry"],
  computed: {
    grantedScopes() {
      const granted = normalizeScopes(this.user?.scopes);
      return SCOPE_DEFINITIONS.filter((scope) => granted.includes(scope.id));
    },
    isAdminRole() {
      return isAdminRole(this.user);
    },
    adminScopeOnly() {
      return !this.isAdminRole && hasAdminScope(this.user);
    },
  },
};
</script>

<style scoped>
.user-access-summary h2 {
  margin-top: var(--space-lg, 1.5rem);
}
.access-summary-identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5em;
}
.role-badge {
  font-size: 0.8em;
  padding: 0.1em 0.5em;
  border-radius: 1em;
  border: 1px solid var(--pico-muted-border-color, #ccc);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.scope-list {
  list-style: none;
  padding-left: 0;
  display: grid;
  gap: 0.5em;
}
.scope-list li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: baseline;
  gap: 0.5em;
}
.scope-list code {
  font-size: 0.85em;
}
.scope-description {
  font-size: 0.9em;
  opacity: 0.8;
}
.access-summary-hint,
.access-summary-note {
  font-size: 0.9em;
  opacity: 0.85;
}
.access-summary-error button {
  width: auto;
}
@media (max-width: 600px) {
  .scope-list li {
    grid-template-columns: 1fr;
    gap: 0.1em;
  }
}
</style>
