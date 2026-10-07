import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DialogApiTokenCreated from "../components/DialogApiTokenCreated.vue";

describe("DialogApiTokenCreated", () => {
  it("renders the one-time token with the shown-only-once warning and no usage copy", () => {
    const wrapper = mount(DialogApiTokenCreated, {
      props: { token: "plaintext-one-time-token-value" },
    });

    expect(document.body.textContent).toContain(
      "plaintext-one-time-token-value",
    );
    expect(document.body.textContent).toContain("only once");
    expect(document.body.textContent).not.toContain("Bearer");
    wrapper.unmount();
  });

  it("does not render the token after closing", async () => {
    const wrapper = mount(DialogApiTokenCreated, {
      props: { token: "plaintext-one-time-token-value" },
    });

    await wrapper.vm.onClose();

    expect(wrapper.emitted("onClose")).toHaveLength(1);
    wrapper.unmount();
    expect(document.body.textContent).not.toContain(
      "plaintext-one-time-token-value",
    );
  });

  it("copies the token to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const wrapper = mount(DialogApiTokenCreated, {
      props: { token: "plaintext-one-time-token-value" },
    });

    await wrapper.vm.copyToken();

    expect(writeText).toHaveBeenCalledWith("plaintext-one-time-token-value");
    wrapper.unmount();
  });
});
