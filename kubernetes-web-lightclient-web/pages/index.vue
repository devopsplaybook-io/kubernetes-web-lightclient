<template>
  <div class="page"></div>
</template>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      useRouter().push({ path: "/overview" });
    } else {
      useRouter().push({
        path: "/settings",
        query: { tab: "profile", return: useRoute().fullPath },
      });
    }
  },
};
</script>

<style scoped></style>
