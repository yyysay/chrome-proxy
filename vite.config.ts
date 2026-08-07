import { resolve } from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    // 扩展页面和 Service Worker 属于不同执行上下文；共享 chunk 的 preload
    // 会被 Chrome 判定为 cross-world resource mismatch。只保留正常 ESM import。
    modulePreload: {
      polyfill: false,
      resolveDependencies: () => [],
    },
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        onboarding: resolve(import.meta.dirname, "onboarding.html"),
        settings: resolve(import.meta.dirname, "settings.html"),
        "service-worker": resolve(import.meta.dirname, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
