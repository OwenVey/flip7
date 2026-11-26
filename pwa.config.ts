import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createAppleSplashScreens,
  defineConfig as defineAssetsConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";
import type { VitePWAOptions } from "vite-plugin-pwa";

import { shortcutUrl } from "./src/lib/home-shortcuts.ts";

const ICON_SOURCE = "src/assets/favicon.svg";

// WARNING: Cloudflare redirects offline.html to /offline, and the precache rejects redirects.
const OFFLINE_PAGE = "offline";

const tokens = readFileSync(path.resolve("src/styles/tokens.css"), "utf-8");

/** Reads a hex color from `tokens.css`, the one file allowed to define them. */
export const tokenColor = (name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "iu").exec(tokens);

  const color = match?.[1];

  if (color === undefined) {
    throw new Error(`tokens.css has no hex color --${name}`);
  }

  return color;
};

const FELT = tokenColor("felt");
const FELT_DEEP = tokenColor("felt-deep");

/**
 * Icons and iOS startup images, generated at build time by
 * `@vite-pwa/assets-generator`. `Document` renders their links from
 * `virtual:pwa-assets/head`, because the app has no `index.html` for the
 * plugin to inject into.
 */
export const pwaAssetsConfig = defineAssetsConfig({
  headLinkOptions: { preset: "2023" },
  images: [ICON_SOURCE],
  preset: {
    ...minimal2023Preset,
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { background: FELT, fit: "contain" },
    },
    appleSplashScreens: createAppleSplashScreens({
      linkMediaOptions: { addMediaScreen: true, basePath: "/", log: false },
      padding: 0.6,
      resizeOptions: { background: FELT_DEEP, fit: "contain" },
    }),
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: FELT, fit: "contain" },
    },
  },
});

/** Workbox and manifest settings for `VitePWA`. */
export const pwaOptions = {
  injectRegister: false,
  manifest: {
    background_color: FELT_DEEP,
    categories: ["games"],
    description: "A multiplayer push-your-luck card game for 2 to 16 players.",
    display: "standalone",
    id: "/",
    launch_handler: { client_mode: "navigate-existing" },
    name: "Flip 7",
    scope: "/",
    screenshots: [
      {
        form_factor: "narrow",
        label: "Flip 7 home page: create or join a room",
        sizes: "1080x1920",
        src: "/screenshots/home-narrow.png",
        type: "image/png",
      },
      {
        form_factor: "narrow",
        label: "A round of Flip 7 in progress",
        sizes: "1080x1920",
        src: "/screenshots/table-narrow.png",
        type: "image/png",
      },
      {
        form_factor: "wide",
        label: "Flip 7 home page: create or join a room",
        sizes: "1920x1080",
        src: "/screenshots/home-wide.png",
        type: "image/png",
      },
      {
        form_factor: "wide",
        label: "A round of Flip 7 in progress",
        sizes: "1920x1080",
        src: "/screenshots/table-wide.png",
        type: "image/png",
      },
    ],
    short_name: "Flip 7",
    shortcuts: [
      {
        description: "Start a new room and invite friends",
        name: "New room",
        url: shortcutUrl("create"),
      },
      {
        description: "Enter a room code",
        name: "Join room",
        url: shortcutUrl("join"),
      },
    ],
    start_url: "/",
    theme_color: FELT_DEEP,
  },
  manifestFilename: "site.webmanifest",
  pwaAssets: {
    config: false,
    image: ICON_SOURCE,
    integration: { publicDir: path.resolve(path.dirname(ICON_SOURCE)) },
    overrideManifestIcons: true,
    preset: pwaAssetsConfig.preset,
  },
  registerType: "autoUpdate",
  workbox: {
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    globIgnores: ["**/stress-*.js", "apple-splash-*.png", "screenshots/**"],
    globPatterns: ["**/*.{js,css,woff2,svg,png,ico,html}"],
    manifestTransforms: [
      (entries) => ({
        manifest: entries.map((entry) =>
          entry.url === `${OFFLINE_PAGE}.html`
            ? { ...entry, url: OFFLINE_PAGE }
            : entry
        ),
        warnings: [],
      }),
    ],
    navigateFallback: null,
    navigationPreload: true,
    runtimeCaching: [
      {
        handler: "NetworkOnly",
        options: { precacheFallback: { fallbackURL: `/${OFFLINE_PAGE}` } },
        urlPattern: ({ request }) => request.mode === "navigate",
      },
      {
        handler: "StaleWhileRevalidate",
        options: { cacheName: "flip7-sounds" },
        urlPattern: ({ url }) => url.pathname.startsWith("/sounds/"),
      },
    ],
    skipWaiting: true,
  },
} satisfies Partial<VitePWAOptions>;
