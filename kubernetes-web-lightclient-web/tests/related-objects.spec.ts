import { describe, expect, it } from "vitest";
import {
  IngressServiceNames,
  OwnerRefs,
  PodTemplateLabels,
  PodsOwnedBy,
  PodsReferencing,
  ReferencedConfigMapsAndSecrets,
  RelatedEvents,
  ReplicaSetsOwnedBy,
  RoutingIngresses,
  SelectingServices,
  SelectorMatchesLabels,
} from "../services/RelatedObjects";

const ownerReference = (kind: string, name: string, uid: string) => ({
  kind,
  name,
  uid,
  controller: true,
});

describe("OwnerRefs", () => {
  it("reads valid owner references", () => {
    expect(
      OwnerRefs({
        metadata: {
          ownerReferences: [ownerReference("ReplicaSet", "web-1", "rs-1")],
        },
      }),
    ).toEqual([
      { kind: "ReplicaSet", name: "web-1", uid: "rs-1", controller: true },
    ]);
  });

  it("ignores malformed entries and missing references", () => {
    expect(
      OwnerRefs({
        metadata: {
          ownerReferences: [null, { kind: "Pod" }, { name: "x" }, { kind: "", name: "y" }],
        },
      }),
    ).toEqual([]);
    expect(OwnerRefs({})).toEqual([]);
  });
});

describe("PodTemplateLabels", () => {
  it("uses the workload template labels", () => {
    expect(
      PodTemplateLabels({
        metadata: { labels: { a: "1" } },
        spec: { template: { metadata: { labels: { app: "web" } } } },
      }),
    ).toEqual({ app: "web" });
  });

  it("uses the CronJob jobTemplate labels", () => {
    expect(
      PodTemplateLabels({
        spec: {
          jobTemplate: {
            spec: { template: { metadata: { labels: { app: "cron" } } } },
          },
        },
      }),
    ).toEqual({ app: "cron" });
  });

  it("falls back to the object labels (pods)", () => {
    expect(PodTemplateLabels({ metadata: { labels: { app: "pod" } } })).toEqual({
      app: "pod",
    });
  });
});

describe("SelectorMatchesLabels", () => {
  it("matches a non-empty selector as a subset", () => {
    expect(
      SelectorMatchesLabels({ app: "web", tier: "front" }, { app: "web", tier: "front", extra: "1" }),
    ).toBe(true);
  });

  it("rejects mismatches and empty/missing selectors", () => {
    expect(SelectorMatchesLabels({ app: "web" }, { app: "api" })).toBe(false);
    expect(SelectorMatchesLabels({}, { app: "web" })).toBe(false);
    expect(SelectorMatchesLabels(undefined, { app: "web" })).toBe(false);
    expect(SelectorMatchesLabels({ app: "web" }, undefined)).toBe(false);
  });
});

describe("SelectingServices / RoutingIngresses", () => {
  const services = [
    { metadata: { name: "web" }, spec: { selector: { app: "web" } } },
    { metadata: { name: "api" }, spec: { selector: { app: "api" } } },
    { metadata: { name: "empty" }, spec: {} },
  ];

  it("returns the services selecting the labels", () => {
    expect(
      SelectingServices(services, { app: "web" }).map((s) => s.metadata.name),
    ).toEqual(["web"]);
  });

  it("reads service names from v1 and legacy ingress backends", () => {
    expect(
      IngressServiceNames({
        spec: {
          defaultBackend: { service: { name: "web" } },
          rules: [
            {
              http: {
                paths: [
                  { backend: { service: { name: "api" } } },
                  { backend: { serviceName: "legacy" } },
                ],
              },
            },
          ],
        },
      }),
    ).toEqual(["api", "legacy", "web"]);
  });

  it("finds the ingresses routing to the service names", () => {
    const ingresses = [
      {
        metadata: { name: "web-ing" },
        spec: { defaultBackend: { service: { name: "web" } } },
      },
      {
        metadata: { name: "other-ing" },
        spec: { defaultBackend: { service: { name: "other" } } },
      },
    ];
    expect(
      RoutingIngresses(ingresses, ["web"]).map((i) => i.metadata.name),
    ).toEqual(["web-ing"]);
  });
});

