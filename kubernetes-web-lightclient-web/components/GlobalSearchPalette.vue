<template>
  <Teleport to="body">
    <dialog
      v-if="open"
      id="command-palette"
      open
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      v-on:click.self="close()"
    >
      <article>
        <header>
          <strong>Search</strong>
          <span class="palette-shortcut">Ctrl/Cmd+K</span>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click.prevent="close()"
          ></a>
        </header>
        <div class="palette-input">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input
            ref="input"
            v-model="query"
            type="search"
            placeholder="Search name, namespace, label, image, node or IP"
            aria-label="Search all resource types"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="palette-results"
            :aria-expanded="'true'"
            :aria-activedescendant="activeOptionId"
            v-on:input="onInput"
            v-on:keydown="onInputKeydown"
          />
        </div>
        <p v-if="!trimmedQuery" class="palette-state">
          Search across {{ searchableTypes.length }} resource type(s).
        </p>
        <div
          v-else-if="groups.length === 0 && !loading"
          class="palette-state"
        >
          No matching objects.
        </div>
        <div id="palette-results" class="palette-results" role="listbox">
          <section
            v-for="group in groups"
            :key="group.typeId"
            class="palette-group"
          >
            <h3>
              {{ group.typeName }}
              <small>{{ group.total }}</small>
            </h3>
            <button
              v-for="item in group.items"
              :id="optionId(flatItems.indexOf(item))"
              :key="`${item.typeId}/${item.namespace}/${item.name}`"
              type="button"
              role="option"
              class="palette-row"
              :class="{ active: flatItems.indexOf(item) === activeIndex }"
              :aria-selected="flatItems.indexOf(item) === activeIndex"
              v-on:click="openDetails(item)"
              v-on:mouseenter="activeIndex = flatItems.indexOf(item)"
            >
              <span class="palette-name">{{ item.name }}</span>
              <span v-if="item.namespace" class="palette-namespace">{{
                item.namespace
              }}</span>
              <span class="palette-status">{{ item.statusText }}</span>
              <span class="palette-reason">{{ reasonLabel(item.reason) }}</span>
              <i
                class="bi bi-list-ul"
                title="Open the filtered list"
                aria-label="Open the filtered list"
                v-on:click.stop="openList(item)"
              ></i>
            </button>
          </section>
        </div>
        <footer class="palette-footer">
          <span v-if="loading" class="palette-loading">Loading…</span>
          <button
            v-if="failedTypes.length > 0"
            type="button"
            class="palette-retry"
            v-on:click="retryFailed()"
          >
            {{ failedTypes.length }} type(s) failed — Retry
          </button>
          <span class="palette-help"
            >Enter details · Shift+Enter list · Esc close</span
          >
        </footer>
      </article>
    </dialog>
  </Teleport>
</template>

<script>
import { debounce } from "lodash";
import { AuthenticationStore } from "~~/stores/AuthenticationStore";
import { ResourceService } from "~~/services/ResourceService";
import { EventBus, EventTypes } from "~~/services/EventBus";
import { LoadTypesIncrementally } from "~~/services/GlobalSearchService";
import {
  PALETTE_DEBOUNCE_MS,
  PALETTE_MAX_QUERY_LENGTH,
  SearchObjects,
} from "~~/services/GlobalSearch";
import { DetailsPath, FilteredListPath } from "~~/services/ObjectLinks";
import { KubernetesObjectStore } from "~~/stores/KubernetesObjectStore";

const REASON_LABELS = {
  name: "Name",
  label: "Label",
  image: "Image",
  node: "Node",
  ip: "IP",
  namespace: "Namespace",
};

function IsEditableTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }
  return !!target.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true']",
  );
}

