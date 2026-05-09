<template>
  <div>
    <dialog id="dialog-confirm" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="onCancel()"
          ></a>
          {{ title }}
        </header>
        <p>{{ message }}</p>
        <footer>
          <button class="secondary" v-on:click="onCancel()">Cancel</button>
          <button v-on:click="onConfirm()">Confirm</button>
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
      default: "Confirm",
    },
    message: {
      type: String,
      default: "Are you sure?",
    },
  },
  emits: ["onConfirm", "onCancel"],
  data() {
    return {};
  },
  methods: {
    onConfirm() {
      this.$emit("onConfirm", {});
    },
    onCancel() {
      this.$emit("onCancel", {});
    },
  },
};
</script>

<style scoped>
#dialog-confirm article {
  min-width: 400px;
  max-width: 600px;
}
#dialog-confirm p {
  font-size: 1em;
  margin: 1em 0;
}
</style>