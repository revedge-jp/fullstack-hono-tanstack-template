import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({ srcDirectory: "app" }),
    react(),
    tailwindcss(),
  ],
  // @better-auth/core/async_hooks を pure(browser/edge)バリアントへ alias しないこと。
  // workerd には globalThis.AsyncLocalStorage が無く、pure 版は並行安全でない単一スロットの
  // 代替実装に落ちる。同じ isolate で重なった getSession が互いのリクエスト状態を消し合い
  // "Failed to get session"(500)になる。既定の "workerd" 条件(nodejs_compat の
  // node:async_hooks)で解決させる。回帰は e2e の tasks.spec.ts が並行リクエストで検出する。
  resolve: {
    tsconfigPaths: true,
  },
});
