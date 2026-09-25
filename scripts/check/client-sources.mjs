// client のソースを走査するガード（client-styles.mjs / ui-copy.mjs）が共有するファイル収集。
//
// components/ui（shadcn の生成物）は shadcn CLI の更新で上書きされるので対象外。テストと生成ルート表も
// 画面の実装ではないので対象外。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXCLUDED_DIRS = ["apps/client/components/ui"];
const EXCLUDED_FILES = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /routeTree\.gen\.ts$/];

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

function collectFiles(dir) {
  if (!isDir(dir) || EXCLUDED_DIRS.includes(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (isDir(path)) {
      return collectFiles(path);
    }
    if (!/\.tsx?$/.test(name) || EXCLUDED_FILES.some((re) => re.test(name))) {
      return [];
    }
    return [path];
  });
}

// 走査対象の移動・改名で対象が 0 件になると、違反なしとして成功してしまう。対象が無ければ失敗させる。
export function collectClientSources(roots, scriptPath) {
  const missingRoots = roots.filter((root) => !isDir(root));
  const files = roots.flatMap(collectFiles);
  if (missingRoots.length > 0 || files.length === 0) {
    console.log(`走査対象が見つかりません: ${missingRoots.join(", ") || "（ファイル 0 件）"}`);
    console.log(`client のディレクトリ構成を変えたら ${scriptPath} の ROOTS を更新してください`);
    process.exit(1);
  }
  return files;
}
