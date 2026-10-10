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
});
