// review-converged-head.sh の自己テスト。一時ディレクトリに使い捨ての git リポジトリを作って確かめる
// （どのリポジトリに取り込んでも同じ結果になる）。実行: bun test ./.claude/scripts/review-converged-head.selftest.mjs
// 収束の宣言より後に入った変更を止め、base を自動で取り込んだだけのマージは止めないことを固定する。
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./review-converged-head.sh", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "review-converged-head-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// フック（pre-push など）の中で回ると GIT_DIR などが引き継がれ、一時リポジトリでなく呼び出し元を操作してしまう。
// GIT_ で始まる変数を外し、一時リポジトリのコミットで呼び出し元のフック（lefthook など）が走らないようにする。
// 開発者のグローバル・システムの git 設定（merge.ff=only など）でも結果が変わらないよう、それも読ませない
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(...args) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} が失敗: ${result.stderr}`);
  }
  return result.stdout.trim();
}

// 衝突させるマージのように、失敗が想定どおりの git 操作
function gitAllowFailure(...args) {
  spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

function commitFile(path, content, message) {
  writeFileSync(join(root, path), `${content}\n`);
  git("add", path);
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
}

function judge(...args) {
  return judgeWith(env, ...args);
}

function judgeWith(judgeEnv, ...args) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: root,
    encoding: "utf8",
    env: judgeEnv,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function declaredFromBody(body) {
  const result = spawnSync("bash", [SCRIPT, "--declared-from-body"], {
    encoding: "utf8",
    env,
    input: body,
  });
  return { status: result.status, sha: result.stdout.trim() };
}

function shortHead() {
  return git("rev-parse", "--short", "HEAD");
}

git("init", "-q", "-b", "main");
git("config", "user.email", "selftest@example.com");
git("config", "user.name", "selftest");
git("config", "commit.gpgsign", "false");

commitFile("shared.txt", "base", "chore: 起点");
git("switch", "-qc", "feature");
const declared = commitFile("feature.txt", "v1", "feat: 機能");
git("switch", "-q", "main");
const otherBranchRoot = commitFile("main.txt", "main", "chore: main に別の PR");
const base = commitFile("shared.txt", "main changed", "chore: main で共有ファイルを変更");

describe("通す", () => {
  test("宣言した head のまま", () => {
    expect(judge(declared, "feature", base).status).toBe(0);
  });

  test("7 桁の短縮形で宣言", () => {
    expect(judge(declared.slice(0, 7), "feature", base).status).toBe(0);
  });

  test("base を自動で取り込んだマージ", () => {
    git("switch", "-qc", "clean-merge", "feature");
    git("merge", "-q", "--no-edit", "main");
    expect(judge(declared, "HEAD", base).status).toBe(0);
  });
});

// 検出は終了コードに加えて、理由の行に名指しされたコミットを見る（判定が別の理由で落ちたのを検出と取り違えない）
describe("止める", () => {
  test("宣言より後のコミット", () => {
    git("switch", "-qc", "extra-commit", "feature");
    commitFile("feature.txt", "v2", "fix: 収束のあとに足した修正");
    const result = judge(declared, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${shortHead()}: `);
  });

  test("取り込みのあとのコミット（base のコミットは除いても、PR のコミットは残る）", () => {
    git("switch", "-qc", "merge-then-commit", "feature");
    git("merge", "-q", "--no-edit", "main");
    commitFile("feature.txt", "v3", "fix: 取り込みのあとに足した修正");
    const result = judge(declared, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${shortHead()}: `);
  });

  test("衝突を手で解いたマージ", () => {
    git("switch", "-qc", "conflict", "feature");
    const declaredConflict = commitFile(
      "shared.txt",
      "feature changed",
      "feat: 共有ファイルを変更",
    );
    gitAllowFailure("merge", "-q", "--no-edit", "main");
    commitFile("shared.txt", "resolved by hand", "Merge branch 'main' into conflict");
    expect(git("rev-list", "--no-walk", "--parents", "HEAD").split(" ")).toHaveLength(3);
    const result = judge(declaredConflict, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${shortHead()}: 衝突を手で解いたマージ`);
  });

  test("自動で解けるマージに手を加えた", () => {
    git("switch", "-qc", "evil", "feature");
    git("merge", "-q", "--no-commit", "main");
    commitFile("sneaked.txt", "sneaked", "Merge branch 'main' into evil");
    const result = judge(declared, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${shortHead()}: 自動マージの結果に手を加えたマージ`);
  });

  test("base ではない別のブランチの取り込み（そのブランチのコミットはレビューを通っていない）", () => {
    git("switch", "-qc", "other", `${otherBranchRoot}~1`);
    commitFile("other.txt", "other", "feat: 別のブランチ");
    const otherCommit = shortHead();
    git("switch", "-qc", "merge-other", "feature");
    git("merge", "-q", "--no-edit", "other");
    const result = judge(declared, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${otherCommit}: `);
  });

  test("rebase で宣言したコミットが head の祖先でない", () => {
    git("switch", "-qc", "rebased", "feature");
    git("rebase", "-q", "main");
    const result = judge(declared, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain("祖先ではありません");
  });

  test("存在しない SHA", () => {
    const result = judge("0123456789abcdef0123456789abcdef01234567", "feature", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain("見つかりません");
  });
});

