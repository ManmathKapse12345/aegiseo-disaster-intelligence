import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dev server proxies API calls to the FastAPI backend so the browser talks to one origin.
const API = process.env.AEGIS_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/metrics": { target: API, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ["maplibre-gl"], react: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
