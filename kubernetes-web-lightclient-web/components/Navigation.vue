<template>
  <AppNavigation :links="[]">
    <template #brand>
      <NuxtLink to="/" class="brand-link"
        ><img src="/icon.png" alt="Kubernetes Web" class="nav-logo" />
        <strong>{{ appTitle }}</strong></NuxtLink
      >
    </template>
    <ul class="menu-links">
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
.menu-links li {
  padding-block: 0.25em;
}
.menu-links li {
  padding-right: 1em;
  font-size: 1.1em;
}
.menu-links .inactive {
  opacity: 0.3;
}
.menu-links .active {
  color: #3cabff;
}
.menu-links {
  font-weight: bold;
}

.nav-logo {
  height: 1.4em;
  vertical-align: middle;
  margin-right: 0.5rem;
}

.menu-links i {
  margin-right: 0.5rem;
}

/* Hide nav labels on narrow screens */
@media (max-width: 1000px) {
  .nav-label {
    display: none;
  }
}

:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: #033452;
}
</style>
