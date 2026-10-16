import { reactive } from "vue";
import { ResourceService } from "./ResourceService";
import type { ListPreference } from "./ListTriage";

const SAVE_DEBOUNCE_MS = 500;

// Module-level cache of the per-user preferences map, shared by all list
// components of the session. The map is loaded once from the selections
// endpoint and updated optimistically on every change; saves are debounced.
const state = reactive({
  loaded: false,
  preferences: {} as Record<string, ListPreference>,
});

let loadPromise: Promise<void> | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    try {
      await ResourceService.saveUserListPreferences({ ...state.preferences });
    } catch (error) {
      console.warn("Could not save list preferences", error);
    }
  }, SAVE_DEBOUNCE_MS);
}

export const ListPreferencesService = {
  /**
   * Loads the stored preferences once per session. Failures are non-fatal:
   * local state is kept and defaults are used.
   */
  ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = ResourceService.getUserListPreferences()
        .then((preferences) => {
          for (const [typeId, preference] of Object.entries(preferences)) {
            state.preferences[typeId] = preference;
          }
          state.loaded = true;
        })
        .catch((error) => {
          console.warn("Could not load list preferences", error);
          state.loaded = true;
        });
    }
    return loadPromise;
  },

  isLoaded(): boolean {
    return state.loaded;
  },

  get(typeId: string): ListPreference {
    return state.preferences[typeId] || {};
  },

  set(typeId: string, preference: ListPreference): void {
    state.preferences[typeId] = preference;
    scheduleSave();
  },
};
