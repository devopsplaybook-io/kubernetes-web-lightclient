/**
 * Client-side pagination state for the resource lists. The state is keyed by
 * list type so every list keeps its own page while navigating.
 */
import { reactive } from "vue";

export const LIST_PAGE_SIZE = 100;

export interface ListPaginationState {
  page: number;
  total: number;
}

const states = reactive<Record<string, ListPaginationState>>({});

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

function getState(typeId: string): ListPaginationState {
  if (!states[typeId]) {
    states[typeId] = { page: 1, total: 0 };
  }
  return states[typeId];
}

export const ListPaginationService = {
  getState,
  setPage(typeId: string, page: number): void {
    const state = getState(typeId);
    state.page = Math.min(
      Math.max(1, Math.floor(page)),
      pageCount(state.total),
    );
  },
  setTotal(typeId: string, total: number): void {
    const state = getState(typeId);
    state.total = Math.max(0, total);
    state.page = Math.min(state.page, pageCount(state.total));
  },
  reset(typeId: string): void {
    getState(typeId).page = 1;
  },
  resetAll(): void {
    for (const typeId of Object.keys(states)) {
      delete states[typeId];
    }
  },
};
