/**
 * Pure helpers for the Settings page tabs: Profile (login/create user,
 * password, logout, appearance) is always visible, the Resources and API
 * Token tabs only once authenticated. The active tab is mirrored to the
 * `?tab=` query so refreshes and browser navigation restore it.
 */

export interface SettingsTab {
  id: string;
  label: string;
}

export function getSettingsTabs(isAuthenticated: boolean): SettingsTab[] {
  const tabs: SettingsTab[] = [{ id: "profile", label: "Profile" }];
  if (isAuthenticated) {
    tabs.push(
      { id: "resources", label: "Resources" },
      { id: "apitoken", label: "API Token" },
    );
  }
  return tabs;
}

/**
 * Resolves a ?tab= query value to a tab the user may see, falling back to
 * "profile" for unknown or unauthorized values.
 */
export function normalizeSettingsTab(
  tab: unknown,
  isAuthenticated: boolean,
): string {
  const allowed = getSettingsTabs(isAuthenticated).map((t) => t.id);
  return allowed.includes(tab as string) ? (tab as string) : "profile";
}
