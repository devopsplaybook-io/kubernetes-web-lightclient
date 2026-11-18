<template>
  <section class="settings-section users-settings">
    <h2>Users</h2>
    <p>
      Manage who can sign in and what they can do. New users keep exactly the
      role and scopes chosen here.
    </p>

    <AccessDeniedPanel
      v-if="!isAdmin"
      scope="admin role"
      title="Administrator role required"
      message="Only users with the administrator role can manage users."
    />

    <template v-else>
      <Loading v-if="loading" />

      <AccessDeniedPanel
        v-else-if="accessError"
        :scope="accessError.scope || ''"
        :title="accessError.title"
        :message="accessError.message"
        v-on:retry="loadUsers()"
      />

      <div v-else-if="loadError" class="users-load-error">
        <p>{{ loadError }}</p>
        <button type="button" class="secondary" v-on:click="loadUsers()">
          Retry
        </button>
      </div>

      <template v-else>
        <p v-if="actionError" class="users-action-error" role="alert">
          {{ actionError.message }}
        </p>

        <div v-if="passwordTarget" class="password-reset">
          <h3>Reset password for {{ passwordTarget.name }}</h3>
          <label for="reset-password">New password</label>
          <input
            id="reset-password"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
          />
          <div class="password-reset-actions">
            <button type="button" v-on:click="requestPasswordReset()">
              Continue
            </button>
            <button
              type="button"
              class="secondary"
              v-on:click="cancelPasswordReset()"
            >
              Cancel
            </button>
          </div>
        </div>

        <div v-if="users.length === 0" class="users-empty">
          No users found.
        </div>
        <div v-else class="user-list">
          <article
            v-for="user in users"
            :key="user.id"
            class="user-card"
            :class="{ 'is-self': user.id === currentUserId }"
          >
            <header class="user-card-header">
              <strong>{{ user.name }}</strong>
              <span v-if="user.id === currentUserId" class="user-you">You</span>
            </header>

            <div class="user-fields">
              <div class="user-field">
                <label :for="`role-${user.id}`">Role</label>
                <select
                  :id="`role-${user.id}`"
                  v-model="draftFor(user).role"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>

              <div class="user-field user-scopes">
                <span class="user-field-label">Scopes</span>
                <label
                  v-for="scope in scopeDefinitions"
                  :key="scope.id"
                  class="scope-checkbox"
                  :title="scope.description"
                >
                  <input
                    type="checkbox"
                    :value="scope.id"
                    v-model="draftFor(user).scopes"
                  />
                  <code>{{ scope.id }}</code>
                </label>
              </div>

              <div class="user-actions">
                <button
                  type="button"
                  :disabled="savingUserId === user.id || !isDirty(user)"
                  v-on:click="requestSave(user)"
                >
                  {{ savingUserId === user.id ? "Saving..." : "Save" }}
                </button>
                <button
                  type="button"
                  class="secondary"
                  v-on:click="startPasswordReset(user)"
                >
                  Reset password
                </button>
                <button
                  v-if="user.id !== currentUserId"
                  type="button"
                  class="secondary user-delete"
                  v-on:click="requestDelete(user)"
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
        </div>

        <h3>Create a user</h3>
        <div class="create-user">
          <div class="user-field">
            <label for="new-user-name">Name</label>
            <input
              id="new-user-name"
              v-model="newUser.name"
              type="text"
              autocomplete="off"
            />
          </div>
          <div class="user-field">
            <label for="new-user-password">Password</label>
            <input
              id="new-user-password"
              v-model="newUser.password"
              type="password"
              autocomplete="new-password"
            />
          </div>
          <div class="user-field">
            <label for="new-user-role">Role</label>
            <select id="new-user-role" v-model="newUser.role">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div class="user-field user-scopes">
            <span class="user-field-label">Scopes</span>
            <label
              v-for="scope in scopeDefinitions"
              :key="scope.id"
              class="scope-checkbox"
              :title="scope.description"
            >
              <input
                type="checkbox"
                :value="scope.id"
                v-model="newUser.scopes"
              />
              <code>{{ scope.id }}</code>
            </label>
          </div>
          <div class="create-user-actions">
            <button type="button" :disabled="creating" v-on:click="createUser()">
              {{ creating ? "Creating..." : "Create user" }}
            </button>
          </div>
        </div>
      </template>

      <h3>Your API tokens</h3>
      <p class="users-hint">
        Only your own token metadata is shown (token values are never displayed).
        Deleting a user revokes all of their API tokens server-side.
      </p>

      <Loading v-if="tokensLoading" />
      <p v-else-if="tokensError" class="users-load-error" role="alert">
        {{ tokensError }}
      </p>
      <div v-else-if="tokens.length === 0" class="users-empty">
        No API tokens defined.
      </div>
      <div v-else class="table-scroll">
        <table class="striped">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in tokens" :key="token.id">
              <td>{{ token.name }}</td>
              <td>{{ formatDateTime(token.dateCreated) }}</td>
              <td>{{ formatDateTime(token.expiresAt) }}</td>
              <td>{{ formatDateTime(token.lastUsedAt) }}</td>
              <td>
                <i
                  class="bi bi-x-circle-fill"
                  role="button"
                  :aria-label="`Revoke API token ${token.name}`"
                  v-on:click="tokenToRevoke = token"
                ></i>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <DialogConfirm
      v-if="pendingEdit"
      title="Update user"
      :message="editMessage"
      v-on:onConfirm="confirmSave()"
      v-on:onCancel="pendingEdit = null"
    />
    <DialogConfirm
      v-if="pendingPassword"
      title="Reset password"
      :message="`Set a new password for &quot;${pendingPassword.user.name}&quot;? The current password stops working immediately.`"
      v-on:onConfirm="confirmPasswordReset()"
      v-on:onCancel="pendingPassword = null"
    />
    <DialogConfirm
      v-if="deleteTarget"
      title="Delete user"
      :message="`Delete &quot;${deleteTarget.name}&quot;? This also revokes their API tokens and cannot be undone.`"
      v-on:onConfirm="confirmDelete()"
      v-on:onCancel="deleteTarget = null"
    />
    <DialogConfirm
      v-if="tokenToRevoke"
      title="Revoke API Token"
      :message="`Revoke the API token &quot;${tokenToRevoke.name}&quot;? Machine clients using it will immediately lose access.`"
      v-on:onConfirm="confirmRevokeToken()"
      v-on:onCancel="tokenToRevoke = null"
    />
  </section>
