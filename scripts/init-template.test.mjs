import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// init-template.sh の回帰テスト。テンプレートを受け取る経路（ZIP・clone 後の .git 作り直し）では
// ファイルがまだ追跡されていないので、追跡中のファイルだけを探すと何も置換せず「初期化済み」で終わる。
// 実際のテンプレート一式（作業ツリーのファイル）を展開して、どの経路でもプレースホルダーが残らないことを見る。
const ROOT = join(import.meta.dir, "..");
// git のフック（pre-push）の中では GIT_DIR 等が設定されている。子プロセスに引き継ぐと、git は cwd ではなく
// そのリポジトリを見る（一時ディレクトリの init-template が本体のリポジトリを検索する）ので外す
const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
// このファイル自身が置換対象にならないよう、プレースホルダーは組み立てる
const PLACEHOLDER = ["{{", "APP_NAME", "}}"].join("");
// 仕組みそのものを説明・処理しているので置換しないファイル（init-template.sh の EXCLUDES と同じ）
const EXCLUDED = ["docs/dev/troubleshooting.md", "scripts/init-template.sh"];

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 作業ツリーのファイル（追跡中と、.gitignore の対象外の未追跡）を展開する。git archive HEAD だと
// コミットしていない変更が入らず、手元で直したスクリプトを試せない
function extractTemplate() {
  const dir = mkdtempSync(join(tmpdir(), "init-template-"));
  dirs.push(dir);
  // 末尾が / の行は入れ子のリポジトリ（.claude/worktrees/<name>/ 等）。tar が中身（node_modules まで）を
  // たどってバッファを超えるので除く
  const listed = execFileSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], {
    cwd: ROOT,
    env: CLEAN_ENV,
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = Buffer.from(
    listed
      .toString("utf8")
      .split("\0")
      .filter((path) => path !== "" && !path.endsWith("/"))
      .map((path) => `${path}\0`)
      .join(""),
    "utf8",
  );
  const archive = execFileSync("tar", ["--null", "-T", "-", "-cf", "-"], {
    cwd: ROOT,
    input: files,
    maxBuffer: 512 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive, maxBuffer: 512 * 1024 * 1024 });
  return dir;
}

function runInit(dir, appName) {
  return spawnSync("bash", ["scripts/init-template.sh", appName], {
    cwd: dir,
    env: CLEAN_ENV,
    encoding: "utf8",
  });
}

function remainingPlaceholders(dir) {
  const result = spawnSync("grep", ["-rlF", PLACEHOLDER, "."], { cwd: dir, encoding: "utf8" });
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replace(/^\.\//, ""))
    .filter((path) => !EXCLUDED.includes(path));
}

function git(dir, ...args) {
  execFileSync("git", args, { cwd: dir, env: CLEAN_ENV, stdio: "ignore" });
}

// 初期化済みの派生プロジェクトでは、複製する作業ツリーにプレースホルダーが無く、テストが必ず失敗して
// pre-push が通らなくなる。作業ツリーがテンプレートのまま（wrangler.jsonc にプレースホルダーがある）ときだけ走らせる
const WRANGLER = join(ROOT, "apps/client/wrangler.jsonc");
const IS_TEMPLATE = existsSync(WRANGLER) && readFileSync(WRANGLER, "utf8").includes(PLACEHOLDER);

describe.skipIf(!IS_TEMPLATE)("init-template.sh", () => {
  test.each([
    ["git リポジトリではない（ZIP で取得した直後）", (_dir) => {}],
    [
      "git init しただけで何もコミットしていない（.git を作り直した直後）",
      (dir) => git(dir, "init", "-q"),
    ],
  ])("%s でもプレースホルダーを置換する", (_label, prepare) => {
    const dir = extractTemplate();
    prepare(dir);

    const result = runInit(dir, "my-app");

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("すでに初期化済み");
    expect(remainingPlaceholders(dir)).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name).toBe("my-app");
    expect(readFileSync(join(dir, ".env.example"), "utf8")).toContain(
      "POSTGRES_CONTAINER_NAME=my-app_postgres",
    );
  });

  test("2 回目は初期化済みとして何も変えない", () => {
    const dir = extractTemplate();
    expect(runInit(dir, "my-app").status).toBe(0);

    const second = runInit(dir, "my-app");

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("すでに初期化済み");
  });
});
