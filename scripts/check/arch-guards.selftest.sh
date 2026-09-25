#!/bin/bash
# アーキテクチャガードの自己テスト。
#
# 目的: 「ガードが書いてある」だけでなく「ガードが実際に違反を検出する」ことを保証する。
# 各ガードに対し既知の違反 fixture を一時的に作成し、ガードがそれを検出して失敗する
# （期待する違反メッセージを出す）ことを確認する。ガードが壊れて違反を見逃すと、
# この自己テストが失敗する（= false negative の検出）。
#
# 各ケースは arch-guards-lib.sh の検査関数を1つだけ直接呼ぶ（自己テスト全体を速く保つため）。
#
# 背景: dependency-cruiser の feature 間依存禁止ルールが正規表現バックリファレンス
#        （from の capture group を to で \1 参照する書き方）に依存しており、実際には
#        機能していなかった（dependency-cruiser は from/to 間のバックリファレンスを
#        サポートしない）。ガード自体にテストが無かったことが原因。このスクリプトは
#        その再発を防ぐ。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=./arch-guards-lib.sh
source "$ROOT/scripts/check/arch-guards-lib.sh"

FAIL=0
FIXTURES=()
cleanup() {
  local f dir
  for f in "${FIXTURES[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  # mkfix の mkdir -p が作った __selftest* ディレクトリも消す(参照実装の tasks 配下に空ディレクトリが
  # 残ると、構造を真似るエージェントの目に入る)。rmdir は空のときしか消さないので、fixture 以外は残る
  for f in "${FIXTURES[@]:-}"; do
    [ -n "$f" ] || continue
    dir="$(dirname "$f")"
    while [[ "$dir" == *__selftest* ]]; do
      rmdir "$dir" 2>/dev/null || break
      dir="$(dirname "$dir")"
    done
  done
  rm -rf "apps/api-service/src/features/tasks/application/__selftest_action" 2>/dev/null || true
}
trap cleanup EXIT

mkfix() { # $1 path, $2 content
  mkdir -p "$(dirname "$1")"
  printf '%s' "$2" >"$1"
  FIXTURES+=("$1")
}

