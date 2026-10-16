<template>
  <div v-if="filters.length > 0" class="list-triage-toolbar">
    <button
      v-for="filter of filters"
      v-bind:key="filter.id"
      type="button"
      class="list-triage-chip"
      :class="{ 'list-triage-chip-active': isActive(filter.id) }"
      :aria-pressed="isActive(filter.id) ? 'true' : 'false'"
      v-on:click="$emit('toggle', filter.id)"
    >
      {{ filter.label }}
    </button>
    <button
      v-if="hasActive"
      type="button"
      class="list-triage-clear"
      v-on:click="$emit('clear')"
    >
      Clear
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  filters: { type: Array, default: () => [] },
  active: { type: Array, default: () => [] },
});

defineEmits(["toggle", "clear"]);

function isActive(id) {
  return props.active.includes(id);
}

const hasActive = computed(() => props.active.length > 0);
</script>

<style scoped>
.list-triage-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.5rem 0;
}
.list-triage-chip,
.list-triage-clear {
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 2rem;
  background: transparent;
  color: var(--pico-color, inherit);
  padding: 0.15rem 0.7rem;
  font-size: 0.85em;
  cursor: pointer;
}
.list-triage-chip-active {
  background: var(--pico-primary-background, #3b82f6);
  border-color: var(--pico-primary-background, #3b82f6);
  color: var(--pico-primary-inverse, #fff);
}
.list-triage-clear {
  opacity: 0.7;
}
</style>
