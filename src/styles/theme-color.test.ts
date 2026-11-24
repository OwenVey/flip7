import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

describe("the browser chrome color", () => {
  it("matches --felt-deep, so Safari's bars meet the felt without a seam", async () => {
    const feltDeep = match(
      await read("src/styles/tokens.css"),
      /--felt-deep:\s*(?<color>#[0-9a-f]{6});/iu
    );

    const metaThemeColor = match(
      await read("src/document.tsx"),
      /<meta name="theme-color" content="(?<color>#[0-9a-f]{6})"/iu
    );

    const manifest: unknown = JSON.parse(await read("public/site.webmanifest"));

    expect(metaThemeColor).toBe(feltDeep);
    expect(manifest).toMatchObject({
      background_color: feltDeep,
      theme_color: feltDeep,
    });
  });
});