# 検査関数を1つだけ直接呼び、「期待する違反メッセージ」を出して失敗することを確認する。
# 以前は arch-guards.sh をまるごと再実行していたため、後ろの検査を試すたびに前の全検査の
# スキャンも払っていた（arch-guards-lib.sh 冒頭の説明）。
# run_guard は条件の中で呼ばない（set -e が無効になり素通りしうる）。コマンド置換で受ける。
expect_guard() { # $1 ラベル, $2 検査関数, $3 fixtureパス, $4 fixture内容, $5 期待メッセージ部分文字列
  mkfix "$3" "$4"
  local out rc
  out=$(run_guard "$2" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qF "$5"; then
    echo "✅ $1"
  else
    echo "❌ $1: $2 が期待した違反 '$5' を検出できませんでした（ガードが壊れている可能性。exit=$rc）"
    FAIL=1
  fi
  rm -f "$3"
}

D="apps/api-service/src/features/tasks"

echo "=== arch-guards 自己テスト ==="

expect_guard "window.location.href 代入禁止" \
  guard_window_location_href \
  "apps/client/features/__selftest/ui/selftest-location.tsx" \
  'export function selftestLocation() { window.location.href = "/foo"; }' \
  "window.location.href への代入は禁止"

expect_guard "GitHub Actions 未ピン留め検出" \
  guard_actions_pinned_sha \
  ".github/workflows/__selftest_unpinned.yml" \
  $'name: selftest\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n' \
  "commit SHA でピン留め"

expect_guard "id-token: write 検出" \
  guard_no_id_token_write \
  ".github/workflows/__selftest_idtoken.yml" \
  $'name: selftest\non: push\npermissions:\n  id-token: write\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' \
  "id-token: write が付与"

expect_guard "throw 禁止" \
  guard_no_throw \
  "$D/application/__selftest_throw.ts" \
  'export function selftestThrow() { throw new Error("x"); }' \
  "throw の使用が禁止"

expect_guard "class 禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_class.ts" \
  'export class SelftestFoo {}' \
  "class の使用が禁止"

# 以前の regex `^\s*(export\s+)?class\b` が見逃していた形を回帰テストする
expect_guard "abstract class 禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_abstract_class.ts" \
  'abstract class SelftestAbstract {}' \
  "class の使用が禁止"

expect_guard "export default class 禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_default_class.ts" \
  'export default class SelftestDefault {}' \
  "class の使用が禁止"

expect_guard "interface 禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_interface.ts" \
  'export interface SelftestBar { x: number }' \
  "interface の使用が禁止"

expect_guard "application→infrastructure 直参照禁止" \
  guard_application_no_infrastructure \
  "$D/application/__selftest_infra.ts" \
  'import { createTasksRepository } from "../infrastructure/tasks.repository.drizzle";
export const selftestInfra = createTasksRepository;' \
  "application 層から infrastructure を直接参照できません"

expect_guard "application→integrations 直参照禁止" \
  guard_application_no_integrations \
  "$D/application/__selftest_integrations.ts" \
  'import { createAuth } from "@app/integrations/external/auth";
export const selftestIntegrations = createAuth;' \
  "application 層で integrations を直接参照できません"

expect_guard "application→fetch 直叩き禁止" \
  guard_application_no_fetch \
  "$D/application/__selftest_fetch.ts" \
  'export const selftestFetch = () => fetch("https://example.com");' \
  "application 層で fetch を直接呼び出すことは禁止"

expect_guard "application→axios/node-fetch 禁止" \
  guard_application_no_http_client \
  "$D/application/__selftest_axios.ts" \
  'import axios from "axios";
export const selftestAxios = axios;' \
  "直接 HTTP クライアント（axios/node-fetch）の使用が禁止"

expect_guard "application→@google-cloud 禁止" \
  guard_application_no_google_cloud \
  "$D/application/__selftest_gcp.ts" \
  'import { CloudTasksClient } from "@google-cloud/tasks";
export const selftestGcp = CloudTasksClient;' \
  "@google-cloud/* を直接参照できません"

expect_guard "features 配下 process.env 直接参照禁止" \
  guard_features_no_process_env \
  "$D/application/__selftest_env.ts" \
  'export const selftestEnv = process.env.SELFTEST;' \
  "features 配下で process.env を直接参照できません"

expect_guard "client features process.env 直接参照禁止" \
  guard_client_features_no_process_env \
  "apps/client/features/__selftest/queries/get-x.ts" \
  'export const selftestEnv = process.env.SELFTEST;' \
  "client features 配下で process.env を直接参照できません"

expect_guard "UI からの processXxx 直接 import 禁止" \
  guard_ui_no_process_import \
  "apps/client/features/__selftest/ui/x.tsx" \
  'import { processFoo } from "../actions/foo";
export const SelftestUi = processFoo;' \
  "UI コンポーネントから processXxx を直接 import できません"

# client のスタイル規約(client-styles.mjs)は規則ごとに 1 件ずつ既知違反を置く。
expect_guard "スタイル規約: 既定パレット色の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="text-sm text-zinc-500">x</p>;' \
  "違反 [raw-palette]"

expect_guard "スタイル規約: important 付き既定パレット色の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="text-zinc-500!">x</p>;' \
  "違反 [raw-palette]"

expect_guard "スタイル規約: 任意プロパティの禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="[color:#7c3aed]">x</p>;' \
  "違反 [arbitrary-property]"

expect_guard "スタイル規約: 任意値の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <div className="w-[347px]">x</div>;' \
  "違反 [arbitrary-value]"

expect_guard "スタイル規約: dark: 手書きの禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <div className="bg-card dark:bg-muted">x</div>;' \
  "違反 [manual-dark-variant]"

expect_guard "スタイル規約: 子の margin で間隔を作らない" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="sm:mt-2">x</p>;' \
  "違反 [margin-spacing]"

expect_guard "スタイル規約: 論理プロパティの margin（mbs）で間隔を作らない" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="mbs-2">x</p>;' \
  "違反 [margin-spacing]"

expect_guard "スタイル規約: space-y で間隔を作らない" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <div className="space-y-4">x</div>;' \
  "違反 [margin-spacing]"

expect_guard "スタイル規約: 数字始まりのバリアントが続く dark: の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <div className="dark:2xl:bg-card">x</div>;' \
  "違反 [manual-dark-variant]"

expect_guard "スタイル規約: グラデーション背景の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <div className="bg-linear-to-r from-primary to-accent">x</div>;' \
  "違反 [gradient]"

expect_guard "スタイル規約: グラデーション文字の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <h1 className="bg-clip-text text-transparent">x</h1>;' \
  "違反 [gradient-text]"

expect_guard "スタイル規約: すりガラスの禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <div className="backdrop-blur-md">x</div>;' \
  "違反 [glassmorphism]"

expect_guard "スタイル規約: 絵文字の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p>🚀 Launch</p>;' \
  "違反 [emoji]"

# コメントも検査対象（禁止クラス名を書いたコメントは変更履歴なので書かない）。
# 行内・行全体のどちらのコメントも検出することを確認する。
expect_guard "スタイル規約: 行末コメント中の禁止クラス" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="text-muted-foreground">x</p>; // 旧 text-zinc-500' \
  "違反 [raw-palette]"

expect_guard "スタイル規約: 行全体のコメント中の禁止クラス" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  '// 以前は bg-linear-to-r だった
export const SelftestUi = () => <p className="text-muted-foreground">x</p>;' \
  "違反 [gradient]"

# 逆向き（誤検出）の回帰テスト: 正当なコードで client-styles.mjs が通ることを確認する。
mkfix "apps/client/features/__selftest/ui/selftest-style-ok.tsx" \
  'export const labels = { light: "Light", dark: "Dark" };
export const C = () => <a href="https://example.com/a//b" className="p-4 data-[state=open]:bg-muted">x</a>;
export const D = () => <p>© 2026 → 次へ</p>;'
if STYLE_OK_OUT=$(node scripts/check/client-styles.mjs 2>&1); then
  echo "✅ スタイル規約: 正当なコード（dark キー・URL・任意バリアント・記号）を誤検出しない"
else
  echo "❌ スタイル規約: 正当なコードを誤検出しました"
  printf '%s\n' "$STYLE_OK_OUT"
  FAIL=1
fi
rm -f "apps/client/features/__selftest/ui/selftest-style-ok.tsx"

expect_guard "@hono/zod-validator 直接 import 禁止" \
  guard_no_direct_zod_validator \
  "$D/presentation/__selftest_zv.ts" \
  'import { zValidator } from "@hono/zod-validator"; export const selftestZv = zValidator;' \
  "@hono/zod-validator を直接 import せず"

expect_guard "旧 @repo/result API (result.type ===) 禁止" \
  guard_no_legacy_result_api \
  "$D/application/__selftest_legacy_result.ts" \
  'export function selftestLegacy(result: { type: string }) {
  if (result.type === "ok") return true;
  return false;
}' \
  "旧 @repo/result API です"

expect_guard "usecase.ts の async 禁止" \
  guard_usecase_result_chain \
  "$D/application/__selftest_usecase_async/usecase.ts" \
  'export async function makeSelftestAsync() {
  return async () => null;
}' \
  "usecase.ts で async は禁止です"

