<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/"><strong>Kubernetes Web</strong></NuxtLink>
      </li>
    </ul>
    <ul class="menu-links">
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink to="/kubernetes" :class="activeRoute == 'kubernetes' ? 'active' : 'inactive'"
          ><i class="bi bi-robot"></i
        ></NuxtLink>
      </li>
      <li>
        <NuxtLink to="/users" :class="activeRoute == 'users' ? 'active' : 'inactive'"
          ><i class="bi bi-person-circle"></i
        ></NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { AuthService } from "~~/services/AuthService";
const authenticationStore = AuthenticationStore();
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  watch: {
    $route(to, from) {
      this.routeUpdated(to);
    },
  },
  data() {
    return {
      activeRoute: "",
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    if (await AuthenticationStore().ensureAuthenticated()) {
      setTimeout(async () => {
        // Renew session tocken
        axios
          .post(`${(await Config.get()).SERVER_URL}/users/session`, {}, await AuthService.getAuthHeader())
          .then((res) => {
            AuthService.saveToken(res.data.token);
          });
      }, 10000);
    }
  },
  methods: {
    routeUpdated(newRoute) {
      this.activeRoute = newRoute.fullPath.split("/")[1];
    },
  },
};
</script>

<style scoped>
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
</style>
