import { build } from "esbuild";
await build({
  entryPoints: {
    api: "apps/api/src/index.ts",
    worker: "apps/worker/src/index.ts",
    collector: "apps/collector/src/index.ts",
  },
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node24",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
});
await build({
  entryPoints: ["packages/sdk/src/index.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  outfile: "dist/web/revenuepilot-sdk.js",
  minify: true,
});
