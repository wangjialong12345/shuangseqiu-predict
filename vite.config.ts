import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
    proxy: {
      "/official-cwl-api": {
        target: "https://www.cwl.gov.cn",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/official-cwl-api/, ""),
      },
    },
  },
});
