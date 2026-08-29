import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@clpc/types": path.resolve(__dirname, "../types/src/index.ts"),
      "@clpc/mcp-client": path.resolve(__dirname, "../mcp-client/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});