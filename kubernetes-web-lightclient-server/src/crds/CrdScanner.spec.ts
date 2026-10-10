import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";

const mockSystemCommandExecute = jest.fn();

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

jest.mock("../utils-std-ts/SystemCommand", () => ({
  SystemCommandExecute: (...args: unknown[]) =>
    mockSystemCommandExecute(...args),
}));

import { Config } from "../Config";
import {
  CrdScannerGetAvailableResources,
  CrdScannerGetBuiltinResources,
  CrdScannerInit,
  CrdScannerReconcileAvailableResources,
  CrdScannerRefresh,
} from "./CrdScanner";

// Legacy persisted list: built-ins of a previous release (no networkpolicy,
// replicaset, hpa, pdb, storageclass) plus a stale non-built-in type
const LEGACY_DISK_RESOURCES = [
  { id: "pod", name: "Pods", namespaced: true, isCrd: false, group: "" },
  {
    id: "deployment",
    name: "Deployments",
    namespaced: true,
    isCrd: false,
    group: "apps",
  },
  {
    id: "retiredtype",
    name: "Retired Types",
    namespaced: true,
    isCrd: false,
    group: "legacy",
  },
  {
    id: "oldcrd",
    name: "OldCrd (CRD)",
    namespaced: true,
    isCrd: true,
    group: "example.com",
  },
];

function crdItem(id: string, kind: string, group: string): unknown {
  return {
    spec: {
      group,
      scope: "Namespaced",
      names: { plural: id, kind },
    },
  };
}

describe("CrdScanner", () => {
  let dataDir: string;
  let resourcesFile: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSystemCommandExecute.mockResolvedValue(JSON.stringify({ items: [] }));
    dataDir = path.join(os.tmpdir(), `crd-scanner-test-${Date.now()}`);
    await fse.ensureDir(dataDir);
    resourcesFile = path.join(dataDir, "available-resources.json");
  });

  afterEach(async () => {
    await fse.remove(dataDir);
  });

  async function initDataDir(resources: unknown): Promise<void> {
    await fse.writeJson(resourcesFile, resources);
    await CrdScannerInit({ DATA_DIR: dataDir } as unknown as Config);
  }

  describe("CrdScannerGetBuiltinResources", () => {
    it("should expose the standard built-in resource types", () => {
      const ids = CrdScannerGetBuiltinResources();
      expect(ids).toContain("pod");
      expect(ids).toContain("networkpolicy");
      expect(ids).toContain("replicaset");
      expect(ids).toContain("hpa");
      expect(ids).toContain("pdb");
      expect(ids).toContain("storageclass");
    });
  });

  describe("CrdScannerInit", () => {
    it("should gain new built-ins and drop retired ones from a stale disk file", async () => {
      await initDataDir(LEGACY_DISK_RESOURCES);

      const ids = CrdScannerGetAvailableResources().map((r) => r.id);
      expect(ids).toContain("networkpolicy");
      expect(ids).toContain("replicaset");
      expect(ids).toContain("hpa");
      expect(ids).toContain("pdb");
      expect(ids).toContain("storageclass");
      expect(ids).not.toContain("retiredtype");
      // The non-CRD portion mirrors the current built-ins exactly
      const nonCrd = CrdScannerGetAvailableResources().filter((r) => !r.isCrd);
      expect(nonCrd.map((r) => r.id).sort()).toEqual(
        CrdScannerGetBuiltinResources().slice().sort(),
      );
    });

    it("should keep live CRDs persisted on disk and drop stale built-ins", async () => {
      mockSystemCommandExecute.mockResolvedValue(
        JSON.stringify({
          items: [crdItem("oldcrd", "OldCrd", "example.com")],
        }),
      );
      await initDataDir(LEGACY_DISK_RESOURCES);

      const resources = CrdScannerGetAvailableResources();
      expect(resources.filter((r) => r.id === "oldcrd")).toEqual([
        {
          id: "oldcrd",
          name: "OldCrd (CRD)",
          namespaced: true,
          isCrd: true,
          group: "example.com",
        },
      ]);
    });

    it("should drop a persisted CRD whose id matches a built-in", async () => {
      await initDataDir([
        ...LEGACY_DISK_RESOURCES,
        {
          id: "hpa",
          name: "Hpa (CRD)",
          namespaced: true,
          isCrd: true,
          group: "example.com",
        },
      ]);

      const hpas = CrdScannerGetAvailableResources().filter(
        (r) => r.id === "hpa",
      );
      expect(hpas).toHaveLength(1);
      expect(hpas[0].isCrd).toBe(false);
    });

    it("should fall back to built-ins when the disk file is corrupted", async () => {
      await fse.writeFile(resourcesFile, "not-json");
      await CrdScannerInit({ DATA_DIR: dataDir } as unknown as Config);

      const nonCrd = CrdScannerGetAvailableResources().filter((r) => !r.isCrd);
      expect(nonCrd.map((r) => r.id).sort()).toEqual(
        CrdScannerGetBuiltinResources().slice().sort(),
      );
    });
  });

  describe("CrdScannerRefresh", () => {
    it("should merge live CRDs and drop CRDs gone from the cluster", async () => {
      await initDataDir(LEGACY_DISK_RESOURCES);

      mockSystemCommandExecute.mockResolvedValue(
        JSON.stringify({
          items: [crdItem("newcrd", "NewCrd", "example.com")],
        }),
      );
      const resources = await CrdScannerRefresh();

      const ids = resources.map((r) => r.id);
      expect(ids).toContain("newcrd");
      expect(ids).not.toContain("oldcrd");
      expect(resources.find((r) => r.id === "newcrd")).toEqual({
        id: "newcrd",
        name: "NewCrd (CRD)",
        namespaced: true,
        isCrd: true,
        group: "example.com",
      });
      // Built-ins stay first and unchanged
      expect(resources.slice(0, 2)).toEqual([
        { id: "pod", name: "Pods", namespaced: true, isCrd: false, group: "" },
        {
          id: "deployment",
          name: "Deployments",
          namespaced: true,
          isCrd: false,
          group: "apps",
        },
      ]);
    });

    it("should keep the current resources when the cluster scan fails", async () => {
      await initDataDir(LEGACY_DISK_RESOURCES);
      const before = CrdScannerGetAvailableResources();

      mockSystemCommandExecute.mockRejectedValue(
        new Error("kubectl unavailable"),
      );
      const resources = await CrdScannerRefresh();

      expect(resources).toEqual(before);
    });
  });

  describe("CrdScannerReconcileAvailableResources", () => {
    it("should keep built-ins first and preserve unrelated CRDs", () => {
      const reconciled = CrdScannerReconcileAvailableResources([
        {
          id: "mycrd",
          name: "MyCrd (CRD)",
          namespaced: true,
          isCrd: true,
          group: "example.com",
        },
      ]);

      expect(reconciled[0].id).toBe("pod");
      expect(reconciled.filter((r) => r.id === "mycrd")).toHaveLength(1);
      expect(
        reconciled.filter((r) => !r.isCrd).map((r) => r.id).sort(),
      ).toEqual(CrdScannerGetBuiltinResources().slice().sort());
    });
  });
});
