<template>
  <div
    class="loading-indicator"
    :class="{ 'loading-indicator-small': size === 'small' }"
  ></div>
</template>

<script>
export default {
  props: {
    size: {
      type: String,
      default: "",
    },
  },
};
</script>

<style scoped>
/* Loading */

@media (prefers-color-scheme: dark) {
  .loading-indicator {
    --c: no-repeat linear-gradient(#bcc6ce 0 0);
  }
}
@media (prefers-color-scheme: light) {
  .loading-indicator {
    --c: no-repeat linear-gradient(#1d2832 0 0);
  }
}
.loading-indicator {
  width: 15%;
  margin-left: auto;
  margin-right: auto;
  margin-top: 20%;
  margin-bottom: 20%;
  aspect-ratio: 1;
  background:
    var(--c) 0% 50%,
    var(--c) 50% 50%,
    var(--c) 100% 50%;
  background-size: 20% 100%;
  animation: l1 2s infinite linear;
}
@keyframes l1 {
  0% {
    background-size:
      20% 100%,
      20% 100%,
      20% 100%;
  }
  33% {
    background-size:
      20% 10%,
      20% 100%,
      20% 100%;
  }
  50% {
    background-size:
      20% 100%,
      20% 10%,
      20% 100%;
  }
  66% {
    background-size:
      20% 100%,
      20% 100%,
      20% 10%;
  }
  100% {
    background-size:
      20% 100%,
      20% 100%,
      20% 100%;
  }
}

.loading-indicator-small {
  width: 3rem !important;
  margin-top: 0.5rem !important;
  margin-bottom: 0.5rem !important;
}
</style>