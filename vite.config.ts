import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        "pdf-helper": "pdf-helper.html",
        bookHelper: here("book-helper.html"),
        modelHelper: here("model-helper.html"),
        psdHelper: here("psd-helper.html"),
      },
    },
  },
  test: {
    pool: "vmThreads",
    maxWorkers: 2,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
