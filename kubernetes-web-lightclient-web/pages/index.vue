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
      useRouter().push({ path: "/kubernetes" });
    } else {
      useRouter().push({
        path: "/settings",
        query: { return: useRoute().fullPath },
      });
    }
  },
};
</script>

<style scoped></style>
