import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AccessDeniedPanel from "../components/AccessDeniedPanel.vue";

describe("AccessDeniedPanel", () => {
  it("renders the scope-explaining denial and emits retry", async () => {
    const wrapper = mount(AccessDeniedPanel, {
      props: {
        scope: "k8s:read",
        title: "Missing scope",
        message: "Ask an administrator to grant k8s:read.",
      },
    });

    expect(wrapper.attributes("role")).toBe("alert");
    expect(wrapper.text()).toContain("Missing scope");
    expect(wrapper.text()).toContain("k8s:read");
    expect(wrapper.text()).toContain("Ask an administrator");

    const retry = wrapper
      .findAll("button")
      .find((button) => button.text() === "Retry");
    expect(retry).toBeDefined();
    await retry!.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);

    wrapper.unmount();
  });

  it("links to the Users tab only when allowed", async () => {
    const router = { push: vi.fn() };
    const wrapper = mount(AccessDeniedPanel, {
      global: {
        config: {
          globalProperties: { $router: router },
        },
      },
    });

    const settings = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Manage access"));
    expect(settings).toBeUndefined();

    await wrapper.setProps({ showSettingsLink: true });
    const linked = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Manage access"));
    expect(linked).toBeDefined();
    await linked!.trigger("click");

    expect(router.push).toHaveBeenCalledWith({
      path: "/settings",
      query: { tab: "users" },
    });
    wrapper.unmount();
  });
});
