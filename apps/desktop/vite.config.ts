import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/renderer"),
  resolve: {
    alias: {
      "@clpc/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@clpc/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@clpc/model-providers": path.resolve(
        __dirname,
        "../../packages/model-providers/src/index.ts"
      ),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});