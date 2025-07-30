# Kubernetes Web LightClient

Kubernetes Web LightClient is a web based user interface for Kubernetes. In it's current version it has the following features:

- List: Deployment, StatefulSet, DeamonSet, Pod, ConfigMap, Nodes, Secrets, PVC, Namespace
- For Pod: Delete, Display Log.
- For Deployments, DaemonSet, Statefulset: Rollout restart.

![](docs/images/pods.png?raw=true)

![](docs/images/stats.png?raw=true)

# Installation

This client is meant to be deployed with Kubenertes. Here is an example of YAML file:
Notes:

- Adjust the service account to the permission that you need
- APPLICATION_TITLE is an optional name that can be given for the instance

```yaml
kind: Namespace
apiVersion: v1
metadata:
  name: kubernetes-web-lightclient
  labels:
    name: kubernetes-web-lightclient
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubernetes-web-lightclient
  labels:
    app: kubernetes-web-lightclient
spec:
  replicas: 1
  revisionHistoryLimit: 1
  selector:
    matchLabels:
      app: kubernetes-web-lightclient
  template:
    metadata:
      labels:
        app: kubernetes-web-lightclient
    spec:
      serviceAccountName: kubernetes-web-lightclient-role
      containers:
        - image: devopsplaybookio/kubernetes-web-lightclient
          name: kubernetes-web-lightclient
          imagePullPolicy: Always
          env:
            - name: APPLICATION_TITLE
              value: Home Kubernetes
          ports:
            - containerPort: 8080
          resources:
            limits:
              memory: 500Mi
              cpu: 500m
            requests:
              memory: 100Mi
              cpu: 100m
          volumeMounts:
            - mountPath: /data
              name: pod-volume
          readinessProbe:
            httpGet:
              path: /api/status
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
      volumes:
        - name: pod-volume
          persistentVolumeClaim:
            claimName: kubernetes-web-lightclient
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: kubernetes-web-lightclient
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
kind: ClusterRoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: kubernetes-web-lightclient-role
subjects:
  - kind: ServiceAccount
    name: kubernetes-web-lightclient-role
    namespace: kubernetes-web-lightclient
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kubernetes-web-lightclient-role
---
apiVersion: v1
kind: Service
metadata:
  name: kubernetes-web-lightclient
spec:
  ports:
    - name: tcp
      port: 8080
      targetPort: 8080
  selector:
    app: kubernetes-web-lightclient
```
