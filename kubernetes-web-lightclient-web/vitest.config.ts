import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: "~~", replacement: path.resolve(__dirname) },
      { find: "~", replacement: path.resolve(__dirname) },
    ],
  },
  test: {
    environment: "jsdom",
    clearMocks: true,
  },
});
