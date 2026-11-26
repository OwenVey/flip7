import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pwaOptions, tokenColor } from "../../pwa.config";

const root = path.resolve(import.meta.dirname, "../..");

const read = async (file: string) =>
  await readFile(path.join(root, file), "utf-8");

const match = (source: string, pattern: RegExp) => {
  const value = pattern.exec(source)?.groups?.color;

  if (value === undefined) {
    throw new Error(`No match for ${pattern}`);
  }

  return value.toLowerCase();
};

const token = (name: string) => tokenColor(name).toLowerCase();

describe("the browser chrome color", () => {
  it("matches --felt-deep, so Safari's bars meet the felt without a seam", async () => {
    const feltDeep = token("felt-deep");

    const metaThemeColor = match(
      await read("src/document.tsx"),
      /<meta name="theme-color" content="(?<color>#[0-9a-f]{6})"/iu
    );

    expect(metaThemeColor).toBe(feltDeep);
    expect(pwaOptions.manifest).toMatchObject({
      background_color: feltDeep,
      theme_color: feltDeep,
    });
  });
});

describe("the offline page", () => {
  it("copies its colors from tokens.css, since it loads no stylesheet", async () => {
    const offline = await read("public/offline.html");

    const copies = [
      ...offline.matchAll(/--(?<name>[a-z-]+):\s*(?<color>#[0-9a-f]{6});/giu),
    ];

    expect(copies.length).toBeGreaterThan(0);

    for (const copy of copies) {
      const { color = "", name = "" } = copy.groups ?? {};

      // oxlint-disable-next-line no-await-in-loop -- a handful of reads, and a failure names the first stale copy.
      expect(color.toLowerCase(), `--${name}`).toBe(token(name));
    }

    expect(
      match(
        offline,
        /<meta name="theme-color" content="(?<color>#[0-9a-f]{6})"/iu
      )
    ).toBe(token("felt-deep"));
  });
});
