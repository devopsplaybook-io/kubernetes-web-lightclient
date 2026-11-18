import { describe, expect, it } from "vitest";
import { getSettingsTabs, normalizeSettingsTab } from "./settingsTabs";

describe("getSettingsTabs", () => {
  it("should list Profile as the first tab for every state", () => {
    expect(getSettingsTabs(false)[0]).toEqual({
      id: "profile",
      label: "Profile",
    });
    expect(getSettingsTabs(true)[0]).toEqual({
      id: "profile",
      label: "Profile",
    });
  });

  it("should only expose the Profile tab when unauthenticated", () => {
    expect(getSettingsTabs(false)).toEqual([
      { id: "profile", label: "Profile" },
    ]);
  });

  it("should expose all tabs in order when authenticated", () => {
    expect(getSettingsTabs(true).map((tab) => tab.id)).toEqual([
      "profile",
      "resources",
      "apitoken",
    ]);
    expect(getSettingsTabs(true)).toEqual([
      { id: "profile", label: "Profile" },
      { id: "resources", label: "Resources" },
      { id: "apitoken", label: "API Token" },
    ]);
  });

  it("should only expose the Users tab to administrators", () => {
    expect(getSettingsTabs(true, true).map((tab) => tab.id)).toEqual([
      "profile",
      "resources",
      "apitoken",
      "users",
    ]);
    expect(getSettingsTabs(true, true).at(-1)).toEqual({
      id: "users",
      label: "Users",
    });
    expect(getSettingsTabs(true, false).map((tab) => tab.id)).not.toContain(
      "users",
    );
  });

  it("should hide the Users tab while unauthenticated", () => {
    expect(getSettingsTabs(false, true).map((tab) => tab.id)).toEqual([
      "profile",
    ]);
  });
});

describe("normalizeSettingsTab", () => {
  it("should keep allowed tabs when authenticated", () => {
    expect(normalizeSettingsTab("profile", true)).toBe("profile");
    expect(normalizeSettingsTab("resources", true)).toBe("resources");
    expect(normalizeSettingsTab("apitoken", true)).toBe("apitoken");
  });

  it("should fall back to profile for unknown tabs", () => {
    expect(normalizeSettingsTab("unknown", true)).toBe("profile");
    expect(normalizeSettingsTab(undefined, true)).toBe("profile");
    expect(normalizeSettingsTab(undefined, false)).toBe("profile");
  });

  it("should fall back to profile when unauthenticated requests other tabs", () => {
    expect(normalizeSettingsTab("resources", false)).toBe("profile");
    expect(normalizeSettingsTab("apitoken", false)).toBe("profile");
  });

  it("should only resolve the Users tab for administrators", () => {
    expect(normalizeSettingsTab("users", true, true)).toBe("users");
    expect(normalizeSettingsTab("users", true, false)).toBe("profile");
    expect(normalizeSettingsTab("users", false, true)).toBe("profile");
  });
});
