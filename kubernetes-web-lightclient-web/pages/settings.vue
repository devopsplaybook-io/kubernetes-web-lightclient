<template>
  <div class="settings-page">
    <h1>Settings</h1>
    <div class="settings-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="settings-tab"
        :class="{ active: activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <ProfileSettings v-if="activeTab === 'profile'" />
    <ResourceSettings v-else-if="activeTab === 'resources'" />
    <ApiTokensSettings v-else-if="activeTab === 'apitoken'" />
    <UsersSettings v-else-if="activeTab === 'users'" />
  </div>
</template>

<script>
import ResourceSettings from "~~/components/ResourceSettings.vue";
import ApiTokensSettings from "~~/components/ApiTokensSettings.vue";
import ProfileSettings from "~~/components/ProfileSettings.vue";
import UsersSettings from "~~/components/UsersSettings.vue";
import { AuthenticationStore } from "~~/stores/AuthenticationStore";
import { CurrentUserStore } from "~~/stores/CurrentUserStore";
import {
  getSettingsTabs,
  normalizeSettingsTab,
} from "~~/utils/settingsTabs.ts";

export default {
  components: {
    ProfileSettings,
    ResourceSettings,
    ApiTokensSettings,
    UsersSettings,
  },
  data() {
    return {
      activeTab: "profile",
    };
  },
  computed: {
    isAuthenticated() {
      return AuthenticationStore().isAuthenticated;
    },
    isAdmin() {
      return CurrentUserStore().isAdmin;
    },
    tabs() {
      return getSettingsTabs(this.isAuthenticated, this.isAdmin);
    },
  },
  watch: {
    // Follow URL changes to ?tab= (browser back/forward, shared links)
    "$route.query.tab"(tab) {
      this.applyTab(tab);
    },
    isAuthenticated(isAuthenticated) {
      this.syncUser(isAuthenticated);
    },
    isAdmin() {
      this.applyTab(useRoute().query.tab);
    },
  },
  async created() {
    await AuthenticationStore().ensureAuthenticated();
    await this.syncUser(this.isAuthenticated);
  },
  methods: {
    async syncUser(isAuthenticated) {
      if (isAuthenticated) {
        await CurrentUserStore().ensureLoaded();
      } else {
        CurrentUserStore().clear();
      }
      this.applyTab(useRoute().query.tab);
    },
    applyTab(tab) {
      const normalized = normalizeSettingsTab(
        tab,
        this.isAuthenticated,
        this.isAdmin,
      );
      if (normalized !== this.activeTab) {
        this.activeTab = normalized;
      }
    },
    selectTab(tab) {
      this.activeTab = tab;
      useRouter().replace({
        path: "/settings",
        query: { ...useRoute().query, tab },
      });
    },
  },
};
</script>

<style scoped>
h1 {
  margin-top: 0;
}
.settings-tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--pico-muted-border-color, #ccc);
  margin-bottom: 2rem;
}
.settings-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0.25rem 1rem;
  margin-bottom: -1px;
  opacity: 0.6;
}
.settings-tab:hover {
  opacity: 1;
}
.settings-tab.active {
  opacity: 1;
  border-bottom-color: var(--pico-primary, #3cabff);
}
</style>