# 以前の regex `\basync\s+function\b|\basync\s*\(` が見逃していた形を回帰テストする
expect_guard "usecase.ts の async 括弧なしアロー禁止" \
  guard_usecase_result_chain \
  "$D/application/__selftest_usecase_async_arrow/usecase.ts" \
  'import { okAsync } from "neverthrow";
export function makeSelftestAsyncArrow() {
  return async req => okAsync(req);
}' \
  "usecase.ts で async は禁止です"

expect_guard "usecase.ts の async メソッド短縮記法禁止" \
  guard_usecase_result_chain \
  "$D/application/__selftest_usecase_async_method/usecase.ts" \
  'import { okAsync } from "neverthrow";
export const selftestAsyncMethod = {
  async run() {
    return okAsync(null);
  },
};' \
  "usecase.ts で async は禁止です"

expect_guard "usecase.ts の try/catch 禁止" \
  guard_usecase_result_chain \
  "$D/application/__selftest_usecase_try/usecase.ts" \
  'import { okAsync } from "neverthrow";
export function makeSelftestTry() {
  return function selftestTry() {
    try {
      return okAsync(null);
    } catch {
      return okAsync(null);
    }
  };
}' \
  "usecase.ts で try/catch は禁止です"

expect_guard "usecase.ts は Result チェーン必須" \
  guard_usecase_result_chain \
  "$D/application/__selftest_usecase_chain/usecase.ts" \
  'export function makeSelftestChain() {
  return function selftestChain() {
    return Promise.resolve(null);
  };
}' \
  "Result チェーンである必要があります"

