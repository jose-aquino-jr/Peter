import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/tools/local-stt/model/**", "**/tools/local-stt/.venv/**"],
    },
    proxy: {
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
      "/stt": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stt/, ""),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
