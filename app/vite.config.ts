import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // One JS file only: an open tab must never depend on a chunk file that a later deploy deletes
  // (that broke sending quotes/invoices with "Failed to fetch dynamically imported module").
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 4000, rollupOptions: { output: { inlineDynamicImports: true } } },
  test: { include: ["src/**/*.test.ts"] },
} as never);
