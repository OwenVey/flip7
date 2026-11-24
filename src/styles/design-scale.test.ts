import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const stylesDir = import.meta.dirname;

const readWithoutComments = async (file: string) => {
  const css = await readFile(path.join(stylesDir, file), "utf-8");

  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
};

const readStyles = async () => {
  const entries = await readdir(stylesDir);
  const files = entries.filter((file) => file.endsWith(".css"));

  return await Promise.all(
    files.map(async (file) => ({ file, css: await readWithoutComments(file) }))
  );
};

const declarations = async (property: RegExp) => {
  const styles = await readStyles();

  const pattern = new RegExp(
    `(?<![\\w-])(?<property>${property.source}):\\s*(?<value>[^;{}]+);`,
    "gu"
  );

  return styles.flatMap(({ file, css }) =>
    [...css.matchAll(pattern)].map((match) => ({
      file,
      property: match.groups?.property ?? "",
      value: (match.groups?.value ?? "").replaceAll(/\s+/gu, " ").trim(),
    }))
  );
};

const describeOffScale = (
  found: { file: string; property: string; value: string }[]
) => found.map(({ file, property, value }) => `${file}: ${property}: ${value}`);

const remValues = (value: string) =>
  [...value.matchAll(/(?<![\w.-])-?(?<size>\d*\.?\d+)rem\b/gu)].map((match) =>
    Number(match.groups?.size)
  );

describe("the design scale", () => {
  it("keeps hex colors, breakpoints and :root tokens in tokens.css", async () => {
    const styles = await readStyles();

    const outsideTokens = styles
      .filter(({ file }) => file !== "tokens.css")
      .flatMap(({ file, css }) =>
        [
          ...css.matchAll(
            /#[\da-f]{3,8}\b|@custom-media [^;]+|:root\s*\{[^}]*?--[a-z][^:]*:/giu
          ),
        ].map((match) => `${file}: ${match[0].replaceAll(/\s+/gu, " ")}`)
      );

    expect(outsideTokens).toStrictEqual([]);
  });

  it("gives every hex color token a P3 value, except --felt-deep", async () => {
    const tokens = await readWithoutComments("tokens.css");

    const [root = "", wideGamut = ""] = tokens.split(
      "@media (color-gamut: p3)"
    );

    const hexTokens = [
      ...root.matchAll(/(?<name>--[a-z\d-]+):\s*#[\da-f]{6};/giu),
    ].map((match) => match.groups?.name);

    const p3Tokens = [
      ...wideGamut.matchAll(/(?<name>--[a-z\d-]+):\s*oklch\(/giu),
    ].map((match) => match.groups?.name);

    expect(hexTokens.length).toBeGreaterThan(0);
    expect(p3Tokens).toStrictEqual(
      hexTokens.filter((name) => name !== "--felt-deep")
    );
  });

  it("sizes interface text with the --text scale", async () => {
    const found = await declarations(/font-size/u);

    const offScale = found.filter(({ value }) => {
      if (
        /^(?:var\(--(?:text-[a-z\d]+|ui-font-size)\)|inherit)$/u.test(value)
      ) {
        return false;
      }

      if (/^(?:clamp|calc)\(/u.test(value)) {
        return false;
      }

      const [size] = remValues(value);

      return size === undefined || (size !== 1 && size < 1.5);
    });

    expect(describeOffScale(offScale)).toStrictEqual([]);
  });

  it("uses Inter's 400, 600, 700 and 800 and the numerals' 900", async () => {
    const found = await declarations(/font-weight/u);

    const offScale = found.filter(
      ({ value }) => !["400", "600", "700", "800", "900"].includes(value)
    );

    expect(describeOffScale(offScale)).toStrictEqual([]);
  });

  it("spaces letters with the --tracking scale", async () => {
    const found = await declarations(/letter-spacing/u);

    const offScale = found.filter(
      ({ value }) => !/^(?:var\(--tracking-[a-z]+\)|0|normal)$/u.test(value)
    );

    expect(describeOffScale(offScale)).toStrictEqual([]);
  });

  it("sets unitless line heights with the --leading scale", async () => {
    const found = await declarations(/line-height/u);

    const offScale = found.filter(
      ({ value }) => !/^(?:var\(--leading-[a-z]+\)|[\d.]+rem)$/u.test(value)
    );

    expect(describeOffScale(offScale)).toStrictEqual([]);
  });

  it("times transitions with the --duration scale", async () => {
    const found = await declarations(/transition(?:-duration|-delay)?/u);

    const offScale = found.filter(({ value }) =>
      /(?<![\w.-])(?!0s\b)\d*\.?\d+m?s\b/u.test(value)
    );

    expect(describeOffScale(offScale)).toStrictEqual([]);
  });

  it("spaces with Tailwind's steps: eighths of a rem to 1rem, then quarters", async () => {
    const found = await declarations(
      /gap|row-gap|column-gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?/u
    );

    const offScale = found.filter(({ value }) =>
      remValues(value).some((size) => {
        const step = size < 1 ? 0.125 : 0.25;

        return !Number.isInteger(size / step);
      })
    );

    expect(describeOffScale(offScale)).toStrictEqual([]);
  });
});
