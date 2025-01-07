# Deploying with Kubernetes.

In the [kubernetes-web-lightclient] directory, you will find an example of deployment using Yaml files (with Kustomize)

To Launch the application in Kubenetes:

```bash
git clone https://github.com/DidierHoarau/kubernetes-web-lightclient
cd kubernetes-web-lightclient/docs/deployments/kubernetes/kubernetes-web-lightclient
kubectl kustomize . | kubectl apply -f -
```
