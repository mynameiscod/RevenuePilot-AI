import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: process.env.VITE_DEV_HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
    strictPort: true,
    allowedHosts: process.env.PREVIEW_HOST ? [process.env.PREVIEW_HOST] : [],
    proxy: { "/api": { target: "http://127.0.0.1:4000", changeOrigin: false } },
  },
});
