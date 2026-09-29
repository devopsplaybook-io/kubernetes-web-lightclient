import axios from "axios";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import AlertMessages from "@devopsplaybook.io/common-web/components/AlertMessages.vue";
import Loading from "@devopsplaybook.io/common-web/components/Loading.vue";
import { useTheme } from "@devopsplaybook.io/common-web/composables/useTheme";
import {
  EventBus,
  EventTypes,
} from "../services/EventBus";
import { AuthService } from "../services/AuthService";
import { PreferencesService } from "../services/PreferencesService";
import { AuthenticationStore } from "../stores/AuthenticationStore";

function createToken(claims: { exp: number; iat: number }): string {
  return `header.${btoa(JSON.stringify(claims))}.signature`;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Common-Web layer integration", () => {
  it("provides the shared loading indicator", () => {
    const wrapper = mount(Loading);

    expect(wrapper.get('[role="status"]').attributes("aria-label")).toBe(
      "Loading",
    );
    wrapper.unmount();
  });

  it("applies and persists the shared theme preference", async () => {
    let theme!: ReturnType<typeof useTheme>;
    const wrapper = mount(
      defineComponent({
        setup() {
          theme = useTheme();
          return () => h("div");
        },
      }),
    );

    await nextTick();
    theme.setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("UI_THEME")).toBe("dark");

    wrapper.unmount();
  });

  it("displays shared alerts and cleans up listeners and timers on unmount", async () => {
    vi.useFakeTimers();
    const wrapper = mount(AlertMessages);

    EventBus.emit(EventTypes.ALERT_MESSAGE, {
      type: "error",
      text: "Kubernetes request failed",
    });
    await nextTick();

    expect(wrapper.text()).toContain("Kubernetes request failed");
    expect(vi.getTimerCount()).toBe(1);

    wrapper.unmount();

    expect(vi.getTimerCount()).toBe(0);
    EventBus.emit(EventTypes.ALERT_MESSAGE, {
      type: "info",
      text: "This should not be displayed",
    });
    await nextTick();
    expect(wrapper.text()).not.toContain("This should not be displayed");
  });

  it("migrates the legacy auth token key to the shared canonical key", async () => {
    const token = createToken({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorage.setItem("AUTH_TOKEN", token);

    await expect(AuthService.getToken()).resolves.toBe(token);
    expect(localStorage.getItem("auth_token")).toBe(token);
    expect(localStorage.getItem("AUTH_TOKEN")).toBeNull();
  });

  it("renews an expiring token through the shared session refresh API", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = createToken({ iat: now - 900, exp: now + 100 });
    const renewedToken = createToken({ iat: now, exp: now + 3600 });
    localStorage.setItem("auth_token", token);
    vi.spyOn(axios, "post").mockResolvedValueOnce({
      data: { token: renewedToken },
    } as never);

    await expect(AuthService.getToken()).resolves.toBe(renewedToken);
    expect(axios.post).toHaveBeenCalledWith(
      "/api/users/session/refresh",
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(localStorage.getItem("auth_token")).toBe(renewedToken);
  });

  it("preserves Kubernetes-specific events and log preferences", () => {
    const changed = vi.fn();
    EventBus.on(EventTypes.OBJECT_CHANGED, changed);

    EventBus.emit(EventTypes.OBJECT_CHANGED, "pod");
    PreferencesService.storeBoolean(PreferencesService.LOG_WRAP_KEY, true);

    expect(changed).toHaveBeenCalledWith("pod");
    expect(
      PreferencesService.getStoredBoolean(PreferencesService.LOG_WRAP_KEY, false),
    ).toBe(true);
    EventBus.off(EventTypes.OBJECT_CHANGED, changed);
  });

  it("uses the shared Pinia authentication store", async () => {
    setActivePinia(createPinia());
    const store = AuthenticationStore();

    await expect(store.ensureAuthenticated()).resolves.toBe(false);
    expect(store.isAuthenticated).toBe(false);
  });
});
