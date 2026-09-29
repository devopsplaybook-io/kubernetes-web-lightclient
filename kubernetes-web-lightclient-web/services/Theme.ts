import type { InjectionKey } from "vue";
import type { useTheme } from "@devopsplaybook.io/common-web/composables/useTheme";

export const CommonWebThemeKey: InjectionKey<ReturnType<typeof useTheme>> =
  Symbol("common-web-theme");
