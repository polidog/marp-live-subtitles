import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Marp Live Subtitles",
    description:
      "Marp プレゼンテーション上に、発表者の音声を Gemini Live Translation でリアルタイム翻訳した字幕を表示します。",
    permissions: ["storage", "offscreen", "tabs"],
    host_permissions: ["https://generativelanguage.googleapis.com/*"],
    action: {
      default_title: "Marp Live Subtitles",
    },
  },
});
