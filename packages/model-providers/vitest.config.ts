import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@clpc/types": path.resolve(__dirname, "../types/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});