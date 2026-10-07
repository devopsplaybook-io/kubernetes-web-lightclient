<template>
  <div>
    <h2>API Tokens</h2>
    <p>
      Tokens allow machine clients to call the API with
      <code>Authorization: Bearer</code>. A token grants the permissions of
      your account and its value is displayed only once, at creation.
    </p>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else>
      <div class="table-container" v-if="apiTokens.length > 0">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="apiToken in apiTokens" :key="apiToken.id">
              <td>{{ apiToken.name }}</td>
              <td>{{ formatDateTime(apiToken.dateCreated) }}</td>
              <td>{{ formatDateTime(apiToken.expiresAt) }}</td>
              <td>{{ formatDateTime(apiToken.lastUsedAt) }}</td>
              <td>
                <button class="secondary" v-on:click="revokeStart(apiToken)">
                  Revoke
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else>No API tokens defined.</p>

      <div class="api-token-create">
        <h3>Create a token</h3>
        <div class="api-token-create-fields">
          <label for="api-token-name">Name</label>
          <input
            id="api-token-name"
            v-model="newTokenName"
            type="text"
            maxlength="255"
            placeholder="e.g. ci-pipeline"
          />
          <label for="api-token-expiry">Expiry (optional)</label>
          <input
            id="api-token-expiry"
            v-model="newTokenExpiryDate"
            type="date"
            :min="minExpiryDate"
          />
        </div>
        <button v-on:click="createToken()" :disabled="creating || !newTokenName">
          {{ creating ? "Creating..." : "Create Token" }}
        </button>
      </div>
    </div>

    <DialogConfirm
      v-if="tokenToRevoke"
      title="Revoke API Token"
      :message="`Revoke the API token &quot;${tokenToRevoke.name}&quot;? Machine clients using it will immediately lose access.`"
      v-on:onConfirm="revokeConfirm()"
      v-on:onCancel="revokeCancel()"
    />

    <Teleport to="body">
      <dialog id="dialog-api-token-created" open v-if="createdToken">
        <article>
          <header>
            <a
              href="#close"
              aria-label="Close"
              class="close"
              v-on:click="createdTokenClose()"
            ></a>
            API Token Created
          </header>
          <p>
            Copy your token now: for security it is shown
            <strong>only once</strong> and cannot be retrieved afterwards. Use
            it with the <code>Authorization: Bearer</code> header.
          </p>
          <pre class="api-token-value">{{ createdToken.token }}</pre>
          <footer>
            <button class="secondary" v-on:click="createdTokenCopy()">
              Copy Token
            </button>
            <button v-on:click="createdTokenClose()">Done</button>
          </footer>
        </article>
      </dialog>
    </Teleport>
  </div>
</template>

<script>
import DialogConfirm from "~~/components/DialogConfirm.vue";
import { ApiTokensService } from "~~/services/ApiTokensService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  components: {
    DialogConfirm,
  },
  data() {
    return {
      apiTokens: [],
      loading: true,
      creating: false,
      newTokenName: "",
      newTokenExpiryDate: "",
      minExpiryDate: new Date().toISOString().slice(0, 10),
      tokenToRevoke: null,
      createdToken: null,
    };
  },
  async created() {
    await this.loadData();
  },
  methods: {
    async loadData() {
      this.loading = true;
      try {
        this.apiTokens = await ApiTokensService.list();
      } catch (error) {
        handleError(error);
      }
      this.loading = false;
    },
    async createToken() {
      if (!this.newTokenName) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: "Token name missing",
        });
        return;
      }
      this.creating = true;
      try {
        let expiresAt;
        if (this.newTokenExpiryDate) {
          expiresAt = new Date(
            `${this.newTokenExpiryDate}T23:59:59.000Z`,
          ).toISOString();
        }
        this.createdToken = await ApiTokensService.create(
          this.newTokenName,
          expiresAt,
        );
        this.newTokenName = "";
        this.newTokenExpiryDate = "";
        await this.loadData();
      } catch (error) {
        handleError(error);
      }
      this.creating = false;
    },
    revokeStart(apiToken) {
      this.tokenToRevoke = apiToken;
    },
    revokeCancel() {
      this.tokenToRevoke = null;
    },
    async revokeConfirm() {
      try {
        await ApiTokensService.revoke(this.tokenToRevoke.id);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: `API token "${this.tokenToRevoke.name}" revoked`,
        });
        this.tokenToRevoke = null;
        await this.loadData();
      } catch (error) {
        handleError(error);
      }
    },
    createdTokenClose() {
      this.createdToken = null;
    },
    async createdTokenCopy() {
      try {
        await navigator.clipboard.writeText(this.createdToken.token);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Token copied to clipboard",
        });
      } catch (error) {
        handleError(error);
      }
    },
    formatDateTime(value) {
      if (!value) {
        return "Never";
      }
      return new Date(value).toLocaleString();
    },
  },
};
</script>

<style scoped>
.table-container {
  overflow-x: auto;
}
.table-container table {
  width: 100%;
}
.api-token-create {
  margin-top: 1em;
}
.api-token-create h3 {
  margin-bottom: 0.5em;
}
.api-token-create-fields {
  display: grid;
  gap: 0.25em;
  max-width: 400px;
  margin-bottom: 1em;
}
.api-token-value {
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