expect_guard "ports.ts は application/ 直下のみ" \
  guard_ports_placement \
  "$D/__selftest_ports/ports.ts" \
  'export type SelftestPort = { x(): void };' \
  "ports.ts は features/<feature>/application/ports.ts にのみ配置してください"

expect_guard "createAuthedApp は requireAuth 必須" \
  guard_authed_router_requires_auth \
  "$D/presentation/__selftest_authed_router.ts" \
  'import { createAuthedApp } from "@app/factory";
export function createSelftestAuthedRouter() {
  return createAuthedApp().get("/", (c) => c.json({ ok: true }));
}' \
  "createAuthedApp() を使うファイルには .use(requireAuth(...)) の登録が必要です"

# 1 ファイルに 2 ルーター。片方だけ requireAuth を付け忘れたケース（以前は「どこかに 1 つでも
# requireAuth があれば OK」だったため見逃していた）を回帰テストする。
expect_guard "createAuthedApp 複数ルーターで片方が requireAuth 欠落" \
  guard_authed_router_requires_auth \
  "$D/presentation/__selftest_two_routers.ts" \
  'import { createAuthedApp } from "@app/factory";
export function createGuarded(deps) {
  return createAuthedApp().use(requireAuth(deps.getSession)).get("/", (c) => c.json({ ok: true }));
}
export function createUnguarded() {
  return createAuthedApp().get("/", (c) => c.json({ ok: true }));
}' \
  "createAuthedApp() を使うファイルには .use(requireAuth(...)) の登録が必要です"

# kebab-case: camelCase の（テストでない）ファイルは違反として検出される
expect_guard "kebab-case: camelCase ファイル名は違反" \
  guard_kebab_case \
  "$D/application/selftestCamelName.ts" \
  'export const selftestCamel = 1;' \
  "ファイル名は kebab-case にしてください"

# kebab-case: camelCase でも .test.ts は除外される（除外規則が実際に到達・機能する回帰テスト）。
# expect_guard は「違反を検出する」検証なので、除外（＝違反にならない）はここで個別に検証する。
KEBAB_NEG="apps/api-service/src/shared/__selftest/fooBarBaz.test.ts"
mkfix "$KEBAB_NEG" 'export const x = 1;'
kebab_out=$(run_guard guard_kebab_case 2>&1)
if printf '%s' "$kebab_out" | grep -qF "fooBarBaz.test.ts"; then
  echo "❌ kebab-case 除外（.test.ts）: camelCase なテストファイルが誤検出された"
  FAIL=1
else
  echo "✅ kebab-case 除外（.test.ts は camelCase でも許容）"
fi
rm -f "$KEBAB_NEG"

