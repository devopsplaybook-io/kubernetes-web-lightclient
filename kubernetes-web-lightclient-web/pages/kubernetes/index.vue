<template>
  <div id="object-layout">
    <input
      id="object-search"
      type="search"
      v-model="searchFilter"
      placeholder="Search"
      aria-label="Search"
      v-on:input="filterChanged"
    />
    <div id="object-actions" class="actions">
      <select v-model="objectType">
        <option value="node">Nodes</option>
        <option value="deployment">Deployments</option>
        <option value="statefulset">StatefulSets</option>
        <option value="daemonset">DaemonSets</option>
        <option value="pod">Pods</option>
        <option value="job">Jobs</option>
        <option value="service">Services</option>
        <option value="pvc">PVC</option>
        <option value="configmap">ConfigMap</option>
        <option value="secret">Secrets</option>
      </select>
      <span><i class="bi bi-arrow-clockwise" v-on:click="refreshObject()"></i></span>
    </div>
    <div id="object-list">
      <KubernetesNodeList v-if="objectType == 'node'" />
      <KubernetesDeploymentList v-if="objectType == 'deployment'" />
      <KubernetesPodList v-else-if="objectType == 'pod'" />
      <KubernetesStatefulSetList v-else-if="objectType == 'statefulset'" />
      <KubernetesDaemonSetList v-else-if="objectType == 'daemonset'" />
      <KubernetesJobList v-else-if="objectType == 'job'" />
      <KubernetesServiceList v-else-if="objectType == 'service'" />
      <KubernetesPVCList v-else-if="objectType == 'pvc'" />
      <KubernetesConfigMapList v-else-if="objectType == 'configmap'" />
      <KubernetesSecretList v-else-if="objectType == 'secret'" />
    </div>
  </div>
</template>

<script>
import { debounce } from "lodash";

export default {
  data() {
    return {
      objectType: "pod",
      searchFilter: "",
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
  },
  methods: {
    refreshObject() {
      KubernetesObjectStore().refreshLast();
    },
    filterChanged: debounce(async function (e) {
      KubernetesObjectStore().setFilter(this.searchFilter);
    }, 500),
  },
};
</script>

<style>
#object-layout {
  display: grid;
  max-height: 100%;
  height: auto;
  grid-template-rows: auto auto 1fr;
}
#object-actions {
  display: grid;
  grid-template-columns: 1fr auto;
}
#object-actions select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
#object-actions span {
  padding-top: 0.3rem;
}
#object-search {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  padding-left: 3em;
  height: 2.6rem;
}

#object-list {
  overflow-x: auto;
  overflow-y: auto;
  height: 100%;
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
