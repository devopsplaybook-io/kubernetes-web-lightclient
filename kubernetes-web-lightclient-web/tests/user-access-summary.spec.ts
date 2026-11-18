import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import UserAccessSummary from "../components/UserAccessSummary.vue";

describe("UserAccessSummary", () => {
  it("lists the granted scopes with their explanations", () => {
    const wrapper = mount(UserAccessSummary, {
      props: {
        user: {
          name: "alice",
          role: "user",
          scopes: ["k8s:read", "stats:read", "unknown:scope"],
        },
      },
    });

    expect(wrapper.text()).toContain("Signed in as");
    expect(wrapper.text()).toContain("alice");
    expect(wrapper.text()).toContain("user");
    expect(wrapper.text()).toContain("Kubernetes read");
    expect(wrapper.text()).toContain("Stats read");
    expect(wrapper.text()).toContain("List cluster resources");
    expect(wrapper.text()).not.toContain("unknown:scope");
    wrapper.unmount();
  });

  it("explains that a user without scopes cannot read cluster data", () => {
    const wrapper = mount(UserAccessSummary, {
      props: { user: { name: "new-user", role: "user", scopes: [] } },
    });

    expect(wrapper.text()).toContain("cannot access cluster data");
    expect(wrapper.text()).toContain("administrator");
    wrapper.unmount();
  });

  it("notes that the admin role bypasses scope checks", () => {
    const wrapper = mount(UserAccessSummary, {
      props: { user: { name: "root", role: "admin", scopes: ["admin"] } },
    });

    expect(wrapper.text()).toContain("admin role bypasses");
    wrapper.unmount();
  });

  it("distinguishes the admin scope from the admin role", () => {
    const wrapper = mount(UserAccessSummary, {
      props: {
        user: { name: "operator", role: "user", scopes: ["admin"] },
      },
    });

    expect(wrapper.text()).toContain("admin scope grants");
    expect(wrapper.text()).toContain("requires the administrator role");
    expect(wrapper.text()).not.toContain("admin role bypasses");
    wrapper.unmount();
  });

  it("shows loading, error and retry states", async () => {
    const loading = mount(UserAccessSummary, {
      props: { loading: true },
    });
    expect(loading.find(".loading-indicator").exists()).toBe(true);
    loading.unmount();

    const wrapper = mount(UserAccessSummary, {
      props: { error: "Your role and scopes could not be loaded." },
    });
    expect(wrapper.text()).toContain("could not be loaded");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    wrapper.unmount();
  });
});
