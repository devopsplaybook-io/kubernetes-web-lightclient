import { describe, expect, it, vi } from "vitest";
import {
  clearDialogRoute,
  readDialogRoute,
  writeDialogRoute,
} from "../services/DialogDeepLink";

function routerMock() {
  return { replace: vi.fn() };
}

describe("DialogDeepLink", () => {
  describe("readDialogRoute", () => {
    it("reads a valid details deep link with namespace", () => {
      expect(
        readDialogRoute({
          objectType: "pod",
          dialog: "details",
          name: "my-pod",
          dialogNamespace: "default",
        }),
      ).toEqual({ kind: "details", name: "my-pod", namespace: "default" });
    });

    it("reads a valid logs deep link without namespace", () => {
      expect(readDialogRoute({ dialog: "logs", name: "my-node" })).toEqual({
        kind: "logs",
        name: "my-node",
        namespace: "",
      });
    });

    it("returns null for junk or missing values", () => {
      expect(readDialogRoute(null)).toBeNull();
      expect(readDialogRoute(undefined)).toBeNull();
      expect(readDialogRoute("nonsense")).toBeNull();
      expect(readDialogRoute({})).toBeNull();
      expect(readDialogRoute({ dialog: "bogus", name: "my-pod" })).toBeNull();
      expect(readDialogRoute({ dialog: "details" })).toBeNull();
      expect(readDialogRoute({ dialog: "details", name: "" })).toBeNull();
      expect(
        readDialogRoute({ dialog: "details", name: "my-pod; id" }),
      ).toBeNull();
      expect(
        readDialogRoute({ dialog: "details", name: ["my-pod", "other"] }),
      ).toBeNull();
      expect(
        readDialogRoute({ dialog: "details", name: "my-pod", dialogNamespace: "../etc" }),
      ).toBeNull();
      // Subdomain names with dots are valid object names
      expect(
        readDialogRoute({ dialog: "details", name: "my.pod.subdomain" }),
      ).toEqual({ kind: "details", name: "my.pod.subdomain", namespace: "" });
    });
  });

  describe("writeDialogRoute", () => {
    it("merges dialog params into the existing query", () => {
      const router = routerMock();
      writeDialogRoute(
        router,
        { path: "/kubernetes", query: { objectType: "pod", search: "x" } },
        "details",
        "my-pod",
        "default",
      );
      expect(router.replace).toHaveBeenCalledWith({
        path: "/kubernetes",
        query: {
          objectType: "pod",
          search: "x",
          dialog: "details",
          name: "my-pod",
          dialogNamespace: "default",
        },
      });
    });

    it("omits dialogNamespace for cluster-scoped objects and drops stale values", () => {
      const router = routerMock();
      writeDialogRoute(
        router,
        { path: "/kubernetes", query: { dialogNamespace: "default" } },
        "details",
        "my-node",
      );
      expect(router.replace).toHaveBeenCalledWith({
        path: "/kubernetes",
        query: { dialog: "details", name: "my-node" },
      });
    });
  });

  describe("clearDialogRoute", () => {
    it("removes only the dialog params", () => {
      const router = routerMock();
      clearDialogRoute(
        router,
        {
          path: "/kubernetes",
          query: {
            objectType: "pod",
            dialog: "logs",
            name: "my-pod",
            dialogNamespace: "default",
          },
        },
      );
      expect(router.replace).toHaveBeenCalledWith({
        path: "/kubernetes",
        query: { objectType: "pod" },
      });
    });

    it("does not navigate when no dialog params are present", () => {
      const router = routerMock();
      clearDialogRoute(
        router,
        { path: "/kubernetes", query: { objectType: "pod" } },
      );
      expect(router.replace).not.toHaveBeenCalled();
    });
  });
});
