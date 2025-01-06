<template>
  <div id="object-layout">
    <div id="sources-actions" class="actions">
      <select v-model="objectType">
        <option value="node">Nodes</option>
        <option value="deployment">Deployments</option>
        <option value="statefulset">StatefulSets</option>
        <option value="pod">Pods</option>
        <option value="service">Services</option>
        <option value="pvc">PVC</option>
        <option value="configmap">ConfigMap</option>
        <option value="secret">Secrets</option>
      </select>
    </div>
    <div id="object-list">
      <KubernetesNodeList v-if="objectType == 'node'" />
      <KubernetesDeploymentList v-if="objectType == 'deployment'" />
      <KubernetesPodList v-else-if="objectType == 'pod'" />
      <KubernetesStatefulSetList v-else-if="objectType == 'statefulset'" />
      <KubernetesServiceList v-else-if="objectType == 'service'" />
      <KubernetesPVCList v-else-if="objectType == 'pvc'" />
      <KubernetesConfigMapList v-else-if="objectType == 'configmap'" />
      <KubernetesSecretList v-else-if="objectType == 'secret'" />
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      objectType: "pod",
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
  },
  methods: {},
};
</script>

<style>
#object-list {
  overflow-x: auto;
  width: 100%;
}
#object-list td {
  white-space: nowrap;
}

#object-list td,
#object-list pre,
#object-list div,
#object-list span,
#object-list p {
  font-size: 0.9em;
}
</style>
