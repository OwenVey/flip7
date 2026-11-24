import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { FontaineTransform } from "fontaine";
import { defineConfig } from "vitest/config";

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
    FontaineTransform.vite({ fallbacks: {} }),
  ],
  // WARNING: list dependencies the room route imports here, or Vite finds them mid-request and loads two copies of solid-js.
  optimizeDeps: {
    exclude: ["@ui-sdk/core"],
    include: [
      "@nkzw/audio",
      "@solid-primitives/clipboard",
      "@solid-primitives/storage",
      "@solid-primitives/timer",
      "partysocket",
      "valibot",
    ],
  },
  environments: {
    ssr: {
      optimizeDeps: {
        include: [
          "solid-js",
          "@solidjs/web",
          "@solidjs/web/storage",
          "@solidjs/web/server-functions",
          "@solidjs/meta",
          "@solidjs/router/fs",
          "@solidjs/start-devtools",
          "@nkzw/audio",
          "@solid-primitives/clipboard",
          "@solid-primitives/storage",
          "@solid-primitives/timer",
          "partysocket",
        ],
      },
    },
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
