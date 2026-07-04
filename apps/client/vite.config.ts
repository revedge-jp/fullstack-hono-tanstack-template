import { createRequire } from "node:module";
import path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @better-auth/core/async_hooks の pure（dynamic import なし）バリアントを解決する。
// better-auth の "workerd" 条件が dynamic import("node:async_hooks") 版を指しているため、
// CF Workers では起動エラーになる。"browser"/"edge" バリアント（pure.index.mjs）は
// Promise.resolve() + globalThis を使用するため CF Workers でも動作する。
// better-auth v1.5.5 時点で "workerd" 条件が未修正のため引き続き必要。
const _require = createRequire(import.meta.url);
const betterAuthMain = _require.resolve("better-auth");
const betterAuthSharedNodeModules = path.dirname(path.dirname(path.dirname(betterAuthMain)));
const betterAuthAsyncHooksPure = path.join(
  betterAuthSharedNodeModules,
  "@better-auth/core/dist/async_hooks/pure.index.mjs",
);

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({ srcDirectory: "app" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@better-auth/core/async_hooks": betterAuthAsyncHooksPure,
    },
  },
});
