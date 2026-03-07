import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/dummy",
  },
});
