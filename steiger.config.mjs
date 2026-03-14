import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      // スケルトン段階のノイズ回避。実装進行後に有効化を推奨
      "fsd/insignificant-slice": "off",
    },
  },
  {
    // TanStack Start の API プロキシルート（フレームワーク規定のパス）
    files: ["apps/client/app/routes/api/**"],
    rules: {
      "fsd/no-reserved-folder-names": "off",
    },
  },
]);