SELFTEST_ACTION_DIR="$D/application/__selftest_action"
mkdir -p "$SELFTEST_ACTION_DIR"
# 有効な usecase.ts を置くが usecase.test.ts は作らない
# → feature 構造チェックが「co-located テスト欠落」を検出するはず
printf 'import { okAsync } from "neverthrow";\nexport function makeSelftestAction() {\n  return () => okAsync(null);\n}\n' >"$SELFTEST_ACTION_DIR/usecase.ts"
st_out=$(run_guard guard_feature_structure 2>&1)
if printf '%s' "$st_out" | grep -qF "usecase.test.ts がありません"; then
  echo "✅ feature 構造（co-located テスト欠落）"
else
  echo "❌ feature 構造: co-located テスト欠落を検出できませんでした"
  FAIL=1
fi
rm -rf "$SELFTEST_ACTION_DIR"

echo "=== dependency-cruiser 自己テスト ==="
if [ "${SKIP_DC:-0}" = "1" ]; then
  echo "⏭  dep-cruiser 自己テストはスキップ (SKIP_DC=1)"
else
  # 過去に silently 壊れていた「feature 間の直接依存禁止」ルールを重点的に検証する
  mkfix "$D/application/__selftest_dc_cross_feature.ts" 'import { reconstituteActivity } from "@app/features/activity/domain/models";
export const selftestDcCrossFeature = reconstituteActivity;'
  mkfix "$D/presentation/__selftest_dc_infra.ts" 'import { createTasksRepository } from "../infrastructure/tasks.repository.drizzle";
export const selftestDcInfra = createTasksRepository;'
  mkfix "$D/domain/__selftest_dc_db.ts" 'import { tasks } from "@repo/db";
export const selftestDcDb = tasks;'
  DC_OUT=$(bunx depcruise -c dependency-cruiser.config.cjs apps/api-service/src 2>/dev/null || true)
  for rule in server-application-cross-features-tasks server-presentation-no-infra-or-domain server-domain-no-db; do
    if printf '%s' "$DC_OUT" | grep -q "$rule"; then
      echo "✅ dep-cruiser: $rule"
    else
      echo "❌ dep-cruiser: $rule が違反を検出しませんでした"
      FAIL=1
    fi
  done
  rm -f "$D/application/__selftest_dc_cross_feature.ts" "$D/presentation/__selftest_dc_infra.ts" "$D/domain/__selftest_dc_db.ts"
fi

echo "=== 指示ファイル参照チェック自己テスト ==="
mkfix ".claude/rules/__selftest_refs.md" \
  '参照: `scripts/check/nope.sh` と `bun run no-such-script` と AGENTS.md の「存在しない見出し」
アプリ別: `apps/api-service/AGENTS.md` の「Feature structure」「パス付きの存在しない見出し」と apps/no-such-app/AGENTS.md の「X」'
INSTR_OUT=$(node scripts/check/instruction-files.mjs 2>&1 || true)
rm -f ".claude/rules/__selftest_refs.md"
for expected in "nope.sh" "no-such-script" "「存在しない見出し」" \
  "apps/api-service/AGENTS.md に見出し「パス付きの存在しない見出し」" "apps/no-such-app/AGENTS.md\` が実在しない"; do
  if printf '%s' "$INSTR_OUT" | grep -qF "$expected"; then
    echo "✅ instruction-files: $expected を検出"
  else
    echo "❌ instruction-files: $expected を検出できませんでした"
    FAIL=1
  fi
done

echo "=== PreToolUse フック(検証器保護)自己テスト ==="
if ! bash .claude/hooks/protect-verifiers.selftest.sh; then
  FAIL=1
fi

echo ""
if [ "$FAIL" = "0" ]; then
  echo "✅ ガード自己テスト: 全ガードが既知違反を検出"
  exit 0
else
  echo "❌ ガード自己テスト: 違反を見逃したガードがあります（ガードの実装を確認してください）"
  exit 1
fi
