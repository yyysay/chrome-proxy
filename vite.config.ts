import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 扩展仍在功能调试阶段，保留可读的行号和函数名。
    minify: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        onboarding: resolve(import.meta.dirname, "onboarding.html"),
        "service-worker": resolve(
          import.meta.dirname,
          "src/background/service-worker.ts",
        ),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
