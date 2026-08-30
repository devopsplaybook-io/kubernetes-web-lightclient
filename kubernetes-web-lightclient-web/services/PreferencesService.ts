export const PreferencesService = {
  LOG_WRAP_KEY: "LOGS_WRAP",
  LOG_TIMESTAMPS_KEY: "LOGS_TIMESTAMPS",
  //
  getStoredBoolean(key: string, defaultValue: boolean): boolean {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return defaultValue;
  },
  //
  storeBoolean(key: string, value: boolean) {
    localStorage.setItem(key, value ? "true" : "false");
  },
  //
  toggleTheme(vm: any) {
    vm.isDark = !vm.isDark;
    localStorage.setItem("UI_THEME", vm.isDark ? "dark" : "light");
    this.applyTheme();
  },
  //
  applyTheme() {
    const storedTheme = localStorage.getItem("UI_THEME");
    let isDark = false;
    if (storedTheme === "dark" || storedTheme === "light") {
      isDark = storedTheme === "dark";
    } else {
      isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    document.documentElement.setAttribute(
      "data-theme",
      isDark ? "dark" : "light"
    );
    localStorage.setItem("UI_THEME", isDark ? "dark" : "light");
  },
};