export default {
  data() {
    return {
      open: false,
      query: "",
      groups: [],
      loading: false,
      failedTypes: [],
      activeIndex: 0,
      types: [],
      selectedIds: null,
      _itemsByType: {},
      _searchEpoch: 0,
      _pending: 0,
      _previousFocus: null,
    };
  },
  computed: {
    trimmedQuery() {
      return (this.query || "").trim().slice(0, PALETTE_MAX_QUERY_LENGTH);
    },
    searchableTypes() {
      if (!this.selectedIds || this.selectedIds.length === 0) {
        return this.types;
      }
      return this.types.filter((type) => this.selectedIds.includes(type.id));
    },
    flatItems() {
      const items = [];
      for (const group of this.groups) {
        for (const item of group.items) {
          items.push(item);
        }
      }
      return items;
    },
    activeOptionId() {
      return this.flatItems.length > 0
        ? this.optionId(this.activeIndex)
        : undefined;
    },
  },
  mounted() {
    this._debouncedSearch = debounce(() => this.runSearch(false), PALETTE_DEBOUNCE_MS);
    this._onKeydown = (event) => this.onGlobalKeydown(event);
    this._onOpenPalette = () => this.show();
    document.addEventListener("keydown", this._onKeydown);
    EventBus.on(EventTypes.OPEN_COMMAND_PALETTE, this._onOpenPalette);
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this._onKeydown);
    EventBus.off(EventTypes.OPEN_COMMAND_PALETTE, this._onOpenPalette);
    if (this._debouncedSearch) {
      this._debouncedSearch.cancel();
    }
  },
  methods: {
    onGlobalKeydown(event) {
      if (!this.isAuthenticated()) {
        return;
      }
      const key = String(event.key || "").toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        this.show();
        return;
      }
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (this.open || IsEditableTarget(event.target)) {
          return;
        }
        if (document.querySelector("dialog[open]")) {
          return;
        }
        event.preventDefault();
        this.show();
      }
    },
    isAuthenticated() {
      try {
        return AuthenticationStore().isAuthenticated;
      } catch {
        return false;
      }
    },
    async show() {
      if (this.open) {
        this.$nextTick(() => this.$refs.input?.focus());
        return;
      }
      this._previousFocus = document.activeElement;
      this.open = true;
      this.query = "";
      this.groups = [];
      this.failedTypes = [];
      this.loading = false;
      this.activeIndex = 0;
      this._itemsByType = {};
      this._searchEpoch += 1;
      this._pending = 0;
      this.$nextTick(() => this.$refs.input?.focus());
      await this.loadCatalog();
    },
    close() {
      if (!this.open) {
        return;
      }
      this.open = false;
      if (this._debouncedSearch) {
        this._debouncedSearch.cancel();
      }
      this._searchEpoch += 1;
      const previous = this._previousFocus;
      this._previousFocus = null;
      if (previous && typeof previous.focus === "function") {
        this.$nextTick(() => previous.focus());
      }
    },
    async loadCatalog() {
      try {
        const store = KubernetesObjectStore();
        if (!store.selectedTypes || store.selectedTypes.length === 0) {
          await store.loadSelectedTypes();
        }
        this.selectedIds = [...(store.selectedTypes || [])];
      } catch {
        this.selectedIds = null;
      }
      try {
        this.types = await ResourceService.getAvailableTypes();
      } catch {
        this.types = [];
      }
    },
    onInput() {
      this.query = String(this.query || "").slice(0, PALETTE_MAX_QUERY_LENGTH);
      this.activeIndex = 0;
      if (!this.trimmedQuery) {
        this.groups = [];
        this.failedTypes = [];
        this.loading = false;
        this._searchEpoch += 1;
        this._debouncedSearch?.cancel();
        return;
      }
      this.loading = true;
      this._debouncedSearch();
    },
    async runSearch(force) {
      const query = this.trimmedQuery;
      if (!query) {
        return;
      }
      const epoch = ++this._searchEpoch;
      const types = this.searchableTypes;
      this.failedTypes = [];
      if (types.length === 0) {
        this.loading = false;
        return;
      }
      this.loading = true;
      this._pending = types.length;
      if (force) {
        this._itemsByType = {};
      }
      const finishOne = () => {
        this._pending = Math.max(0, this._pending - 1);
        if (this._pending === 0 && epoch === this._searchEpoch) {
          this.loading = false;
        }
      };
      await LoadTypesIncrementally(
        types,
        (type, items) => {
          if (epoch !== this._searchEpoch) {
            finishOne();
            return;
          }
          this._itemsByType = { ...this._itemsByType, [type.id]: items };
          this.applyResults();
          finishOne();
        },
        (type, error) => {
          if (epoch === this._searchEpoch) {
            this.failedTypes = [...this.failedTypes, type];
            void error;
          }
          finishOne();
        },
        {
          selectedIds: this.selectedIds,
          force,
        },
      );
    },
    applyResults() {
      this.groups = SearchObjects(
        { types: this.searchableTypes, itemsByType: this._itemsByType },
        this.trimmedQuery,
      );
      if (this.activeIndex >= this.flatItems.length) {
        this.activeIndex = 0;
      }
      this.scrollActiveIntoView();
    },
    scrollActiveIntoView() {
      if (!this.open) {
        return;
      }
      const id = this.activeOptionId;
      if (!id) {
        return;
      }
      this.$nextTick(() => {
        const element = document.getElementById(id);
        if (element && typeof element.scrollIntoView === "function") {
          element.scrollIntoView({ block: "nearest" });
        }
      });
    },
    onInputKeydown(event) {
      const count = this.flatItems.length;
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (count === 0) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.activeIndex = (this.activeIndex + 1) % count;
        this.scrollActiveIntoView();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.activeIndex = (this.activeIndex - 1 + count) % count;
        this.scrollActiveIntoView();
      } else if (event.key === "Home") {
        event.preventDefault();
        this.activeIndex = 0;
        this.scrollActiveIntoView();
      } else if (event.key === "End") {
        event.preventDefault();
        this.activeIndex = count - 1;
        this.scrollActiveIntoView();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = this.flatItems[this.activeIndex];
        if (!item) {
          return;
        }
        if (event.shiftKey) {
          this.openList(item);
        } else {
          this.openDetails(item);
        }
      }
    },
    optionId(index) {
      return `palette-option-${index}`;
    },
    reasonLabel(reason) {
      return REASON_LABELS[reason] || "";
    },
    async openDetails(item) {
      this.close();
      await this.$router.push(
        DetailsPath(item.typeId, item.namespace, item.name),
      );
      if (this.$route && this.$route.path === "/kubernetes") {
        EventBus.emit(EventTypes.OPEN_OBJECT_DETAILS, {});
      }
    },
    openList(item) {
      this.close();
      this.$router.push(
        FilteredListPath(item.typeId, item.namespace, item.name),
      );
    },
    retryFailed() {
      if (this.failedTypes.length === 0) {
        return;
      }
      const failed = [...this.failedTypes];
      this.failedTypes = [];
      const epoch = this._searchEpoch;
      let pending = failed.length;
      this.loading = true;
      LoadTypesIncrementally(
        failed,
        (type, items) => {
          if (epoch === this._searchEpoch) {
            this._itemsByType = { ...this._itemsByType, [type.id]: items };
            this.applyResults();
          }
          pending -= 1;
          if (pending === 0 && epoch === this._searchEpoch) {
            this.loading = false;
          }
        },
        (type) => {
          if (epoch === this._searchEpoch) {
            this.failedTypes = [...this.failedTypes, type];
          }
          pending -= 1;
          if (pending === 0 && epoch === this._searchEpoch) {
            this.loading = false;
          }
        },
        { selectedIds: null },
      );
    },
  },
};
</script>

