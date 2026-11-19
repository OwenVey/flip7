import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    solid({
      start: { document: "src/document.tsx" },
      extensions: [".jsx", ".tsx"],
      diagnostics: true,
    }),
    fileRoutes({ types: true }),
  ],
  optimizeDeps: {
    exclude: ["@ui-sdk/core"],
  },
  server: {
    port: 3000,
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest-setup.ts"],
    isolate: false,
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
  },
});
