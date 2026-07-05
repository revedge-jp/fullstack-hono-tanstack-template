import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
// drizzle-kit 実行時のみ厳格に検証する。無条件に throw すると、この設定ファイルを
// ロードするだけの静的解析ツール（knip 等）まで巻き添えで落ちるため。
const isDrizzleKit = process.argv.some((arg) => arg.includes("drizzle-kit"));
if (!databaseUrl && isDrizzleKit) {
  throw new Error(
    "DATABASE_URL is not set. Provide it via .env (drizzle-kit コマンドは dotenv 経由で読み込む) before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl ?? "",
  },
});
