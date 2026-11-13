import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "apps/web",
  plugins: [
    react(),
    {
      name: "revenuepilot-intake-sdk",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (
            req.url?.split("?")[0] !== "/revenuepilot-sdk.js" ||
            !["GET", "HEAD"].includes(req.method ?? "")
          )
            return next();
          try {
            const result = await build({
              entryPoints: [
                fileURLToPath(
                  new URL("./packages/sdk/src/index.ts", import.meta.url),
                ),
              ],
              bundle: true,
              write: false,
              platform: "browser",
              target: "es2022",
              format: "esm",
            });
            res.setHeader(
              "Content-Type",
              "application/javascript; charset=utf-8",
            );
            // Public code asset only. The form API still checks each allowed origin.
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Cache-Control", "no-store");
            res.end(
              req.method === "HEAD" ? undefined : result.outputFiles[0].text,
            );
          } catch (error) {
            next(error as Error);
          }
        });
      },
    },
  ],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: process.env.VITE_DEV_HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
    strictPort: true,
    allowedHosts: process.env.PREVIEW_HOST ? [process.env.PREVIEW_HOST] : [],
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: false,
      },
    },
  },
});
