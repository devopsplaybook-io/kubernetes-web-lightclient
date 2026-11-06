<template>
  <div v-if="pageCount > 1" class="list-pager">
    <button
      type="button"
      class="outline list-pager-step"
      :disabled="currentPage <= 1"
      v-on:click="goTo(currentPage - 1)"
    >
      Previous
    </button>
    <span class="list-pager-info">
      Page {{ currentPage }} of {{ pageCount }} ({{ total }} items)
    </span>
    <button
      type="button"
      class="outline list-pager-step"
      :disabled="currentPage >= pageCount"
      v-on:click="goTo(currentPage + 1)"
    >
      Next
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  LIST_PAGE_SIZE,
  ListPaginationService,
} from "~~/services/ListPagination";

const props = defineProps({
  typeId: { type: String, required: true },
});

const state = computed(() => ListPaginationService.getState(props.typeId));
const total = computed(() => state.value.total);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / LIST_PAGE_SIZE)),
);
const currentPage = computed(() =>
  Math.min(Math.max(1, state.value.page), pageCount.value),
);

function goTo(page) {
  ListPaginationService.setPage(props.typeId, page);
  const list = document.getElementById("object-list");
  if (list) {
    list.scrollTop = 0;
  }
}
</script>

<style scoped>
.list-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.3rem 0;
  font-size: 0.85em;
}

.list-pager-step {
  width: auto;
  margin: 0;
  padding: 0.2rem 0.8rem;
}

.list-pager-info {
  opacity: 0.8;
}
</style>
