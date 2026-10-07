<template>
  <div>
    <h1>Settings</h1>
    <ResourceSettings />
    <ApiTokensSettings />
  </div>
</template>

<script>
import ResourceSettings from "~~/components/ResourceSettings.vue";
import ApiTokensSettings from "~~/components/ApiTokensSettings.vue";

export default {
  components: {
    ResourceSettings,
    ApiTokensSettings,
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
  },
};
</script>

<style scoped>
h1 {
  margin-top: 0;
}
.settings-section + .settings-section {
  margin-top: var(--space-xl, 2rem);
}
</style>
