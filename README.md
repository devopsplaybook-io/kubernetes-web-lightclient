## Kubernetes Web LightClient

Kubernetes Web LightClient is a web-based user interface for Kubernetes. In its current version, it has the following features:

- List: Deployment, StatefulSet, DaemonSet, Pod, ConfigMap, Node, Secret, PVC, Namespace
- Delete objects (configurable, see `ALLOWED_DELETABLE_OBJECTS`)
- For Pod: Display Log
- For Deployment, DaemonSet, StatefulSet: Rollout restart
- For Node: CPU and Memory information
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
| REQUEST_TIMEOUT                                         | Timeout (in milliseconds) for a Kubernetes request                                                                    | 20000         | Config file or environment variable |
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
- A token grants exactly the permissions of its owning user (role and scopes are resolved live on every request): revoking a role instantly narrows the token.
- Expired (`expiresAt` in the past) and revoked tokens are rejected immediately.
- The number of tokens per user is capped by `API_TOKENS_MAX_PER_USER` (default: 100).

Example: query a pod with a machine client:

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"object":"pod","command":"get","namespace":"default","argument":"my-pod"}' \
  https://<instance>/api/kubectl/command
```
