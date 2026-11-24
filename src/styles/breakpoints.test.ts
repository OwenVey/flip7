import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const stylesDir = import.meta.dirname;
const tableSource = path.resolve(stylesDir, "../components/table.tsx");

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

const customMedia = async () => {
  const base = await readWithoutComments("tokens.css");

  const rules = base.matchAll(
    /^@custom-media (?<name>--[a-z-]+) (?<query>[^;]+);$/gmu
  );

  return new Map(
    [...rules].map((match) => [
      match.groups?.name ?? "",
      match.groups?.query ?? "",
    ])
  );
};

const negations = new Map([
  ["<", ">="],
  ["<=", ">"],
  [">", "<="],
  [">=", "<"],
]);

const negate = (query: string) => {
  const parts = /^\((?<feature>[a-z]+) (?<op>[<>]=?) (?<size>[^)]+)\)$/u.exec(
    query
  )?.groups;

  if (parts === undefined) {
    throw new Error(`Cannot negate ${query}`);
  }

  return `(${parts.feature} ${negations.get(parts.op ?? "")} ${parts.size})`;
};

const expand = (query: string, defined: Map<string, string>) =>
  query
    .replaceAll(/\(not \((?<name>--[a-z-]+)\)\)/gu, (_, name: string) =>
      negate(defined.get(name) ?? "")
    )
    .replaceAll(
      /\((?<name>--[a-z-]+)\)/gu,
      (_, name: string) => defined.get(name) ?? ""
    )
    .replaceAll(" or ", ", ");

describe("breakpoints", () => {
  it("are three sizes: Tailwind's sm and lg widths and one height", async () => {
    const defined = await customMedia();

    const sizes = [...defined.values()].flatMap((query) =>
      [...query.matchAll(/\((?<size>[a-z]+ [<>]=? [\d.]+rem)\)/gu)].map(
        (match) => match.groups?.size
      )
    );

    expect(sizes).toStrictEqual([
      "width >= 40rem",
      "width >= 64rem",
      "height <= 30rem",
    ]);
  });

  it("are never written as sizes in a media query", async () => {
    const styles = await readStyles();

    const sizedMediaQueries = styles.flatMap(({ file, css }) =>
      [...css.matchAll(/@media[^{]*\d(?:rem|em|px)[^{]*/gu)].map(
        (match) => `${file}: ${match[0].trim()}`
      )
    );

    expect(sizedMediaQueries).toStrictEqual([]);
  });

  it("are all defined in tokens.css", async () => {
    const defined = await customMedia();
    const styles = await readStyles();

    const used = [
      ...styles.flatMap(({ css }) =>
        [...css.matchAll(/@media[^{]*/gu)].map((match) => match[0])
      ),
      ...defined.values(),
    ].flatMap((query) =>
      [...query.matchAll(/\((?<name>--[a-z-]+)\)/gu)].map(
        (match) => match.groups?.name ?? ""
      )
    );

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toStrictEqual([]);
  });

  it("keep the table's sheet query in step with --sheet-table", async () => {
    const defined = await customMedia();
    const table = await readFile(tableSource, "utf-8");

    const query = /const SHEET_TABLE_QUERY = "(?<query>[^"]+)";/u.exec(table)
      ?.groups?.query;

    expect(query).toBe(expand(defined.get("--sheet-table") ?? "", defined));
  });
});
