## Kubernetes Web LightClient

Kubernetes Web LightClient is a web-based user interface for Kubernetes. In its current version, it has the following features:

- List: Deployment, ReplicaSet, StatefulSet, DaemonSet, Pod, Job, CronJob, Service, Ingress, NetworkPolicy, HorizontalPodAutoscaler, PodDisruptionBudget, ConfigMap, Secret, PVC, StorageClass, Node, Namespace
- Sortable list columns (name, status, age, restarts, ...) and one-click status quick-filters (pods: "Not ready" and "Restarts > 0"; events: "Warnings only"; nodes and PVs: "Has warnings")
- Per-user persisted list preferences: the active column sort and quick-filters of each list follow the user across devices via `GET/PUT /api/resources/selections` (`listPreferences` field); in a PUT body a field that is omitted (`selectedIds` or `listPreferences`) leaves the stored value unchanged
- Delete objects (configurable, see `ALLOWED_DELETABLE_OBJECTS`)
- For Pod: Display Log
- For Deployment, DaemonSet, StatefulSet: Rollout restart
- For Node: CPU and Memory information
- Read-only YAML manifest view per object: the details dialog renders `describe` and the raw manifest as YAML with a copy button
- Shareable per-object deep links: an open details or logs dialog is encoded in the URL query (`dialog`, `name`, `dialogNamespace`) so views survive a refresh and can be bookmarked
- Optional LLM Recommendations: an analysis and advice on the current cluster, generated on a schedule (default: every Monday) or on demand, displayed in the Stats section and sent to the [notifications service](https://github.com/devopsplaybook-io/notifications) when enabled; notifications are sent with source `kubernetes-web-lightclient` suffixed with the normalized application name (e.g. `kubernetes-web-lightclient-kubernetes`) when `APPLICATION_TITLE` is set
- Shared web UI with persisted theme preferences, accessible alerts and loading indicators, and offline status

![Pods Screenshot](docs/images/pods.png?raw=true)
![Stats Screenshot](docs/images/stats.png?raw=true)

## Installation

This client is meant to be deployed with Kubernetes. Here is an example YAML file.

**Notes:**

- The service account is bound to the scoped ClusterRole `kubernetes-web-lightclient-role` shipped in [rbac.yaml](docs/deployments/kubernetes/kubernetes-web-lightclient/base/rbac.yaml); adjust its rules as needed.
- `APPLICATION_TITLE` is an optional name that can be given to the instance.
- For the Stats page to be fully functional (CPU/memory usage metrics), the [Kubernetes Metrics Server](https://github.com/kubernetes-sigs/metrics-server) must be installed in the cluster.

To launch the application in Kubernetes with the default configuration:

```bash
git clone https://github.com/devopsplaybook-io/kubernetes-web-lightclient
cd kubernetes-web-lightclient/docs/deployments/kubernetes/kubernetes-web-lightclient
kubectl kustomize . | kubectl apply -f -
```

To launch the application with the service exposed as a NodePort (for local cluster access):

```bash
git clone https://github.com/devopsplaybook-io/kubernetes-web-lightclient
cd kubernetes-web-lightclient/docs/deployments/kubernetes/kubernetes-web-lightclient-nodeports
kubectl kustomize . | kubectl apply -f -
```

## Configuration

Configuration can be provided via a JSON configuration file (using the ConfigMap) or environment variables.

See the [ConfigMap YAML](docs/deployments/kubernetes/kubernetes-web-lightclient/base/configmap.yaml) for an example configuration.

| Parameter                                               | Description                                                                                                           | Default       | Availability                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------- |
| APPLICATION_TITLE                                       | Name of the application (for PWA and as suffix of the notification source)                                            | Kubernetes    | Environment variable                |
| ALLOWED_DELETABLE_OBJECTS                               | Object types that can be deleted: `NONE`, `ALL`, or a comma-separated list of object types (e.g. `pod`, `deployment`) | pod           | Config file or environment variable |
| STATS_FETCH_FREQUENCY                                   | Frequency (in seconds) to fetch stats from Kubernetes                                                                 | 60            | Config file or environment variable |
| STATS_RETENTION                                         | Retention period (in seconds) for stats                                                                               | 86400 (1 day) | Config file or environment variable |
| POD_RESOURCES_FETCH_FREQUENCY                           | Frequency (in seconds) to refresh pod requests/limits                                                                 | 1800          | Config file or environment variable |
| CACHE_TTL                                               | Time (in milliseconds) a cached resource listing stays fresh                                                          | 30000         | Config file or environment variable |
| REQUEST_QUEUE_CONCURRENCY                               | Maximum number of concurrent Kubernetes requests                                                                      | 2             | Config file or environment variable |
| REQUEST_QUEUE_MAX_LENGTH                                | Maximum number of Kubernetes requests waiting in the queue; further requests get `429`                                 | 20            | Config file or environment variable |
| REQUEST_TIMEOUT                                         | Timeout (in milliseconds) for a Kubernetes request, counted from the moment it is queued                              | 20000         | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_HTTP_TRACES                     | OTEL collector endpoint for traces                                                                                    | (empty)       | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_HTTP_METRICS                    | OTEL collector endpoint for metrics                                                                                   | (empty)       | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_HTTP_LOGS                       | OTEL collector endpoint for logs                                                                                      | (empty)       | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS    | Interval (in seconds) to export logs                                                                                  | 60            | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS | Interval (in seconds) to export metrics                                                                               | 60            | Config file or environment variable |
| OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER              | Authorization header for OTEL collection                                                                              | (empty)       | Config file or environment variable |
| LLM_RECOMMENDATIONS_ENABLED                             | Enable LLM recommendations on the Stats page                                                                          | false         | Config file or environment variable |
| LLM_API_KEY                                             | API key of the OpenAI-compatible LLM provider                                                                         | (empty)       | Config file or environment variable |
| LLM_API_URL                                             | Chat completions endpoint of the LLM provider                                                                         | https://api.deepseek.com/chat/completions | Config file or environment variable |
| LLM_MODEL                                               | LLM model to use for recommendations                                                                                  | deepseek-chat | Config file or environment variable |
| LLM_RECOMMENDATIONS_CRON                                | Cron schedule for generating recommendations                                                                          | 0 8 * * 1 (every Monday at 08:00) | Config file or environment variable |
| NOTIFICATIONS_API                                      | Notifications service API endpoint (e.g. `https://notifications.example.com/api/notifications`)                       | (empty)       | Config file or environment variable |
| NOTIFICATIONS_TOKEN                                    | Notifications service API token                                                                                       | (empty)       | Config file or environment variable |
| API_TOKENS_MAX_PER_USER                                | Maximum number of API tokens per user                                                                                 | 100           | Config file or environment variable |
| API_TOKENS_REVOKE_ON_PASSWORD_CHANGE                   | Revoke every API token when a user changes their password                                                              | false         | Config file or environment variable |
| JWT_KEY                                                | Signing key for JWT sessions. Empty means database-managed: a random key is generated once and stored in `metadata.auth_token`. A non-empty value must be random, at least 32 characters and not a known weak value; keep it in a Secret. Changing it invalidates all JWT sessions. | (empty) | Config file or environment variable |
| JWT_VALIDITY_DURATION                                  | JWT session validity, in seconds                                                                                       | 8035200 (93 days) | Config file or environment variable |
| JWT_REVOCATION_ENABLED                                 | Reject JWTs issued before a password/role/scope change (requires the `users.tokenVersion` migration)                   | false         | Config file or environment variable |
| PASSWORD_MIN_LENGTH                                    | Minimum password length (`0` accepts any non-empty password)                                                          | 0             | Config file or environment variable |
| AUTH_RATE_LIMIT_LOGIN_MAX                              | Login attempts allowed per rate-limit window (`<= 0` disables)                                                        | 10            | Config file or environment variable |
| AUTH_RATE_LIMIT_REFRESH_MAX                            | Session refreshes allowed per rate-limit window (`<= 0` disables)                                                     | 60            | Config file or environment variable |
| AUTH_RATE_LIMIT_WINDOW_SECONDS                         | Rate-limit window, in seconds                                                                                         | 60            | Config file or environment variable |
| CORS_POLICY_ORIGIN                                     | Comma-separated list of browser origins allowed to call the API. Empty emits no CORS headers (same-origin UI only); `*` allows any origin and is insecure | (empty) | Config file or environment variable |

Changes to the configuration file are applied without restarting the process: stats capture intervals, the request queue settings and the LLM recommendation clients/cron schedule are re-armed when the file is reloaded.

`GET /api/ready` is a public readiness endpoint: it returns `200 {"ready":true}` once the first stats capture has completed (or its 5-second deadline expired) and `503 {"ready":false}` before that. `GET /api/status` keeps returning `{"started":true}` as soon as the listener is up.

## Authentication

Two authentication methods are supported on all `/api/*` routes:

- **JWT sessions** for human users through the web UI: login via `POST /api/users/session` and pass the returned token as `Authorization: Bearer <jwt>`. This is what the web UI itself uses; nothing changed for existing users.
- **API tokens** for machine clients (scripts, agents, integrations): pass a user-scoped token as `Authorization: Bearer <api-token>`. API tokens are an addition, not a replacement: JWT sessions keep working unchanged.

API tokens are managed self-service, either in the web UI (Settings → API Tokens) or through the REST endpoints (authenticated with a JWT session):

- `POST /api/users/tokens` with body `{"name": "my-machine-client"}` (optional `"expiresAt"`: ISO 8601 datetime in the future) creates a token. The plaintext token is returned **exactly once** in the response field `token` — store it immediately, it cannot be retrieved afterwards.
- `GET /api/users/tokens` lists the tokens of the authenticated user (name, creation date, expiry, last-used; never the token itself or its hash).
- `DELETE /api/users/tokens/:id` revokes a token (owner or admin). Revocation takes effect immediately.

Security properties:

- Only the SHA-256 hash of a token is stored; plaintext tokens are never logged or persisted.
- A token grants exactly the permissions of its owning user. The live role and scopes are resolved from the database on every request, so a role or scope change applies to existing tokens and sessions immediately.
- Expired (`expiresAt` in the past) and revoked tokens are rejected immediately.
- The number of tokens per user is capped by `API_TOKENS_MAX_PER_USER` (default: 100).

### Roles and scopes

Every application API route enforces the live role and scopes of the authenticated user and fails closed when they are missing. The `admin` role bypasses scope checks; a `user` must hold the scope required by the route. The `admin` scope grants admin-only routes to a non-admin user without granting the role itself.

| Scope        | Grants                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `k8s:read`   | List resources (`/api/resources/*`), read pod logs, and run `get`/`describe` kubectl commands   |
| `k8s:write`  | `rollout restart`, `scale` and `create` kubectl commands                                       |
| `stats:read` | Read the stats endpoints (`/api/stats/nodes`, `pod-resources`, `pod-usage`, `recommendation`)    |
| `admin`      | Admin-only routes: `POST /api/resources/refresh`, `POST /api/stats/recommendation/regenerate`, kubectl `delete` |

Users created through the web UI start with role `user` and no scopes: an admin must grant them with `PUT /api/users/:id` and body `{"scopes":["k8s:read","stats:read"]}` (add `k8s:write` where mutations are needed). Users created before the role/scope migration default to the `admin` role. Only `/api/status`, the static web UI and the user-management endpoints (admin-only, with self-service session/password/token routes) are reachable without an application scope.

### CORS

`CORS_POLICY_ORIGIN` is empty by default: no `Access-Control-Allow-Origin` header is emitted, so only same-origin browser clients (the bundled web UI) can call the API. For a cross-origin client, set an explicit comma-separated allowlist, e.g. `https://k8s.example.com`. A literal `*` is accepted for compatibility but allows any origin to read API responses.

Example: query a pod with a machine client:

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"object":"pod","command":"get","namespace":"default","argument":"my-pod"}' \
  https://<instance>/api/kubectl/command
```

## Command API

The kubectl command API exposes a strictly validated, read-only-by-default subset of kubectl. Both routes accept and return JSON; results are gzip-compressed and base64-encoded in the `result` field.

### `POST /api/kubectl/command`

Payload schema:

| Field       | Type    | Required | Description                                                                 |
| ----------- | ------- | -------- | --------------------------------------------------------------------------- |
| `command`   | string  | yes      | One of the allowed commands below                                           |
| `object`    | string  | yes      | A known resource type id (built-ins and scanned CRDs, e.g. `pod`)           |
| `namespace` | string  | no       | Target namespace; omit for cluster-scoped objects                           |
| `argument`  | string  | depends  | Command-specific, see the table below                                       |
| `noJson`    | boolean | no       | When `true`, `get` returns kubectl's default text output instead of `-o json` |

Allowed commands and their argument shape:

| Command            | Argument shape                                  | Example                                     | Required scope |
| ------------------ | ----------------------------------------------- | ------------------------------------------- | -------------- |
| `get`              | `""` (list), `"-A"` (all namespaces), or a name | `"my-pod"`                                  | `k8s:read`     |
| `describe`         | an object name                                  | `"my-pod"`                                  | `k8s:read`     |
| `delete`           | an object name                                  | `"my-pod"` (subject to the delete policy)   | `admin`        |
| `rollout restart`  | an object name                                  | `"my-deployment"`                           | `k8s:write`    |
| `scale`            | `<name> --replicas=<n>`                         | `"my-deployment --replicas=3"`              | `k8s:write`    |
| `create`           | `--from=cronjob/<cronjob> <jobname>` on `job`   | `"--from=cronjob/my-cron my-job"`           | `k8s:write`    |

Response envelope (success): `201` with `{"result": "<gzip+base64 output>"}`.

### `POST /api/kubectl/logs`

Payload schema: `namespace` (required), `pod` (required), `container` (optional), `argument` (optional string of `--previous` and/or `--since=10m|1h|24h`), `timestamps` (optional boolean, default `true`). Requires the `k8s:read` scope. Log output is bounded: the server always requests the last 5,000 lines (`--tail=5000`).

### Resource selections

`GET /api/resources/selections` returns the user's selected resource types and list preferences. `PUT /api/resources/selections` updates them: `selectedIds` and `listPreferences` are independent, and a field omitted from the body keeps its stored value. `POST /api/resources/selections` is an alias of `PUT`. A body without either field (including no body at all) returns `400`. All three routes require the `k8s:read` scope.

### Error responses

- `401` `{"error":"Unauthorized"}` — missing, expired or invalid credentials.
- `400` `{"error":"...","field":"..."}` — the request was rejected by validation. `field` names the rejected payload field (`command`, `object`, `namespace`, `argument`, `pod`, `container` or `payload`) and `error` says why, e.g. `{"error":"unknown resource type \"secretx\"","field":"object"}` or `{"error":"invalid scale argument \"my-deployment\", expected <name> --replicas=<n>","field":"argument"}`.
- `403` `{"error":"Access Denied","code":"FORBIDDEN"}` — the authenticated user lacks the scope required by the route.
- `403` `{"error":"Deletion of <type> objects is not allowed"}` — the delete policy (`ALLOWED_DELETABLE_OBJECTS`) refused a `delete`.
- `404` `{"error":"This object no longer exists — ..."}` — the object vanished between listing and the request.
- `429` `{"error":"Server is busy, please retry","requestId":"..."}` — the Kubernetes request queue is full (`REQUEST_QUEUE_MAX_LENGTH`); retry later. A CRD refresh already running returns `429` `{"error":"A CRD scan is already in progress"}`.
- `502` `{"error":"kubectl command failed","requestId":"..."}` / `{"error":"kubectl logs failed","requestId":"..."}` — kubectl failed; the details are logged server-side under the same request id.
- `503` `{"error":"Failed to fetch resource data","requestId":"..."}` — the resource listing could not be fetched; the details are logged server-side.

5xx responses never include internal error text. Use the `requestId` to correlate with the server logs.

Worked example (success and a rejected request):

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"object":"secretx","command":"get"}' \
  https://<instance>/api/kubectl/command
# 400 {"error":"unknown resource type \"secretx\"","field":"object"}

curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"object":"pod","command":"get","namespace":"default","argument":"my-pod"}' \
  https://<instance>/api/kubectl/command
# 201 {"result":"<gzip+base64 pod manifest>"}
```

## Upgrading from a release shipping the default JWT key

- The image no longer ships a default `JWT_KEY`. When none is configured, the signing key becomes the random value stored in `metadata.auth_token` (already present in existing SQLite deployments, which therefore keep working without configuration). JWTs previously signed with the shipped `dev` literal become invalid: users must log in again. API tokens are unaffected (they are hashed, not JWTs).
- A configured `JWT_KEY` that is empty, a known weak value (for example `dev`) or shorter than 32 characters now fails startup with a clear log message. Generate a random key with `openssl rand -hex 32` and store it in a Secret, or remove the setting to use the database-managed key.
- Non-admin users are denied until an admin grants scopes with `PUT /api/users/:id` and body `{"scopes":[...]}`. Users created before the role/scope migration default to the `admin` role and keep full access.
- Cross-origin browser clients must set `CORS_POLICY_ORIGIN` explicitly; the bundled same-origin UI needs no configuration.
- If a Postgres deployment is used, `metadata.value` must be `TEXT` (not `INTEGER`) before relying on the database-managed key; otherwise keep an explicit strong `JWT_KEY`.
