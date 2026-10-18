import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import KubernetesClusterRoleBindingList from "../components/KubernetesClusterRoleBindingList.vue";
import KubernetesClusterRoleList from "../components/KubernetesClusterRoleList.vue";
import KubernetesConfigMapList from "../components/KubernetesConfigMapList.vue";
import KubernetesCronJobList from "../components/KubernetesCronJobList.vue";
import KubernetesCustomResourceDefinitionList from "../components/KubernetesCustomResourceDefinitionList.vue";
import KubernetesDaemonSetList from "../components/KubernetesDaemonSetList.vue";
import KubernetesDeploymentList from "../components/KubernetesDeploymentList.vue";
import KubernetesEventList from "../components/KubernetesEventList.vue";
import KubernetesIngressList from "../components/KubernetesIngressList.vue";
import KubernetesJobList from "../components/KubernetesJobList.vue";
import KubernetesNamespaceList from "../components/KubernetesNamespaceList.vue";
import KubernetesNodeList from "../components/KubernetesNodeList.vue";
import KubernetesObjectList from "../components/KubernetesObjectList.vue";
import KubernetesPVCList from "../components/KubernetesPVCList.vue";
import KubernetesPVList from "../components/KubernetesPVList.vue";
import KubernetesPodList from "../components/KubernetesPodList.vue";
import KubernetesRoleBindingList from "../components/KubernetesRoleBindingList.vue";
import KubernetesRoleList from "../components/KubernetesRoleList.vue";
import KubernetesSecretList from "../components/KubernetesSecretList.vue";
import KubernetesServiceAccountList from "../components/KubernetesServiceAccountList.vue";
import KubernetesServiceList from "../components/KubernetesServiceList.vue";
import KubernetesStatefulSetList from "../components/KubernetesStatefulSetList.vue";

vi.mock("~~/services/ListPreferencesService", () => ({
  ListPreferencesService: {
    ensureLoaded: vi.fn(async () => {}),
    isLoaded: vi.fn(() => true),
    get: vi.fn(() => ({})),
    set: vi.fn(),
  },
}));

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({}),
}));

interface ListCase {
  label: string;
  component: any;
  storeKey: string;
  fetchMethod: string;
  items: Record<string, any>[];
  props?: Record<string, any>;
}

function kubeItem(overrides: Record<string, any> = {}) {
  return {
    metadata: {
      uid: "uid-1",
      name: "obj-1",
      namespace: "default",
      creationTimestamp: "2026-10-15T00:00:00Z",
      ...((overrides as any).metadata),
    },
    ...overrides,
  };
}

