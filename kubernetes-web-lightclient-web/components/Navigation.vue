<template>
  <AppNavigation :links="[]">
    <template #brand>
      <NuxtLink to="/" class="brand-link"
        ><img src="/icon.png" alt="Kubernetes Web" class="nav-logo" />
        <strong>{{ appTitle }}</strong></NuxtLink
      >
    </template>
    <ul class="navigation-links">
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/kubernetes"
          :class="activeRoute == '/kubernetes' ? 'active' : 'inactive'"
          ><i class="bi bi-robot"></i>
          <span class="nav-label">Kubernetes</span></NuxtLink
        >
      </li>
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/kubernetes/stats"
          :class="activeRoute == '/kubernetes/stats' ? 'active' : 'inactive'"
          ><i class="bi bi-speedometer"></i>
          <span class="nav-label">Stats</span></NuxtLink
        >
      </li>
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/settings"
          :class="activeRoute == '/settings' ? 'active' : 'inactive'"
          ><i class="bi bi-gear-fill"></i>
          <span class="nav-label">Settings</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/users"
          :class="activeRoute == '/users' ? 'active' : 'inactive'"
          ><i class="bi bi-person-circle"></i>
          <span class="nav-label">Users</span></NuxtLink
        >
      </li>
    </ul>
  </AppNavigation>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";

export default {
  watch: {
    $route(to, from) {
      this.routeUpdated(to);
    },
  },
  data() {
    return {
      activeRoute: "",
      appTitle: "Kubernetes Web",
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    this.loadAppTitle();
  },
  methods: {
    routeUpdated(newRoute) {
      this.activeRoute = newRoute.fullPath.split("?")[0];
    },
    async loadAppTitle() {
      try {
        const res = await axios.get("/config.json");
        const title = res.data?.appTitle;
        if (title && title !== "APPLICATION_TITLE") {
          this.appTitle = title;
          document.title = title;
        }
      } catch (e) {
        // Fallback to default hardcoded title
      }
    },
  },
};
</script>

<style scoped>
.brand-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
}

.navigation-links {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
  margin: 0;
  padding: 0;
  list-style: none;
  font-weight: bold;
}

.navigation-links li {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0;
  font-size: 1.1em;
}

.navigation-links a {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  margin: 0;
  padding: var(--space-sm, 0.5rem);
  line-height: 1;
}

.navigation-links .inactive {
  opacity: 0.3;
}
.navigation-links .active {
  color: #3cabff;
}

.nav-logo {
  height: 1.4em;
}

.navigation-links i {
  line-height: 1;
}

/* Hide nav labels on narrow screens */
@media (max-width: 1000px) {
  .nav-label {
    display: none;
  }
}

:root[data-theme="light"] .navigation-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .navigation-links .active {
  color: #033452;
}
</style>
