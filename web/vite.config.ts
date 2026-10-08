import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on Django (port 8000); Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.API_URL || "http://127.0.0.1:8000", changeOrigin: true } },
  },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false, chunkSizeWarningLimit: 900 },
});