</template>

<script>
import Loading from "@devopsplaybook.io/common-web/components/Loading.vue";
import AccessDeniedPanel from "~~/components/AccessDeniedPanel.vue";
import DialogConfirm from "~~/components/DialogConfirm.vue";
import { ApiTokensService } from "~~/services/ApiTokensService";
import { EventBus, EventTypes, handleError } from "~~/services/EventBus";
import { permissionDenialForError } from "~~/services/PermissionErrors";
import { SCOPE_DEFINITIONS, normalizeScopes } from "~~/services/Scopes";
import { UsersService } from "~~/services/UsersService";
import { CurrentUserStore } from "~~/stores/CurrentUserStore";

function emptyNewUser() {
  return { name: "", password: "", role: "user", scopes: [] };
}

function grantedScopes(scopes) {
  return new Set(normalizeScopes(scopes));
}

function sameScopes(left, right) {
  const a = grantedScopes(left);
  const b = grantedScopes(right);
  return a.size === b.size && [...a].every((scope) => b.has(scope));
}

export default {
  components: {
    Loading,
    AccessDeniedPanel,
    DialogConfirm,
  },
  data() {
    return {
      loading: true,
      loadError: "",
      accessError: null,
      actionError: null,
      users: [],
      drafts: {},
      currentUserId: null,
      savingUserId: "",
      creating: false,
      newUser: emptyNewUser(),
      passwordTarget: null,
      newPassword: "",
      pendingPassword: null,
      pendingEdit: null,
      deleteTarget: null,
      tokens: [],
      tokensLoading: true,
      tokensError: "",
      tokenToRevoke: null,
      scopeDefinitions: SCOPE_DEFINITIONS,
    };
  },
  computed: {
    isAdmin() {
      return CurrentUserStore().isAdmin;
    },
    editMessage() {
      if (!this.pendingEdit) {
        return "";
      }
      const { user, changes } = this.pendingEdit;
      const parts = [];
      if (user.role !== changes.role) {
        parts.push(`role ${user.role} → ${changes.role}`);
      }
      if (!sameScopes(user.scopes, changes.scopes)) {
        parts.push(
          `scopes: ${changes.scopes.length > 0 ? changes.scopes.join(", ") : "none"}`,
        );
      }
      const who =
        user.id === this.currentUserId ? "your own account" : `"${user.name}"`;
      return `Update ${who}? ${parts.join("; ")}.`;
    },
  },
  async created() {
    this.currentUserId = CurrentUserStore().user?.id ?? null;
    if (!this.isAdmin) {
      this.loading = false;
      this.tokensLoading = false;
      return;
    }
    await Promise.all([this.loadUsers(), this.loadTokens()]);
  },
  methods: {
    draftFor(user) {
      if (!this.drafts[user.id]) {
        this.drafts[user.id] = {
          role: user.role === "admin" ? "admin" : "user",
          scopes: normalizeScopes(user.scopes),
        };
      }
      return this.drafts[user.id];
    },
    isDirty(user) {
      const draft = this.drafts[user.id];
      if (!draft) {
        return false;
      }
      const role = user.role === "admin" ? "admin" : "user";
      return draft.role !== role || !sameScopes(user.scopes, draft.scopes);
    },
    async loadUsers() {
      this.loading = true;
      this.loadError = "";
      this.accessError = null;
      try {
        const users = await UsersService.list();
        this.users = users;
        this.drafts = {};
        for (const user of users) {
          this.drafts[user.id] = {
            role: user.role === "admin" ? "admin" : "user",
            scopes: normalizeScopes(user.scopes),
          };
        }
        this.currentUserId =
          CurrentUserStore().user?.id ?? this.currentUserId;
      } catch (error) {
        const denial = permissionDenialForError(error);
        if (denial) {
          this.accessError = denial;
        } else {
          this.loadError = "Unable to load the users. Check the server connection and retry.";
        }
      } finally {
        this.loading = false;
      }
    },
    async loadTokens() {
      this.tokensLoading = true;
      this.tokensError = "";
      try {
        this.tokens = await ApiTokensService.list();
      } catch (error) {
        const denial = permissionDenialForError(error);
        this.tokensError = denial
          ? denial.message
          : "Unable to load your API tokens.";
      } finally {
        this.tokensLoading = false;
      }
    },
    handleActionError(error) {
      const denial = permissionDenialForError(error);
      if (denial) {
        this.actionError = denial;
        return;
      }
      handleError(error);
    },
    async requestSave(user) {
      if (!this.isDirty(user)) {
        return;
      }
      const draft = this.draftFor(user);
      const changes = { role: draft.role, scopes: [...draft.scopes] };
      const before = grantedScopes(user.scopes);
      const removesAdmin =
        (user.role === "admin" && changes.role !== "admin") ||
        (before.has("admin") && !changes.scopes.includes("admin"));
      if (user.id === this.currentUserId || removesAdmin) {
        this.pendingEdit = { user, changes };
        return;
      }
      await this.saveUser(user, changes);
    },
    async confirmSave() {
      const pending = this.pendingEdit;
      this.pendingEdit = null;
      if (pending) {
        await this.saveUser(pending.user, pending.changes);
      }
    },
    async saveUser(user, changes) {
      this.savingUserId = user.id;
      this.actionError = null;
      try {
        await UsersService.update(user.id, changes);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: `User "${user.name}" updated`,
        });
        await this.loadUsers();
        if (user.id === this.currentUserId) {
          await this.refreshSelf();
        }
      } catch (error) {
        this.handleActionError(error);
      } finally {
        this.savingUserId = "";
      }
    },
    async refreshSelf() {
      await CurrentUserStore().ensureLoaded(true);
      if (!CurrentUserStore().isAdmin && this.$router) {
        this.$router.replace({
          path: "/settings",
          query: { ...this.$route?.query, tab: "profile" },
        });
      }
    },
    async createUser() {
      if (!this.newUser.name || !this.newUser.password) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Name or password missing",
        });
        return;
      }
      this.creating = true;
      this.actionError = null;
      try {
        await UsersService.create({
          name: this.newUser.name.trim(),
          password: this.newUser.password,
          role: this.newUser.role,
          scopes: [...this.newUser.scopes],
        });
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "User created",
        });
        this.newUser = emptyNewUser();
        await this.loadUsers();
      } catch (error) {
        this.handleActionError(error);
      } finally {
        this.creating = false;
      }
    },
    startPasswordReset(user) {
      this.passwordTarget = user;
      this.newPassword = "";
    },
    cancelPasswordReset() {
      this.passwordTarget = null;
      this.newPassword = "";
    },
    requestPasswordReset() {
      if (!this.newPassword) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Password missing",
        });
        return;
      }
      this.pendingPassword = {
        user: this.passwordTarget,
        password: this.newPassword,
      };
      this.passwordTarget = null;
      this.newPassword = "";
    },
    async confirmPasswordReset() {
      const pending = this.pendingPassword;
      this.pendingPassword = null;
      if (!pending) {
        return;
      }
      this.actionError = null;
      try {
        await UsersService.update(pending.user.id, {
          password: pending.password,
        });
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: `Password reset for "${pending.user.name}"`,
        });
        await this.loadUsers();
      } catch (error) {
        this.handleActionError(error);
      }
    },
    requestDelete(user) {
      this.deleteTarget = user;
    },
    async confirmDelete() {
      const user = this.deleteTarget;
      this.deleteTarget = null;
      if (!user) {
        return;
      }
      this.actionError = null;
      try {
        await UsersService.remove(user.id);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: `User "${user.name}" deleted`,
        });
        await this.loadUsers();
        if (user.id === this.currentUserId) {
          await this.refreshSelf();
        }
      } catch (error) {
        this.handleActionError(error);
      }
    },
    async confirmRevokeToken() {
      const token = this.tokenToRevoke;
      this.tokenToRevoke = null;
      if (!token) {
        return;
      }
      try {
        await ApiTokensService.revoke(token.id);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: `API token "${token.name}" revoked`,
        });
        await this.loadTokens();
      } catch (error) {
        this.handleActionError(error);
      }
    },
    formatDateTime(value) {
      if (!value) {
        return "Never";
      }
      return new Date(value).toLocaleDateString();
    },
  },
};
</script>

