/** embed/ を Marp の HTML に貼れる 1 ファイル（dist/live-subtitles.js）に固める */
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "embed/main.tsx",
      formats: ["iife"],
      name: "LiveSubtitles",
      fileName: () => "live-subtitles.js",
    },
  },
});
