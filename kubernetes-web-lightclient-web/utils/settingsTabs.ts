/**
 * Pure helpers for the Settings page tabs: Profile (login/create user,
 * password, logout, appearance) is always visible, the Resources and API
 * Token tabs only once authenticated, and Users only for administrators
 * (the `/api/users` routes require the role, not the `admin` scope). The
 * active tab is mirrored to the `?tab=` query so refreshes and browser
 * navigation restore it.
 */

export interface SettingsTab {
  id: string;
  label: string;
}

export function getSettingsTabs(
  isAuthenticated: boolean,
  isAdmin: boolean = false,
): SettingsTab[] {
  const tabs: SettingsTab[] = [{ id: "profile", label: "Profile" }];
  if (isAuthenticated) {
    tabs.push(
      { id: "resources", label: "Resources" },
      { id: "apitoken", label: "API Token" },
    );
    if (isAdmin) {
      tabs.push({ id: "users", label: "Users" });
    }
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
  isAdmin: boolean = false,
): string {
  const allowed = getSettingsTabs(isAuthenticated, isAdmin).map((t) => t.id);
  return allowed.includes(tab as string) ? (tab as string) : "profile";
}