describe("判定できないときは 2（違反の 1 と分ける）", () => {
  test("head を解決できない", () => {
    expect(judge(declared, "no-such-ref", base).status).toBe(2);
  });

  test("引数が足りない", () => {
    expect(judge(declared, "HEAD").status).toBe(2);
  });

  // merge-tree が判定できない（終了コード 2 以上）状況を、merge-tree だけ失敗させる偽の git で作る
  const fakeBin = join(root, "..", `${root.split("/").pop()}-fake-bin`);
  const realGit = spawnSync("bash", ["-c", "command -v git"], {
    encoding: "utf8",
    env,
  }).stdout.trim();
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(
    join(fakeBin, "git"),
    `#!/usr/bin/env bash\n[ "$1" = merge-tree ] && exit 128\nexec "${realGit}" "$@"\n`,
  );
  chmodSync(join(fakeBin, "git"), 0o755);
  afterAll(() => {
    rmSync(fakeBin, { recursive: true, force: true });
  });
  const brokenMergeTreeEnv = { ...env, PATH: `${fakeBin}:${env.PATH}` };

  test("マージを再現できないだけなら 2", () => {
    git("switch", "-qc", "undetermined", "feature");
    git("merge", "-q", "--no-edit", "main");
    const result = judgeWith(brokenMergeTreeEnv, declared, "HEAD", base);
    expect(result.status).toBe(2);
    expect(result.output).toContain(`${shortHead()}: マージを再現できません`);
  });

  test("判定できないマージがあっても、ほかの違反を報告して 1", () => {
    git("switch", "-qc", "undetermined-and-violation", "feature");
    git("merge", "-q", "--no-edit", "main");
    commitFile("feature.txt", "v4", "fix: 取り込みのあとに足した修正");
    const result = judgeWith(brokenMergeTreeEnv, declared, "HEAD", base);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${shortHead()}: 宣言より後のコミット`);
  });
});

describe("本文から収束を宣言した SHA を取り出す", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  test("末尾の行の SHA", () => {
    expect(declaredFromBody(`本文\nレビュー収束: 最終周 CONFIRMED 0 @ ${sha}\n`)).toEqual({
      status: 0,
      sha,
    });
  });

  test("受け入れた限界を含む書式と CRLF・末尾の空白", () => {
    const body = `本文\r\nレビュー収束: 最終周 CONFIRMED 0（受け入れた限界 2 件を除く） @ ${sha}  \r\n`;
    expect(declaredFromBody(body)).toEqual({ status: 0, sha });
  });

  test("大文字の SHA は小文字にする", () => {
    expect(declaredFromBody(`レビュー収束: 最終周 CONFIRMED 0 @ ${sha.toUpperCase()}`)).toEqual({
      status: 0,
      sha,
    });
  });

  test("書式の例や古い行が上にあっても、最後の行を使う", () => {
    const body = [
      "```",
      "レビュー収束: 最終周 CONFIRMED 0 @ <head の SHA>",
      "```",
      "レビュー収束: 最終周 CONFIRMED 0 @ deadbee",
      `レビュー収束: 最終周 CONFIRMED 0 @ ${sha}`,
    ].join("\n");
    expect(declaredFromBody(body)).toEqual({ status: 0, sha });
  });

  test("最後の行に SHA が無ければ、上の行の SHA を使わない", () => {
    const body = `レビュー収束: 最終周 CONFIRMED 0 @ ${sha}\nレビュー収束: 最終周 CONFIRMED 0`;
    expect(declaredFromBody(body).status).toBe(4);
  });

  test("行が無い", () => {
    expect(declaredFromBody("本文だけ\nレビュー往復: 1周（主な指摘: なし）").status).toBe(3);
  });

  test("CONFIRMED が 0 でない行は数えない", () => {
    expect(declaredFromBody(`レビュー収束: 最終周 CONFIRMED 2 @ ${sha}`).status).toBe(3);
  });

  test("最後の行が CONFIRMED 0 でなければ、上の古い CONFIRMED 0 の行で通さない", () => {
    const body = `レビュー収束: 最終周 CONFIRMED 0 @ ${sha}\nレビュー収束: 最終周 CONFIRMED 3 @ deadbee`;
    expect(declaredFromBody(body).status).toBe(3);
  });

  test("CONFIRMED 05 のように 0 で始まる数は 0 と読まない", () => {
    expect(declaredFromBody(`レビュー収束: 最終周 CONFIRMED 05 @ ${sha}`).status).toBe(3);
  });
});
