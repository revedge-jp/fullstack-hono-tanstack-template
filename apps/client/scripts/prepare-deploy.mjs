/**
 * vite build が生成した dist/server/wrangler.json に
 * wrangler.jsonc の env 固有設定（name, vars, hyperdrive）を注入する。
 *
 * Usage: node scripts/prepare-deploy.mjs <staging|production>
 */
import { readFileSync, writeFileSync } from "node:fs";

const env = process.argv[2];
if (!env) {
  throw new Error("Usage: prepare-deploy.mjs <staging|production>");
}

// JSONC（// コメント付き）を通常の JSON として解析する。
// 文字列リテラル内の // (例: https://) は除去しない。
function stripComments(str) {
  let result = "";
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' && str[i - 1] !== "\\") {
      inString = !inString;
      result += ch;
    } else if (!inString && ch === "/" && str[i + 1] === "/") {
      while (i < str.length && str[i] !== "\n") {
        i++;
      }
      continue;
    } else if (!inString && ch === "/" && str[i + 1] === "*") {
      i += 2;
      while (i < str.length && !(str[i] === "*" && str[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

const wranglerConfig = JSON.parse(stripComments(readFileSync("wrangler.jsonc", "utf8")));
const deployConfig = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));

const envConfig = wranglerConfig.env?.[env];
if (!envConfig) {
  throw new Error(`wrangler.jsonc に env.${env} が見つかりません`);
}

const merged = {
  ...deployConfig,
  name: envConfig.name ?? deployConfig.name,
  vars: { ...deployConfig.vars, ...envConfig.vars },
  hyperdrive: envConfig.hyperdrive ?? deployConfig.hyperdrive ?? [],
};

writeFileSync("dist/server/wrangler.json", JSON.stringify(merged, null, 2));
console.log(`✓ dist/server/wrangler.json に ${env} env config を注入しました`);
