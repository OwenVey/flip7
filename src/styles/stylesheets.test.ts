// oxlint-disable-next-line landmines-style/no-comments -- Fontless reads font files through Node, not jsdom.
// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { fontless } from "fontless";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

import { fontlessOptions } from "../../fonts.config.ts";

const root = path.resolve(import.meta.dirname, "../..");
const appCss = path.resolve(import.meta.dirname, "../app.css");
const stylesIndex = path.resolve(import.meta.dirname, "index.css");
const tokensCss = path.resolve(import.meta.dirname, "tokens.css");

const weightsSetPerFamily = {
  "Big Shoulders Display Variable": [400, 900],
  Bungee: [400],
  "Inter Variable": [400, 600, 700, 800],
};

const transform = async (file: string) => {
  const config = await resolveConfig(
    { configFile: false, root, plugins: [fontless(fontlessOptions)] },
    "serve"
  );

  const plugin = config.plugins.find(
    ({ name }) => name === "vite-plugin-fontless"
  );

  const hook = plugin?.transform;

  if (hook === undefined || !("handler" in hook)) {
    throw new Error("Fontless no longer exposes a transform handler.");
  }

  // SAFETY: when serving, Fontless's transform handler never reads its plugin context.
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

  return String(result instanceof Object ? result.code : result);
};

const statements = (css: string) =>
  css
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const faces = (css: string) =>
  (css.match(/@font-face\s*\{[^}]*\}/gu) ?? []).map((face) => ({
    family:
      /font-family:\s*["']?(?<family>[^;"']+)/u
        .exec(face)
        ?.groups?.family?.replaceAll("\\", "") ?? "",
    weight: Number(
      /font-weight:\s*(?<weight>\d+);/u.exec(face)?.groups?.weight ?? 400
    ),
  }));

describe("stylesheet entry points", () => {
  it("keeps only the ui-sdk layer in app.css", async () => {
    expect(statements(await readFile(appCss, "utf-8"))).toStrictEqual([
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

  it("adds no font faces among the style imports", async () => {
    await expect(transform(stylesIndex)).resolves.toBeNull();
  });
});

describe("font faces", () => {
  it("serves each family from its @fontsource package", async () => {
    const code = (await transform(tokensCss)) ?? "";
    const families = new Set(faces(code).map(({ family }) => family));

    expect(
      Object.keys(weightsSetPerFamily).filter((family) => families.has(family))
    ).toStrictEqual(Object.keys(weightsSetPerFamily));
  });

  it("gives each family a fallback face for every weight it is set in", async () => {
    const code = (await transform(tokensCss)) ?? "";

    const fallbacks = faces(code).filter(({ family }) =>
      family.endsWith(": Arial")
    );

    expect(
      Object.fromEntries(
        Object.keys(weightsSetPerFamily).map((family) => [
          family,
          fallbacks
            .filter((face) => face.family === `${family} Fallback: Arial`)
            .map(({ weight }) => weight),
        ])
      )
    ).toStrictEqual(weightsSetPerFamily);
  });

  it("puts the fallbacks right after each family in the font stacks", async () => {
    const code = (await transform(tokensCss)) ?? "";

    for (const family of Object.keys(weightsSetPerFamily)) {
      expect(code).toContain(`"${family}", "${family} Fallback: `);
    }
  });
});
