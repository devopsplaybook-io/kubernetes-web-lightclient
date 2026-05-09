<template>
  <div>
    <dialog id="dialog-alert" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="onClose()"
          ></a>
          {{ title }}
        </header>
        <p>{{ message }}</p>
        <footer>
          <button v-on:click="onClose()">OK</button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script>
export default {
  props: {
    title: {
      type: String,
      default: "Information",
    },
    message: {
      type: String,
      default: "",
    },
  },
  emits: ["onClose"],
  data() {
    return {};
  },
  methods: {
    onClose() {
      this.$emit("onClose", {});
    },
  },
};
</script>

<style scoped>
#dialog-alert article {
  min-width: 400px;
  max-width: 600px;
}
#dialog-alert p {
  font-size: 1em;
  margin: 1em 0;
}
</style>