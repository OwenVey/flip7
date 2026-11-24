import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
}).trim();

const baseRef = process.argv[2] ?? "main";
const outputDir = path.join(".cloudflare", "output");
const work = mkdtempSync(path.join(tmpdir(), "compare-built-css-"));
const baseTree = path.join(work, "base");

const run = (command: string, args: string[], cwd: string) => {
  execFileSync(command, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });
};

const readPackage = (cwd: string) => {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(cwd, "package.json"), "utf-8")
  );

  if (!(manifest instanceof Object) || Array.isArray(manifest)) {
    throw new TypeError(`Invalid package.json in ${cwd}.`);
  }

  Reflect.deleteProperty(manifest, "scripts");

  return manifest;
};

const checkDependencyInputs = () => {
  for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    if (
      !readFileSync(path.join(baseTree, file)).equals(
        readFileSync(path.join(repo, file))
      )
    ) {
      throw new Error(
        `Cannot compare CSS with shared dependencies because ${file} differs from ${baseRef}.`
      );
    }
  }

  if (!isDeepStrictEqual(readPackage(baseTree), readPackage(repo))) {
    throw new Error(
      `Cannot compare CSS with shared dependencies because package.json differs from ${baseRef} beyond scripts.`
    );
  }
};

const buildCss = (cwd: string, label: string) => {
  process.stdout.write(`Building ${label}…\n`);
  rmSync(path.join(cwd, outputDir), { force: true, recursive: true });
  run(
    process.execPath,
    [path.join(repo, "node_modules/vite/bin/vite.js"), "build"],
    cwd
  );

  const output = path.join(cwd, outputDir);
  const bundles = new Map<string, string>();

  for (const file of readdirSync(output, {
    encoding: "utf-8",
    recursive: true,
  })) {
    if (file.endsWith(".css")) {
      bundles.set(
        file.replace(/-[\w-]{8}\.css$/u, ".css"),
        readFileSync(path.join(output, file), "utf-8")
      );
    }
  }

  return bundles;
};

const oneRulePerLine = (css: string) =>
  `${css.replaceAll(/(?<end>[{};])/gu, "$<end>\n").replaceAll(/\n+/gu, "\n")}\n`;

const showDiff = (key: string, before: string, after: string) => {
  const beforeFile = path.join(work, "before.css");
  const afterFile = path.join(work, "after.css");

  writeFileSync(beforeFile, oneRulePerLine(before));
  writeFileSync(afterFile, oneRulePerLine(after));
  process.stdout.write(`DIFFERS    ${key}\n`);
  spawnSync(
    "git",
    ["diff", "--no-index", "--no-color", "--unified=2", beforeFile, afterFile],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
};

try {
  run("git", ["worktree", "add", "--detach", baseTree, baseRef], repo);
  checkDependencyInputs();
  symlinkSync(
    path.join(repo, "node_modules"),
    path.join(baseTree, "node_modules")
  );

  const base = buildCss(baseTree, baseRef);
  const head = buildCss(repo, "working tree");
  let differs = false;

  for (const key of new Set([...base.keys(), ...head.keys()])) {
    const before = base.get(key);
    const after = head.get(key);

    if (before === after) {
      process.stdout.write(`identical  ${key}\n`);
    } else if (before === undefined || after === undefined) {
      differs = true;
      process.stdout.write(
        `only in ${before === undefined ? "working tree" : baseRef}  ${key}\n`
      );
    } else {
      differs = true;
      showDiff(key, before, after);
    }
  }

  process.exitCode = differs ? 1 : 0;
} finally {
  if (existsSync(baseTree)) {
    run("git", ["worktree", "remove", "--force", baseTree], repo);
  }

  rmSync(work, { force: true, recursive: true });
}