const CASES: ListCase[] = [
  {
    label: "ClusterRoleBindingList",
    component: KubernetesClusterRoleBindingList,
    storeKey: "clusterrolebindings",
    fetchMethod: "getClusterRoleBindings",
    items: [kubeItem()],
  },
  {
    label: "ClusterRoleList",
    component: KubernetesClusterRoleList,
    storeKey: "clusterroles",
    fetchMethod: "getClusterRoles",
    items: [kubeItem()],
  },
  {
    label: "ConfigMapList",
    component: KubernetesConfigMapList,
    storeKey: "configMaps",
    fetchMethod: "getConfigMaps",
    items: [kubeItem()],
  },
  {
    label: "CronJobList",
    component: KubernetesCronJobList,
    storeKey: "cronjobs",
    fetchMethod: "getCronJobs",
    items: [
      kubeItem({
        spec: { schedule: "*/5 * * * *", suspend: false },
        status: { active: [] },
      }),
    ],
  },
  {
    label: "CustomResourceDefinitionList",
    component: KubernetesCustomResourceDefinitionList,
    storeKey: "customResourceDefinitions",
    fetchMethod: "getCustomResourceDefinitions",
    items: [
      kubeItem({
        spec: {
          group: "example.com",
          scope: "Namespaced",
          versions: [{ name: "v1" }],
        },
      }),
    ],
  },
  {
    label: "DaemonSetList",
    component: KubernetesDaemonSetList,
    storeKey: "daemonSets",
    fetchMethod: "getDaemonSets",
    items: [
      kubeItem({
        status: { desiredNumberScheduled: 2, numberReady: 2 },
      }),
    ],
  },
  {
    label: "DeploymentList",
    component: KubernetesDeploymentList,
    storeKey: "deployments",
    fetchMethod: "getDeployments",
    items: [
      kubeItem({
        spec: { replicas: 2 },
        status: { replicas: 2, readyReplicas: 2 },
      }),
    ],
  },
  {
    label: "EventList",
    component: KubernetesEventList,
    storeKey: "events",
    fetchMethod: "getEvents",
    items: [
      kubeItem({
        type: "Warning",
        reason: "BackOff",
        message: "Back-off restarting failed container",
        count: 5,
        lastTimestamp: "2026-10-16T00:00:00Z",
        involvedObject: { kind: "Pod", name: "my-pod", namespace: "default" },
      }),
    ],
  },
  {
    label: "IngressList",
    component: KubernetesIngressList,
    storeKey: "ingresses",
    fetchMethod: "getIngresses",
    items: [
      kubeItem({
        spec: {
          ingressClassName: "nginx",
          rules: [{ host: "app.example.com" }],
        },
        status: { loadBalancer: { ingress: [] } },
      }),
    ],
  },
  {
    label: "JobList",
    component: KubernetesJobList,
    storeKey: "jobs",
    fetchMethod: "getJobs",
    items: [kubeItem()],
  },
  {
    label: "NamespaceList",
    component: KubernetesNamespaceList,
    storeKey: "namespaces",
    fetchMethod: "getNamespaces",
    items: [kubeItem({ metadata: { namespace: undefined } })],
  },
  {
    label: "NodeList",
    component: KubernetesNodeList,
    storeKey: "nodes",
    fetchMethod: "getNodes",
    items: [
      kubeItem({
        metadata: { namespace: undefined, labels: {} },
        status: {
          conditions: [{ type: "Ready", status: "True" }],
          nodeInfo: { kubeletVersion: "v1.31.0" },
          capacity: {
            memory: "8Gi",
            cpu: "4",
            "ephemeral-storage": "100Gi",
          },
        },
      }),
    ],
  },
  {
    label: "ObjectList (generic)",
    component: KubernetesObjectList,
    storeKey: "networkpolicy",
    fetchMethod: "getObject",
    items: [kubeItem()],
    props: { objectType: "networkpolicy" },
  },
  {
    label: "PVCList",
    component: KubernetesPVCList,
    storeKey: "pvcs",
    fetchMethod: "getPvcs",
    items: [kubeItem()],
  },
  {
    label: "PVList",
    component: KubernetesPVList,
    storeKey: "pvs",
    fetchMethod: "getPvs",
    items: [
      kubeItem({
        metadata: { namespace: undefined },
        spec: {
          accessModes: ["ReadWriteOnce"],
          capacity: { storage: "10Gi" },
          persistentVolumeReclaimPolicy: "Retain",
        },
        status: { phase: "Available" },
      }),
    ],
  },
  {
    label: "PodList",
    component: KubernetesPodList,
    storeKey: "pods",
    fetchMethod: "getPods",
    items: [
      kubeItem({
        status: {
          phase: "Running",
          containerStatuses: [{ ready: true, restartCount: 0 }],
        },
      }),
    ],
  },
  {
    label: "RoleBindingList",
    component: KubernetesRoleBindingList,
    storeKey: "rolebindings",
    fetchMethod: "getRoleBindings",
    items: [kubeItem()],
  },
  {
    label: "RoleList",
    component: KubernetesRoleList,
    storeKey: "roles",
    fetchMethod: "getRoles",
    items: [kubeItem()],
  },
  {
    label: "SecretList",
    component: KubernetesSecretList,
    storeKey: "secrets",
    fetchMethod: "getSecrets",
    items: [kubeItem()],
  },
  {
    label: "ServiceAccountList",
    component: KubernetesServiceAccountList,
    storeKey: "serviceaccounts",
    fetchMethod: "getServiceAccounts",
    items: [kubeItem()],
  },
  {
    label: "ServiceList",
    component: KubernetesServiceList,
    storeKey: "services",
    fetchMethod: "getServices",
    items: [
      kubeItem({
        spec: { ports: [{ port: 80, protocol: "TCP" }] },
      }),
    ],
  },
  {
    label: "StatefulSetList",
    component: KubernetesStatefulSetList,
    storeKey: "statefulsets",
    fetchMethod: "getStatefulSets",
    items: [
      kubeItem({
        spec: { replicas: 2 },
        status: { replicas: 2, readyReplicas: 2 },
      }),
    ],
  },
];

function mountListComponent(listCase: ListCase) {
  const store = {
    data: { [listCase.storeKey]: listCase.items } as Record<string, any[]>,
    loading: false,
    hasEverLoaded: true,
    [listCase.fetchMethod]: vi.fn(),
    getObject: vi.fn(),
  };
  vi.stubGlobal("KubernetesObjectStore", () => store);
  vi.stubGlobal("NamespaceStore", () => ({}));
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn() }));
  vi.stubGlobal("useRoute", () => ({ path: "/kubernetes", query: {} }));
  const wrapper = mount(listCase.component, {
    props: listCase.props || {},
    global: {
      config: {
        globalProperties: {
          $route: { path: "/kubernetes", query: {} },
          $router: { replace: vi.fn() },
        },
      },
    },
  });
  return wrapper;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("list components render regression", () => {
  it.each(CASES.map((c) => [c.label, c]))(
    "%s renders its items as a real table",
    async (_label, listCase) => {
      const wrapper = mountListComponent(listCase);
      await flushPromises();

      const table = wrapper.find("table.striped");
      expect(
        table.exists(),
        `${listCase.label} should render a table when items exist`,
      ).toBe(true);
      expect(table.find("thead").exists()).toBe(true);
      const rows = wrapper.findAll("tbody tr");
      expect(
        rows.length,
        `${listCase.label} should render one row per item`,
      ).toBe(listCase.items.length);
      wrapper.unmount();
    },
  );
});
