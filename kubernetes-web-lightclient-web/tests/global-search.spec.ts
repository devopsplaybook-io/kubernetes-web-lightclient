import { describe, expect, it } from "vitest";
import {
  BuildSearchDocument,
  CollectImages,
  CollectIPs,
  CollectNodeNames,
  ObjectStatusText,
  PALETTE_MAX_PER_TYPE,
  PodSpecOf,
  ScoreMatch,
  SearchObjects,
} from "../services/GlobalSearch";

const TYPES = [
  { id: "pod", name: "Pod" },
  { id: "deployment", name: "Deployment" },
  { id: "service", name: "Service" },
  { id: "node", name: "Node" },
];

function pod(name: string, overrides: Record<string, any> = {}) {
  return {
    kind: "Pod",
    metadata: {
      uid: `uid-${name}`,
      name,
      namespace: "default",
      labels: { app: "web", tier: "frontend" },
      creationTimestamp: "2026-10-15T00:00:00Z",
    },
    spec: {
      nodeName: "node-1",
      containers: [{ name: "app", image: "registry.example.com/web:1.2.3" }],
      initContainers: [{ name: "init", image: "busybox:1.36" }],
    },
    status: {
      phase: "Running",
      podIP: "10.0.0.5",
      hostIP: "192.168.1.10",
      podIPs: [{ ip: "10.0.0.5" }, { ip: "fd00::5" }],
    },
    ...overrides,
  };
}

describe("PodSpecOf", () => {
  it("returns the pod spec of a pod and of a workload template", () => {
    expect(PodSpecOf(pod("p"))?.containers?.[0].image).toContain("web");
    expect(
      PodSpecOf({
        spec: { template: { spec: { containers: [{ image: "nginx" }] } } },
      })?.containers?.[0].image,
    ).toBe("nginx");
  });

  it("returns the CronJob jobTemplate pod spec", () => {
    expect(
      PodSpecOf({
        spec: {
          jobTemplate: {
            spec: { template: { spec: { containers: [{ image: "job" }] } } },
          },
        },
      })?.containers?.[0].image,
    ).toBe("job");
  });

  it("returns null for objects without a pod spec", () => {
    expect(PodSpecOf({ spec: { selector: { app: "web" } } })).toBeNull();
    expect(PodSpecOf(null)).toBeNull();
  });
});

describe("search document collection", () => {
  it("collects unique images of all container kinds", () => {
    expect(CollectImages(pod("p"))).toEqual([
      "registry.example.com/web:1.2.3",
      "busybox:1.36",
    ]);
  });

  it("collects the pod node name", () => {
    expect(CollectNodeNames(pod("p"))).toEqual(["node-1"]);
  });

  it("collects pod, service, ingress and node IPs", () => {
    const ips = CollectIPs(pod("p"));
    expect(ips).toContain("10.0.0.5");
    expect(ips).toContain("fd00::5");
    expect(ips).toContain("192.168.1.10");
    expect(CollectIPs({ spec: { clusterIP: "10.0.0.9", externalIPs: ["1.2.3.4"] } })).toEqual(
      ["10.0.0.9", "1.2.3.4"],
    );
    expect(
      CollectIPs({ status: { addresses: [{ address: "192.168.1.20" }] } }),
    ).toEqual(["192.168.1.20"]);
  });

  it("builds a lower-cased document with labels", () => {
    const document = BuildSearchDocument(pod("Web-1"));
    expect(document.name).toBe("web-1");
    expect(document.namespace).toBe("default");
    expect(document.labels).toContain("app=web");
    expect(document.images).toContain("registry.example.com/web:1.2.3");
    expect(document.nodes).toContain("node-1");
    expect(document.ips).toContain("10.0.0.5");
  });
});

describe("ScoreMatch", () => {
  const document = BuildSearchDocument(pod("web-1"));

  it("requires every token to match (AND)", () => {
    expect(ScoreMatch(document, ["web", "default"])).not.toBeNull();
    expect(ScoreMatch(document, ["web", "missing"])).toBeNull();
    expect(ScoreMatch(document, [])).toBeNull();
  });

  it("ranks name matches above label, image, node, IP and namespace", () => {
    const score = (token: string) => ScoreMatch(document, [token])?.score ?? 0;
    expect(score("web-1")).toBeGreaterThan(score("frontend"));
    expect(score("frontend")).toBeGreaterThan(score("web:1.2.3"));
    expect(score("web:1.2.3")).toBeGreaterThan(score("node-1"));
    expect(score("node-1")).toBeGreaterThan(score("10.0.0.5"));
    expect(score("10.0.0.5")).toBeGreaterThan(score("default"));
  });

  it("reports the winning match reason", () => {
    expect(ScoreMatch(document, ["web-1"])?.reason).toBe("name");
    expect(ScoreMatch(document, ["busybox"])?.reason).toBe("image");
    expect(ScoreMatch(document, ["node-1"])?.reason).toBe("node");
    expect(ScoreMatch(document, ["10.0.0.5"])?.reason).toBe("ip");
    expect(ScoreMatch(document, ["default"])?.reason).toBe("namespace");
  });
});

describe("SearchObjects", () => {
  const itemsByType = {
    pod: [pod("web-1"), pod("other")],
    deployment: [
      {
        kind: "Deployment",
        metadata: {
          uid: "d1",
          name: "web",
          namespace: "default",
          creationTimestamp: "2026-10-15T00:00:00Z",
        },
        spec: {
          replicas: 3,
          template: {
            metadata: { labels: { app: "web" } },
            spec: {
              containers: [{ name: "app", image: "registry.example.com/web:2" }],
            },
          },
        },
        status: { replicas: 3, readyReplicas: 2 },
      },
    ],
  };

  it("groups results by type in input order", () => {
    const groups = SearchObjects({ types: TYPES, itemsByType }, "web");
    expect(groups.map((group) => group.typeId)).toEqual(["pod", "deployment"]);
    expect(groups[0].items[0].name).toBe("web-1");
    expect(groups[0].items[0].statusText).toBe("Running");
    expect(groups[1].items[0].statusText).toBe("2/3 ready");
  });

  it("omits groups without matches and returns [] for an empty query", () => {
    expect(SearchObjects({ types: TYPES, itemsByType }, "nothing")).toEqual([]);
    expect(SearchObjects({ types: TYPES, itemsByType }, "   ")).toEqual([]);
  });

  it("caps each group and the total result", () => {
    const pods = Array.from({ length: 20 }, (_, index) =>
      pod(`web-${String(index).padStart(2, "0")}`),
    );
    const groups = SearchObjects(
      { types: TYPES, itemsByType: { pod: pods } },
      "web",
    );
    expect(groups[0].total).toBe(20);
    expect(groups[0].items).toHaveLength(PALETTE_MAX_PER_TYPE);
  });

  it("derives node status text", () => {
    expect(
      ObjectStatusText(
        { status: { conditions: [{ type: "Ready", status: "True" }] } },
        "node",
      ),
    ).toBe("Ready");
    expect(ObjectStatusText({ status: {} }, "node")).toBe("NotReady");
  });
});
