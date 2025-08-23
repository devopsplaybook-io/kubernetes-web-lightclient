## Kubernetes Web LightClient

Kubernetes Web LightClient is a web-based user interface for Kubernetes. In its current version, it has the following features:

- List: Deployment, StatefulSet, DaemonSet, Pod, ConfigMap, Node, Secret, PVC, Namespace
- For Pod: Delete, Display Log
- For Deployment, DaemonSet, StatefulSet: Rollout restart
- For Node: CPU and Memory information

![Pods Screenshot](docs/images/pods.png?raw=true)
![Stats Screenshot](docs/images/stats.png?raw=true)

## Installation

This client is meant to be deployed with Kubernetes. Here is an example YAML file.

**Notes:**

- Adjust the service account permissions as needed.
- `APPLICATION_TITLE` is an optional name that can be given to the instance.

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

| Parameter                                               | Description                                           | Default       | Availability                        |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------- | ----------------------------------- |
| APPLICATION_TITLE                                       | Name of the application (for PWA)                     | Kubernetes    | Environment variable                |
| STATS_FETCH_FREQUENCY                                   | Frequency (in seconds) to fetch stats from Kubernetes | 60            | Config file or environment variable |
| STATS_RETENTION                                         | Retention period (in seconds) for stats               | 86400 (1 day) | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_HTTP_TRACES                     | Hours before minute-level metrics are compressed      | (empty)       | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_HTTP_METRICS                    | Days before hour-level metrics are compressed         | (empty)       | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_HTTP_LOGS                       | OTEL collector endpoint for logs                      | (empty)       | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS    | Interval (in seconds) to export logs                  | 60            | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS | Interval (in seconds) to export metrics               | 60            | Config file or environment variable |
| OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER              | Authorization header for OTEL collection              | (empty)       | Config file or environment variable |
