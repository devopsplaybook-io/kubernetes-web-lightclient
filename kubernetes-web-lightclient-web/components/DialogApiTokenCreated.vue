<template>
  <Teleport to="body">
    <dialog id="dialog-api-token-created" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="onClose()"
          ></a>
          API Token Created
        </header>
        <p>
          For security it is shown <strong>only once</strong> and cannot be
          retrieved afterwards.
        </p>
        <pre class="api-token-value">{{ token }}</pre>
        <footer>
          <button class="secondary" v-on:click="copyToken()">
            Copy Token
          </button>
          <button v-on:click="onClose()">Done</button>
        </footer>
      </article>
    </dialog>
  </Teleport>
</template>

<script>
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  props: {
    token: {
      type: String,
      required: true,
    },
  },
  emits: ["onClose"],
  methods: {
    onClose() {
      this.$emit("onClose", {});
    },
    async copyToken() {
      try {
        await navigator.clipboard.writeText(this.token);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Token copied to clipboard",
        });
      } catch (error) {
        handleError(error);
      }
    },
  },
};
</script>

<style scoped>
#dialog-api-token-created article {
  min-width: 400px;
  max-width: 600px;
}
#dialog-api-token-created p {
  font-size: 1em;
  margin: 1em 0;
}
.api-token-value {
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
