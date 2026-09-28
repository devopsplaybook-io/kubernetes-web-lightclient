import { PreferencesService as CommonPreferencesService } from "@devopsplaybook.io/common-web/services/PreferencesService";

export const PreferencesService = {
  LOG_WRAP_KEY: "LOGS_WRAP",
  LOG_TIMESTAMPS_KEY: "LOGS_TIMESTAMPS",
  getStoredBoolean(key: string, defaultValue: boolean): boolean {
    const stored = CommonPreferencesService.get(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return defaultValue;
  },
  storeBoolean(key: string, value: boolean) {
    CommonPreferencesService.set(key, value ? "true" : "false");
  },
};
