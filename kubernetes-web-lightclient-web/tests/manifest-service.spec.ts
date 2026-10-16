import { describe, expect, it, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("../services/Utils", () => ({
  UtilsDecompressData: vi.fn(async (value: string) => value),
  UtilsRelativeTime: vi.fn(() => "just now"),
}));

vi.mock("../services/Config.ts", () => ({
  default: { get: async () => ({ SERVER_URL: "http://server.test/api" }) },
}));

vi.mock("../services/AuthService", () => ({
  AuthService: { getAuthHeader: async () => ({ headers: {} }) },
}));

import { describeObject, getObjectManifestYaml } from "../services/ManifestService";

const postMock = () => axios.post as unknown as ReturnType<typeof vi.fn>;

vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));

describe("ManifestService", () => {
  beforeEach(() => {
    postMock().mockReset();
  });

  describe("describeObject", () => {
    it("posts a describe command with the namespace", async () => {
      postMock().mockResolvedValue({ data: { result: "DESCRIBE OUTPUT" } });

      const result = await describeObject("pod", "default", "my-pod");

      expect(result).toBe("DESCRIBE OUTPUT");
      expect(postMock()).toHaveBeenCalledWith(
        "http://server.test/api/kubectl/command",
        {
          object: "pod",
          command: "describe",
          argument: "my-pod",
          noJson: true,
          namespace: "default",
        },
        { headers: {} },
      );
    });

    it("omits the namespace for cluster-scoped objects", async () => {
      postMock().mockResolvedValue({ data: { result: "NODE OUTPUT" } });

      await describeObject("node", "", "my-node");

      const payload = postMock().mock.calls[0][1];
      expect(payload).not.toHaveProperty("namespace");
    });

    it("propagates request errors", async () => {
      postMock().mockRejectedValue(new Error("boom"));
      await expect(describeObject("pod", "default", "my-pod")).rejects.toThrow(
        "boom",
      );
    });
  });

  describe("getObjectManifestYaml", () => {
    it("converts the get -o json result to YAML", async () => {
      postMock().mockResolvedValue({
        data: {
          result: JSON.stringify({
            apiVersion: "v1",
            metadata: { name: "my-pod", labels: { app: "web" } },
            spec: { containers: [{ name: "app", ports: [80, 443] }] },
          }),
        },
      });

      const yaml = await getObjectManifestYaml("pod", "default", "my-pod");

      expect(postMock()).toHaveBeenCalledWith(
        "http://server.test/api/kubectl/command",
        {
          object: "pod",
          command: "get",
          argument: "my-pod",
          namespace: "default",
        },
        { headers: {} },
      );
      expect(yaml).toBe(
        [
          "apiVersion: v1",
          "metadata:",
          "  name: my-pod",
          "  labels:",
          "    app: web",
          "spec:",
          "  containers:",
          "    - name: app",
          "      ports:",
          "        - 80",
          "        - 443",
          "",
        ].join("\n"),
      );
    });

    it("round-trips nested objects and arrays", async () => {
      const manifest = {
        data: { nested: { deep: ["a", "b"] } },
        empty: {},
        list: [],
      };
      postMock().mockResolvedValue({
        data: { result: JSON.stringify(manifest) },
      });

      const yaml = await getObjectManifestYaml("configmap", "default", "my-cm");

      const { default: jsYaml } = await import("js-yaml");
      expect(jsYaml.load(yaml)).toEqual(manifest);
    });

    it("propagates invalid JSON payloads", async () => {
      postMock().mockResolvedValue({ data: { result: "not json" } });
      await expect(
        getObjectManifestYaml("pod", "default", "my-pod"),
      ).rejects.toThrow();
    });
  });
});