<style scoped>
.users-settings h3 {
  margin-top: var(--space-lg, 1.5rem);
}
.users-hint {
  font-size: 0.9em;
  opacity: 0.75;
}
.users-load-error,
.users-action-error {
  border-left: 4px solid var(--pico-del-color, #c62828);
  padding: 0.5em 1em;
  margin: 0.5em 0;
}
.users-load-error button {
  width: auto;
  margin: 0;
}
.users-empty {
  text-align: center;
  padding: var(--space-xl, 2rem);
  opacity: 0.6;
}
.user-list {
  display: grid;
  gap: 0.75em;
}
.user-card {
  margin: 0;
  padding: 1em;
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 0.5em;
}
.user-card.is-self {
  border-color: var(--pico-primary, #3cabff);
}
.user-card-header {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-bottom: 0.75em;
}
.user-you {
  font-size: 0.75em;
  padding: 0.1em 0.5em;
  border-radius: 1em;
  border: 1px solid var(--pico-primary, #3cabff);
  color: var(--pico-primary, #3cabff);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.user-fields {
  display: grid;
  grid-template-columns: minmax(10rem, 14rem) 1fr;
  gap: 0.75em 1.5em;
  align-items: start;
}
.user-field {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
}
.user-field label,
.user-field-label {
  font-size: 0.85em;
  margin-bottom: 0;
  opacity: 0.8;
}
.user-field input,
.user-field select {
  margin-bottom: 0;
}
.user-scopes {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5em 1em;
}
.user-scopes .user-field-label {
  flex-basis: 100%;
}
.scope-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  margin: 0;
  cursor: pointer;
}
.scope-checkbox input {
  margin: 0;
}
.scope-checkbox code {
  font-size: 0.85em;
}
.user-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
}
.user-actions button {
  width: auto;
  margin: 0;
}
.create-user {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75em 1.5em;
  padding: 1em;
  border: 1px solid var(--pico-muted-border-color, #ccc);
  border-radius: 0.5em;
}
.create-user .user-scopes {
  grid-column: 1 / -1;
}
.create-user-actions {
  grid-column: 1 / -1;
}
.create-user-actions button {
  width: auto;
  margin: 0;
}
.password-reset {
  padding: 1em;
  margin: 0.5em 0;
  border: 1px solid var(--pico-primary, #3cabff);
  border-radius: 0.5em;
}
.password-reset h3 {
  margin-top: 0;
}
.password-reset-actions {
  display: flex;
  gap: 0.5em;
}
.password-reset-actions button {
  width: auto;
  margin: 0;
}
.table-scroll {
  overflow-x: auto;
  width: 100%;
}
.table-scroll td,
.table-scroll th {
  font-size: 0.9em;
}
@media (max-width: 720px) {
  .user-fields {
    grid-template-columns: 1fr;
  }
  .user-scopes {
    flex-direction: row;
  }
}
</style>