<style scoped>
#command-palette {
  padding-top: 10vh;
}
#command-palette article {
  width: min(720px, 94vw);
  max-height: 80dvh;
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  margin: 0 auto;
  padding: 0;
}
#command-palette header {
  margin: 0;
  padding: 0.75rem 1rem;
}
#command-palette header .close {
  margin-left: 0.5rem;
}
.palette-shortcut {
  margin-left: 0.75rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 4px;
  font-size: 0.75em;
  opacity: 0.7;
}
.palette-input {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--pico-muted-border-color, #ccc);
}
.palette-input input {
  margin: 0;
  border: none;
  box-shadow: none;
  padding-left: 0;
}
.palette-state {
  margin: 0;
  padding: 1rem;
  opacity: 0.7;
}
.palette-results {
  overflow-y: auto;
  min-height: 0;
  padding: 0.25rem 0;
}
.palette-group h3 {
  margin: 0;
  padding: 0.4rem 1rem;
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
}
.palette-group h3 small {
  margin-left: 0.4rem;
}
.palette-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto auto;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  font-size: 0.9em;
  cursor: pointer;
}
.palette-row.active,
.palette-row:hover {
  background: var(--pico-secondary-background, rgba(128, 128, 128, 0.15));
}
.palette-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-namespace,
.palette-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
}
.palette-reason {
  font-size: 0.8em;
  padding: 0 0.4rem;
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 999px;
  opacity: 0.8;
}
.palette-row i {
  cursor: pointer;
}
.palette-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--pico-muted-border-color, #ccc);
  font-size: 0.8em;
}
.palette-help {
  margin-left: auto;
  opacity: 0.7;
}
@media (max-width: 640px) {
  #command-palette article {
    width: 100vw;
    max-height: 90dvh;
  }
  .palette-row {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
  }
  .palette-status,
  .palette-reason {
    display: none;
  }
  .palette-help {
    display: none;
  }
}
</style>
