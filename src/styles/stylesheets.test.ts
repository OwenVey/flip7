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
  "Big Shoulders Display Variable": [400, 600, 900],
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
  it("keeps only the layer order in app.css", async () => {
    expect(statements(await readFile(appCss, "utf-8"))).toStrictEqual([
      "@layer ui-sdk, base, components;",
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

interface OuterRule {
  layers: string[];
  selector: string;
}

const outerRules = (css: string) => {
  const rules: OuterRule[] = [];
  const open: string[] = [];
  let prelude = "";

  for (const char of css.replaceAll(/\/\*[\s\S]*?\*\//gu, "")) {
    if (char === "{") {
      const selector = prelude.trim();

      const nested = open.some(
        (block) => !block.startsWith("@") || block.startsWith("@keyframes")
      );

      if (!nested && !selector.startsWith("@")) {
        const layers = open.flatMap((block) =>
          block.startsWith("@layer ") ? [block.slice(7).trim()] : []
        );

        rules.push({ layers, selector });
      }

      open.push(selector);
      prelude = "";
    } else if (char === "}") {
      open.pop();
      prelude = "";
    } else if (char === ";") {
      prelude = "";
    } else {
      prelude += char;
    }
  }

  return rules;
};

const isSharedPartDefault = (selector: string) =>
  /\[data-(?:slot|variant)\b/u.test(selector) &&
  selector
    .replaceAll(/\[[^\]]*\]/gu, "")
    .replaceAll(/::?[a-z-]+/gu, "")
    .replaceAll(/[\s(),>+~*&]/gu, "") === "";

const isElementDefault = (selector: string) =>
  /^[a-z0-9*\s,>+~]+$/u.test(selector.replaceAll(/::[a-z-]+/gu, ""));

const layerFor = (selector: string) => {
  if (isElementDefault(selector)) {
    return "base";
  }

  return isSharedPartDefault(selector) ? "components" : "none";
};

const areaRules = async () => {
  const lines = statements(await readFile(stylesIndex, "utf-8"));

  const files = await Promise.all(
    lines.map(async (line) => {
      const file = /"\.\/(?<file>[a-z-]+\.css)"/u.exec(line)?.groups?.file;

      return outerRules(
        await readFile(path.resolve(import.meta.dirname, file ?? ""), "utf-8")
      );
    })
  );

  return files.flat();
};

describe("cascade layers", () => {
  it("puts each outer rule in the layer its selector calls for", async () => {
    const rules = await areaRules();

    const misplaced = rules.flatMap(({ layers, selector }) => {
      const actual = layers.at(-1) ?? "none";
      const expected = layerFor(selector);

      return actual === expected
        ? []
        : [`${selector}: in ${actual}, belongs in ${expected}`];
    });

    expect(misplaced).toStrictEqual([]);
  });

  it("uses both layers", async () => {
    const rules = await areaRules();
    const used = new Set(rules.flatMap(({ layers }) => layers));

    expect([...used].toSorted()).toStrictEqual(["base", "components"]);
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

  it("omits local() fallbacks on primary faces and Bungee as a numeral fallback", async () => {
    const code = (await transform(tokensCss)) ?? "";
    const blocks = code.match(/@font-face\s*\{[^}]*\}/gu) ?? [];

    const primaryBlocks = blocks.filter(
      (block) => !block.includes(" Fallback: ")
    );

    expect(primaryBlocks.length).toBeGreaterThan(0);

    for (const block of primaryBlocks) {
      expect(block).not.toContain("local(");
    }

    expect(code).not.toContain(
      "Big Shoulders Display Variable Fallback: Bungee"
    );
  });
});
