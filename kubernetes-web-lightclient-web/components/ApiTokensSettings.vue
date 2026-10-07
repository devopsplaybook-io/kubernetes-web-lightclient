<template>
  <section class="settings-section">
    <h2>API Tokens</h2>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else>
      <div class="table-scroll" v-if="apiTokens.length > 0">
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
            <tr v-for="apiToken in apiTokens" :key="apiToken.id">
              <td>{{ apiToken.name }}</td>
              <td>{{ formatDateTime(apiToken.dateCreated) }}</td>
              <td>{{ formatDateTime(apiToken.expiresAt) }}</td>
              <td>{{ formatDateTime(apiToken.lastUsedAt) }}</td>
              <td>
                <i
                  class="bi bi-x-circle-fill"
                  role="button"
                  :aria-label="`Revoke API token ${apiToken.name}`"
                  v-on:click="revokeStart(apiToken)"
                ></i>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">No API tokens defined.</div>

      <h3>Create a token</h3>
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
      <button v-on:click="createToken()" :disabled="creating || !newTokenName">
        {{ creating ? "Creating..." : "Create Token" }}
      </button>
    </div>

    <DialogConfirm
      v-if="tokenToRevoke"
      title="Revoke API Token"
      :message="`Revoke the API token &quot;${tokenToRevoke.name}&quot;? Machine clients using it will immediately lose access.`"
      v-on:onConfirm="revokeConfirm()"
      v-on:onCancel="revokeCancel()"
    />

    <DialogApiTokenCreated
      v-if="createdToken"
      :token="createdToken.token"
      v-on:onClose="createdTokenClose()"
    />
  </section>
</template>

<script>
import DialogConfirm from "~~/components/DialogConfirm.vue";
import DialogApiTokenCreated from "~~/components/DialogApiTokenCreated.vue";
import { ApiTokensService } from "~~/services/ApiTokensService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  components: {
    DialogConfirm,
    DialogApiTokenCreated,
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
h3 {
  margin-top: var(--space-lg, 1.5rem);
}
.table-scroll td,
.table-scroll th {
  font-size: 0.9em;
}
@media (max-width: 600px) {
  .table-scroll td,
  .table-scroll th {
    padding-left: 0.5em;
    padding-right: 0.5em;
  }
}
.empty-state {
  text-align: center;
  padding: var(--space-xl, 2rem);
  opacity: 0.6;
}
</style>
