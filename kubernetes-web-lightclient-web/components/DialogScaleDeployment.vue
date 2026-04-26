<template>
  <div>
    <dialog id="dialog-scale-deployment" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="clickClose()"
          ></a>
          Scale Deployment: {{ deploymentName }}
        </header>
        <div>
          <p>
            Namespace: <strong>{{ namespace }}</strong>
          </p>
          <label for="scale-replicas">Number of replicas</label>
          <input
            id="scale-replicas"
            type="number"
            min="0"
            v-model.number="replicas"
          />
        </div>
        <footer>
          <button class="secondary" v-on:click="clickClose()">Cancel</button>
          <button v-on:click="clickScale()">Scale</button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script>
export default {
  props: {
    namespace: {
      type: String,
      default: "",
    },
    deploymentName: {
      type: String,
      default: "",
    },
    currentReplicas: {
      type: Number,
      default: 0,
    },
  },
  data() {
    return {
      replicas: this.currentReplicas,
    };
  },
  methods: {
    clickClose() {
      this.$emit("onClose", {});
    },
    clickScale() {
      this.$emit("onScale", {
        namespace: this.namespace,
        deploymentName: this.deploymentName,
        replicas: this.replicas,
      });
    },
  },
};
</script>

<style scoped>
#dialog-scale-deployment article {
  min-width: 400px;
}
#dialog-scale-deployment label {
  font-size: 1em;
}
#dialog-scale-deployment p {
  font-size: 1em;
}
</style>
