import { describe, expect, it } from "vitest";

import { pwaOptions } from "./pwa.config";

const { manifest, workbox } = pwaOptions;

describe("the web app manifest", () => {
  it("installs as a standalone app scoped to the whole site", () => {
    expect(manifest).toMatchObject({
      display: "standalone",
      id: "/",
      launch_handler: { client_mode: "navigate-existing" },
      scope: "/",
      start_url: "/",
    });
    expect(manifest).not.toHaveProperty("orientation");
  });

  it("offers shortcuts the home page acts on", () => {
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toStrictEqual([
      "/?action=create",
      "/?action=join",
    ]);
  });

  it("lists narrow and wide screenshots for the richer install sheet", () => {
    const forms = new Set(manifest.screenshots.map((shot) => shot.form_factor));

    expect(forms).toStrictEqual(new Set(["narrow", "wide"]));
  });
});

describe("the service worker", () => {
  it("never caches pages and falls back to the offline page", () => {
    expect(workbox.navigateFallback).toBeNull();

    const [navigation] = workbox.runtimeCaching;

    expect(navigation).toMatchObject({
      handler: "NetworkOnly",
      options: { precacheFallback: { fallbackURL: "/offline" } },
    });
  });

  it("precaches the offline page at the URL Cloudflare serves it from", async () => {
    const [transform] = workbox.manifestTransforms;

    const result = await Promise.resolve(
      transform?.([
        { revision: "a", size: 1, url: "offline.html" },
        { revision: "b", size: 1, url: "assets/app.js" },
      ])
    );

    expect(result?.manifest.map((entry) => entry.url)).toStrictEqual([
      "offline",
      "assets/app.js",
    ]);
  });
});
