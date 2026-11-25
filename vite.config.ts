import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { fontless } from "fontless";
import { defineConfig } from "vitest/config";

import { fontlessOptions } from "./fonts.config.ts";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    solid({
      start: { document: "src/document.tsx" },
      ssr: true,
      serverFunctions: { devMiddleware: false },
      extensions: [".jsx", ".tsx"],
      diagnostics: true,
    }),
    fileRoutes({ types: true }),
    fontless(fontlessOptions),
  ],
  css: {
    transformer: "lightningcss",
    lightningcss: {
      drafts: { customMedia: true },
      targets: {},
    },
  },
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
