// oxlint-disable-next-line landmines-style/no-comments -- Fontaine reads font files through Node, not jsdom.
// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { FontaineTransform } from "fontaine";
import { describe, expect, it } from "vitest";

const appCss = path.resolve(import.meta.dirname, "../app.css");
const stylesIndex = path.resolve(import.meta.dirname, "index.css");

const fontImports = [
  '@import "@fontsource-variable/big-shoulders-display";',
  '@import "@fontsource-variable/inter";',
  '@import "@fontsource/bungee/400.css";',
];

const fontImportBlock = fontImports.join("\n");

const fallbackFamilies = [
  "Big Shoulders Display Variable fallback",
  "Inter Variable fallback",
  "Bungee fallback",
];

// WARNING: keep these options the same as the FontaineTransform in vite.config.ts.
const fontaine = FontaineTransform.raw(
  { fallbacks: {} },
  { framework: "vite" }
);

const fontainePlugin = Array.isArray(fontaine) ? fontaine[0] : fontaine;

const transform = async (file: string) => {
  const hook = fontainePlugin?.transform;

  if (hook === undefined || !("handler" in hook)) {
    throw new Error("Fontaine no longer exposes a transform handler.");
  }

  // SAFETY: Fontaine's transform handler never reads its plugin context.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vite supplies the context in a real build.
  const context = {} as ThisParameterType<typeof hook.handler>;

  const result = await hook.handler.call(
    context,
    await readFile(file, "utf-8"),
    file
  );

  if (result === null || result === undefined) {
    return null;
  }

  return result instanceof Object ? result.code : result;
};

const statements = (css: string) =>
  css
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

describe("stylesheet entry points", () => {
  it("keeps only the font imports and the ui-sdk layer in app.css", async () => {
    expect(statements(await readFile(appCss, "utf-8"))).toStrictEqual([
      ...fontImports,
      "@layer ui-sdk;",
    ]);
  });

  it("keeps only @imports of the area files in styles/index.css", async () => {
    const lines = statements(await readFile(stylesIndex, "utf-8"));

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line).toMatch(/^@import "\.\/[a-z-]+\.css";$/u);
    }
  });

  it("puts Fontaine's fallback faces right after the font imports", async () => {
    const code = (await transform(appCss)) ?? "";

    expect(code.startsWith(fontImportBlock)).toBeTruthy();

    const between = code.slice(
      fontImportBlock.length,
      code.indexOf("@layer ui-sdk;")
    );

    const faces = between.match(/@font-face\s*\{[^}]*\}/gu) ?? [];

    expect(between.replaceAll(/@font-face\s*\{[^}]*\}/gu, "").trim()).toBe("");
    expect(
      fallbackFamilies.map((family) =>
        faces.some((face) => face.includes(`font-family: "${family}"`))
      )
    ).toStrictEqual(fallbackFamilies.map(() => true));
  });

  it("adds no fallback faces among the style imports", async () => {
    await expect(transform(stylesIndex)).resolves.toBeNull();
  });
});
