import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import landmines from "ultracite/oxlint/landmines";
import solid from "ultracite/oxlint/solid";
import vitest from "ultracite/oxlint/vitest";

const jsPlugins = selectJsPlugins(["react-doctor"]);

export default defineConfig({
  env: core.env,
  extends: [core, solid, vitest, jsPlugins, landmines, antiSlop],
  ignorePatterns: ["**/*.gen.*", "dist", "file-routes.d.ts"],
  jsPlugins: ["eslint-plugin-solid"],
  settings: jsPluginSettings,
  options: { typeAware: true, typeCheck: true },
  overrides: [
    {
      files: ["src/routes/**"],
      rules: { "react-doctor/only-export-components": "off" },
    },
  ],
});
