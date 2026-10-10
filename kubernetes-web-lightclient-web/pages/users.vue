<template>
  <div class="page"></div>
</template>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    useRouter().push({ path: "/settings" });
  },
};
</script>

<style scoped></style>