describe("ReferencedConfigMapsAndSecrets", () => {
  it("collects volume, projected, env, envFrom and imagePullSecret references", () => {
    const result = ReferencedConfigMapsAndSecrets({
      imagePullSecrets: [{ name: "registry-secret" }],
      volumes: [
        { name: "config", configMap: { name: "app-config" } },
        { name: "creds", secret: { secretName: "app-secret" } },
        {
          name: "projected",
          projected: {
            sources: [
              { configMap: { name: "projected-config" } },
              { secret: { name: "projected-secret" } },
            ],
          },
        },
      ],
      containers: [
        {
          name: "app",
          envFrom: [{ configMapRef: { name: "env-config" } }],
          env: [
            {
              name: "TOKEN",
              valueFrom: { secretKeyRef: { name: "token-secret" } },
            },
            {
              name: "MODE",
              valueFrom: { configMapKeyRef: { name: "mode-config" } },
            },
          ],
        },
      ],
      initContainers: [
        {
          name: "init",
          envFrom: [{ secretRef: { name: "init-secret" } }],
        },
      ],
    });

    expect(result.configMaps.map((entry) => entry.name)).toEqual([
      "app-config",
      "env-config",
      "mode-config",
      "projected-config",
    ]);
    expect(result.secrets.map((entry) => entry.name)).toEqual([
      "app-secret",
      "init-secret",
      "projected-secret",
      "registry-secret",
      "token-secret",
    ]);
    expect(result.configMaps.find((entry) => entry.name === "app-config")?.via).toBe(
      "volume config",
    );
  });

  it("deduplicates names and tolerates missing specs", () => {
    const result = ReferencedConfigMapsAndSecrets({
      volumes: [
        { name: "a", configMap: { name: "shared" } },
        { name: "b", configMap: { name: "shared" } },
      ],
    });
    expect(result.configMaps).toHaveLength(1);
    expect(ReferencedConfigMapsAndSecrets(undefined)).toEqual({
      configMaps: [],
      secrets: [],
    });
  });
});

describe("PodsReferencing", () => {
  const podUsing = (name: string, configMap: string) => ({
    metadata: { name, namespace: "default" },
    spec: {
      containers: [
        { name: "app", envFrom: [{ configMapRef: { name: configMap } }] },
      ],
    },
  });

  it("finds pods referencing a ConfigMap", () => {
    const pods = [podUsing("a", "shared"), podUsing("b", "other")];
    expect(
      PodsReferencing(pods, "ConfigMap", "shared").map((p) => p.metadata.name),
    ).toEqual(["a"]);
  });

  it("returns nothing for an empty name", () => {
    expect(PodsReferencing([podUsing("a", "shared")], "Secret", "")).toEqual([]);
  });
});

describe("RelatedEvents", () => {
  const object = {
    kind: "Pod",
    metadata: { uid: "pod-uid", name: "web-1", namespace: "default" },
  };
  const event = (name: string, involved: any, time: string) => ({
    metadata: { name, creationTimestamp: time },
    involvedObject: involved,
    lastTimestamp: time,
  });

  it("matches by UID first and falls back to kind/name/namespace", () => {
    const events = [
      event("by-uid", { uid: "pod-uid", kind: "Other", name: "x" }, "2026-01-01T00:00:00Z"),
      event("by-tuple", { kind: "Pod", name: "web-1", namespace: "default" }, "2026-01-02T00:00:00Z"),
      event("other", { kind: "Pod", name: "other", namespace: "default" }, "2026-01-03T00:00:00Z"),
    ];
    const result = RelatedEvents(events, object);
    expect(result.map((e) => e.metadata.name)).toEqual([
      "by-tuple",
      "by-uid",
    ]);
  });

  it("falls back to the tuple when events carry no UID", () => {
    const events = [
      event("match", { kind: "Pod", name: "web-1", namespace: "default" }, "2026-01-02T00:00:00Z"),
      event("other", { kind: "Pod", name: "other", namespace: "default" }, "2026-01-03T00:00:00Z"),
    ];
    const result = RelatedEvents(events, { ...object, metadata: { ...object.metadata, uid: "" } });
    expect(result.map((e) => e.metadata.name)).toEqual(["match"]);
  });

  it("sorts newest first and caps the list", () => {
    const events = Array.from({ length: 60 }, (_, index) =>
      event(
        `event-${index}`,
        { kind: "Pod", name: "web-1", namespace: "default" },
        `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00Z`,
      ),
    );
    const result = RelatedEvents(events, { ...object, metadata: { ...object.metadata, uid: "" } });
    expect(result).toHaveLength(50);
    expect(result[0].metadata.name).toBe("event-59");
  });
});

describe("ownership filters", () => {
  const owned = (name: string, uid: string) => ({
    metadata: { name, ownerReferences: [{ uid }] },
  });

  it("filters pods and ReplicaSets by owner UID", () => {
    const pods = [owned("a", "rs-1"), owned("b", "rs-2")];
    expect(PodsOwnedBy(pods, "rs-1").map((p) => p.metadata.name)).toEqual(["a"]);
    expect(
      ReplicaSetsOwnedBy(pods, "rs-1").map((p) => p.metadata.name),
    ).toEqual(["a"]);
    expect(PodsOwnedBy(pods, "")).toEqual([]);
  });
});
