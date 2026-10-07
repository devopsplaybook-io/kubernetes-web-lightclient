import axios from "axios";
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApiTokensSettings from "../components/ApiTokensSettings.vue";
import { ApiTokensService } from "../services/ApiTokensService";
import Config from "../services/Config";
import { AuthService } from "../services/AuthService";

const AUTH_HEADER = { headers: { Authorization: "Bearer jwt-token" } };

const SAMPLE_TOKEN = {
  id: "token-1",
  name: "machine-client",
  dateCreated: "2026-10-07T10:00:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
};

function mockAuth(): void {
  vi.spyOn(Config, "get").mockResolvedValue({
    SERVER_URL: "/api",
  } as never);
  vi.spyOn(AuthService, "getAuthHeader").mockResolvedValue(
    AUTH_HEADER as never,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("ApiTokensService", () => {
  it("lists tokens with the auth header", async () => {
    mockAuth();
    const getSpy = vi
      .spyOn(axios, "get")
      .mockResolvedValue({ data: [SAMPLE_TOKEN] } as never);

    await expect(ApiTokensService.list()).resolves.toEqual([SAMPLE_TOKEN]);
    expect(getSpy).toHaveBeenCalledWith("/api/users/tokens", AUTH_HEADER);
  });

  it("creates a token without expiry", async () => {
    mockAuth();
    const postSpy = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { ...SAMPLE_TOKEN, token: "plain" } } as never);

    await ApiTokensService.create("machine-client");
    expect(postSpy).toHaveBeenCalledWith(
      "/api/users/tokens",
      { name: "machine-client" },
      AUTH_HEADER,
    );
  });

  it("creates a token with an expiry date", async () => {
    mockAuth();
    const postSpy = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { ...SAMPLE_TOKEN, token: "plain" } } as never);

    await ApiTokensService.create("machine-client", "2999-01-01T23:59:59.000Z");
    expect(postSpy).toHaveBeenCalledWith(
      "/api/users/tokens",
      { name: "machine-client", expiresAt: "2999-01-01T23:59:59.000Z" },
      AUTH_HEADER,
    );
  });

  it("revokes a token by id", async () => {
    mockAuth();
    const deleteSpy = vi
      .spyOn(axios, "delete")
      .mockResolvedValue({ data: {} } as never);

    await ApiTokensService.revoke("token-1");
    expect(deleteSpy).toHaveBeenCalledWith(
      "/api/users/tokens/token-1",
      AUTH_HEADER,
    );
  });
});

describe("ApiTokensSettings", () => {
  async function mountComponent() {
    mockAuth();
    const wrapper = mount(ApiTokensSettings);
    await flushPromises();
    return wrapper;
  }

  it("lists the existing tokens", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({ data: [SAMPLE_TOKEN] } as never);

    const wrapper = await mountComponent();

    expect(wrapper.text()).toContain("machine-client");
    expect(wrapper.text()).toContain("Revoke");
    wrapper.unmount();
  });

  it("shows the plaintext token only once in a dialog on creation", async () => {
    vi.spyOn(axios, "get")
      .mockResolvedValueOnce({ data: [] } as never)
      .mockResolvedValueOnce({ data: [SAMPLE_TOKEN] } as never);
    vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        ...SAMPLE_TOKEN,
        token: "plaintext-one-time-token-value",
      },
    } as never);

    const wrapper = await mountComponent();
    wrapper.vm.newTokenName = "machine-client";
    await wrapper.vm.createToken();
    await flushPromises();

    expect(document.body.textContent).toContain(
      "plaintext-one-time-token-value",
    );
    expect(document.body.textContent).toContain("only once");
    expect(JSON.stringify(localStorage)).not.toContain(
      "plaintext-one-time-token-value",
    );

    wrapper.vm.createdTokenClose();
    await flushPromises();
    expect(document.body.textContent).not.toContain(
      "plaintext-one-time-token-value",
    );
    wrapper.unmount();
  });

  it("revokes a token after confirmation and reloads the list", async () => {
    vi.spyOn(axios, "get")
      .mockResolvedValueOnce({ data: [SAMPLE_TOKEN] } as never)
      .mockResolvedValueOnce({ data: [] } as never);
    const deleteSpy = vi
      .spyOn(axios, "delete")
      .mockResolvedValue({ data: {} } as never);

    const wrapper = await mountComponent();
    wrapper.vm.revokeStart(SAMPLE_TOKEN);
    await flushPromises();
    expect(document.body.querySelector("#dialog-confirm")).not.toBeNull();

    await wrapper.vm.revokeConfirm();
    await flushPromises();

    expect(deleteSpy).toHaveBeenCalledWith(
      "/api/users/tokens/token-1",
      AUTH_HEADER,
    );
    expect(wrapper.vm.apiTokens).toEqual([]);
    wrapper.unmount();
  });

  it("does not create a token without a name", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({ data: [] } as never);
    const postSpy = vi.spyOn(axios, "post");

    const wrapper = await mountComponent();
    await wrapper.vm.createToken();
    await flushPromises();

    expect(postSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
