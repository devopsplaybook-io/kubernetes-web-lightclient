import { acceptHMRUpdate, defineStore } from "pinia";
import { AuthService } from "~~/services/AuthService";
import { hasAdminScope, hasScope, isAdminRole, type AppScope } from "~~/services/Scopes";
import { UsersService, type AppUser } from "~~/services/UsersService";
import { AuthenticationStore } from "~~/stores/AuthenticationStore";

export interface CurrentUserState {
  user: AppUser | null;
  loaded: boolean;
  loading: boolean;
  error: string;
}

export const CurrentUserStore = defineStore("CurrentUserStore", {
  state: (): CurrentUserState => ({
    user: null,
    loaded: false,
    loading: false,
    error: "",
  }),

  getters: {
    isAdmin(state): boolean {
      return isAdminRole(state.user);
    },
    hasAdminScope(state): boolean {
      return hasAdminScope(state.user);
    },
    hasScope(state) {
      return (scope: AppScope): boolean => hasScope(state.user, scope);
    },
  },

  actions: {
    setUser(user: AppUser | null): void {
      this.user = user;
      this.loaded = user !== null;
      this.error = "";
    },

    clear(): void {
      this.user = null;
      this.loaded = false;
      this.loading = false;
      this.error = "";
    },

    /**
     * Loads the live role/scopes through `/users/session/refresh` (which also
     * returns a fresh JWT). Cached until `force` is set; a single request is
     * in flight at a time.
     */
    async ensureLoaded(force: boolean = false): Promise<void> {
      const authentication = AuthenticationStore();
      if (!authentication.isAuthenticated) {
        this.clear();
        return;
      }
      if (this.loading) {
        return;
      }
      if (this.loaded && !force) {
        return;
      }

      this.loading = true;
      this.error = "";
      try {
        const result = await UsersService.refreshSession();
        if (result.token) {
          await AuthService.saveToken(result.token);
        }
        this.setUser(result.user ?? null);
      } catch (error) {
        const status = (error as { response?: { status?: number } } | null)
          ?.response?.status;
        if (status === 401) {
          this.clear();
        } else {
          this.error =
            "Your role and scopes could not be loaded. Check the server connection and retry.";
        }
      } finally {
        this.loading = false;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(CurrentUserStore, import.meta.hot));
}
