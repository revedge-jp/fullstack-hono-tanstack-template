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
    echo "❌ $1: $2 が期待した違反 '$5' を検出できませんでした（ガードが壊れている可能性。exit=${rc}）"
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

expect_guard "id-token: write 検出（フロー形式）" \
  guard_no_id_token_write \
  ".github/workflows/__selftest_idtoken.yml" \
  $'name: selftest\non: push\npermissions: { contents: read, id-token: write }\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' \
  "id-token: write が付与"

expect_guard "id-token: write 検出（write-all）" \
  guard_no_id_token_write \
  ".github/workflows/__selftest_idtoken.yml" \
  $'name: selftest\non: push\npermissions: write-all\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' \
  "id-token: write が付与"

expect_guard "throw 禁止" \
  guard_no_throw \
  "$D/application/__selftest_throw.ts" \
  'export function selftestThrow() { throw new Error("x"); }' \
  "throw の使用が禁止"

# プロパティキーとしての throw(Better Auth の onAPIError)は許容し、同じファイルの throw 文は検出する
expect_guard "throw 禁止（プロパティキーと並んでも throw 文は検出）" \
  guard_no_throw \
  "$D/application/__selftest_throw_key.ts" \
  'export const selftestOptions = { throw: true };
export function selftestThrow() { throw new Error("x"); }' \
  "__selftest_throw_key.ts:2:"
expect_guard "throw 禁止（同じ行に \`throw:\` があっても throw 文は検出）" \
  guard_no_throw \
  "$D/application/__selftest_throw_key_same_line.ts" \
  'export function selftestThrow() { throw new Error("x"); } // throw: 後で ROP へ移す' \
  "__selftest_throw_key_same_line.ts:1:"
THROW_KEY_NEG="$D/application/__selftest_throw_key_only.ts"
mkfix "$THROW_KEY_NEG" 'export const selftestOptions = { throw: true };'
throw_key_out=$(run_guard guard_no_throw 2>&1)
if printf '%s' "$throw_key_out" | grep -qF "__selftest_throw_key_only.ts"; then
  echo "❌ throw 禁止: プロパティキーの throw を違反として誤検出しました"
  FAIL=1
else
  echo "✅ throw 禁止（プロパティキーは許容）"
fi
rm -f "$THROW_KEY_NEG"

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

expect_guard "export default interface 禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_default_interface.ts" \
  'export default interface SelftestDefaultBar { x: number }' \
  "interface の使用が禁止"

expect_guard "declare interface 禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_declare_interface.ts" \
  'export declare interface SelftestDeclareBar { x: number }' \
  "interface の使用が禁止"

expect_guard "クラス式禁止" \
  guard_no_class_interface \
  "$D/application/__selftest_class_expression.ts" \
  'export const SelftestExpr = class { x = 1 };' \
  "class の使用が禁止"

expect_guard "throw 禁止（src/config.ts 以外の config.ts）" \
  guard_no_throw \
  "$D/application/config.ts" \
  'export function selftestConfig() { throw new Error("x"); }' \
  "throw の使用が禁止"

expect_guard "GitHub Actions 未ピン留め検出（行末のコメントに : # がある）" \
  guard_actions_pinned_sha \
  ".github/workflows/__selftest_unpinned.yml" \
  $'name: selftest\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4 # pinned later, see: #123\n' \
  "commit SHA でピン留め"

expect_guard "features 配下 process.env 直接参照禁止（oxfmt が折り返した import）" \
  guard_features_no_process_env \
  "$D/application/__selftest_env.ts" \
  $'import {\n  arch,\n  env,\n  pid,\n} from "node:process";\nexport const selftestEnv = [arch, env.SELFTEST, pid];' \
  "features 配下で process.env を直接参照できません"

expect_guard "client process.env 直接参照禁止（node:process の default import）" \
  guard_client_features_no_process_env \
  "apps/client/shared/lib/__selftest_env.ts" \
  $'import nodeProcess from "node:process";\nexport const selftestEnv = nodeProcess.env.SELFTEST;' \
  "で process.env を直接参照できません"

expect_guard "client queries のサーバー専用モジュール（型の import と並んだ値の import・折り返した形）" \
  guard_client_queries_server_modules \
  "apps/client/features/tasks/queries/__selftest-query.ts" \
  $'import type { ApiClient } from "@/shared/lib/api-client";\nimport {\n  getApiClient,\n} from "../../../shared/lib/api-client";\nexport const selftestQuery = (): ApiClient => getApiClient();' \
  "createServerFn のファイルだけ"

expect_guard "client queries のサーバー専用モジュール（createServerFn の外）" \
  guard_client_queries_server_modules \
  "apps/client/features/tasks/queries/__selftest-query.ts" \
  $'import { getApiClient } from "@/shared/lib/api-client";\nexport const selftestQuery = () => getApiClient();' \
  "createServerFn のファイルだけ"

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

expect_guard "features 配下 process.env 直接参照禁止（分割代入）" \
  guard_features_no_process_env \
  "$D/application/__selftest_env.ts" \
  'const { SELFTEST } = process.env;
export const selftestEnv = SELFTEST;' \
  "features 配下で process.env を直接参照できません"

expect_guard "features 配下 process.env 直接参照禁止（node:process の env）" \
  guard_features_no_process_env \
  "$D/application/__selftest_env.ts" \
  'import { env } from "node:process";
export const selftestEnv = env.SELFTEST;' \
  "features 配下で process.env を直接参照できません"

expect_guard "features 配下 process.env 直接参照禁止（const { env } = process）" \
  guard_features_no_process_env \
  "$D/application/__selftest_env.ts" \
  'const { env } = process;
export const selftestEnv = env.SELFTEST;' \
  "features 配下で process.env を直接参照できません"

expect_guard "features 配下 process.env 直接参照禁止（Bun.env）" \
  guard_features_no_process_env \
  "$D/application/__selftest_env.ts" \
  'export const selftestEnv = Bun.env.SELFTEST;' \
  "features 配下で process.env を直接参照できません"

expect_guard "client features process.env 直接参照禁止" \
  guard_client_features_no_process_env \
  "apps/client/features/__selftest/queries/get-x.ts" \
  'export const selftestEnv = process.env.SELFTEST;' \
  "で process.env を直接参照できません"

expect_guard "client features process.env 直接参照禁止（ブラケット記法）" \
  guard_client_features_no_process_env \
  "apps/client/features/__selftest/queries/get-x.ts" \
  'export const selftestEnv = process.env["SELFTEST"];' \
  "で process.env を直接参照できません"

# features/ の外（app/・shared/・components/）も見ていることを確かめる。検査範囲を features に戻すと落ちる
expect_guard "client process.env 直接参照禁止（app/ 配下）" \
  guard_client_features_no_process_env \
  "apps/client/app/__selftest_env.ts" \
  'export const selftestEnv = process.env.SELFTEST;' \
  "で process.env を直接参照できません"

expect_guard "createServerFn の配置（shared/ 配下）" \
  guard_server_fn_placement \
  "apps/client/shared/lib/__selftest_server_fn.ts" \
  'import { createServerFn } from "@tanstack/react-start";
export const selftestFn = createServerFn().handler(() => null);' \
  "createServerFn は features/**/queries/**"

# api-process-env.sh（features 以外の integrations / routes / middlewares / shared も見る）
mkfix "apps/api-service/src/shared/__selftest_env.ts" 'export const selftestEnv = process.env["SELFTEST"];'
API_ENV_OUT=$(bash scripts/check/api-process-env.sh 2>&1)
API_ENV_RC=$?
rm -f "apps/api-service/src/shared/__selftest_env.ts"
if [ "$API_ENV_RC" -ne 0 ] && printf '%s' "$API_ENV_OUT" | grep -qF "__selftest_env.ts"; then
  echo "✅ api-process-env: shared 配下のブラケット記法を検出"
else
  echo "❌ api-process-env: shared 配下の process.env[\"X\"] を検出できませんでした（exit=${API_ENV_RC}）"
  FAIL=1
fi
# cloudflare:workers から env を取り出すのは違反、DurableObject 等の import は違反にしない
mkfix "apps/api-service/src/shared/__selftest_env.ts" 'import { DurableObject, env } from "cloudflare:workers";
export const selftestEnv = [DurableObject, env];'
API_ENV_OUT=$(bash scripts/check/api-process-env.sh 2>&1)
API_ENV_RC=$?
mkfix "apps/api-service/src/shared/__selftest_env.ts" 'import { DurableObject } from "cloudflare:workers";
export const selftestDurableObject = DurableObject;'
API_ENV_NEG_RC=0
bash scripts/check/api-process-env.sh >/dev/null 2>&1 || API_ENV_NEG_RC=$?
rm -f "apps/api-service/src/shared/__selftest_env.ts"
if [ "$API_ENV_RC" -ne 0 ] && [ "$API_ENV_NEG_RC" -eq 0 ]; then
  echo "✅ api-process-env: cloudflare:workers の env は検出し、DurableObject は通す"
else
  echo "❌ api-process-env: cloudflare:workers の判定が違います（env を含む import: exit=${API_ENV_RC} / DurableObject だけ: exit=${API_ENV_NEG_RC}）"
  FAIL=1
fi

expect_guard "createServerFn の配置（queries 以外は禁止）" \
  guard_server_fn_placement \
  "apps/client/features/__selftest/ui/x.tsx" \
  'import { createServerFn } from "@tanstack/react-start";
export const selftestFn = createServerFn().handler(() => null);' \
  "createServerFn は features/**/queries/**"

# mutation を createServerFn にして actions/ に置く形も検出する（Workers では自オリジンへの
# ループバックができない。apps/client/AGENTS.md）
expect_guard "createServerFn の配置（actions/ の mutation も禁止）" \
  guard_server_fn_placement \
  "apps/client/features/__selftest/actions/x.ts" \
  'import { createServerFn } from "@tanstack/react-start";
export const selftestFn = createServerFn({ method: "POST" }).handler(() => null);' \
  "createServerFn は features/**/queries/**"

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

expect_guard "スタイル規約: h1 の直書きの禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <h1 className="text-xl font-semibold">x</h1>;' \
  "違反 [raw-page-heading]"

expect_guard "スタイル規約: 絵文字の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p>🚀 Launch</p>;' \
  "違反 [emoji]"

expect_guard "スタイル規約: style 属性の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p style={{ color: "#7c3aed", marginTop: 12 }}>x</p>;' \
  "違反 [inline-style]"

expect_guard "スタイル規約: SVG の fill に直接書いた色の禁止" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <svg><path fill="#ff0000" d="M0 0" /></svg>;' \
  "違反 [svg-raw-color]"

expect_guard "スタイル規約: shared/ 配下も走査する" \
  guard_client_styles \
  "apps/client/shared/__selftest/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="text-zinc-500">x</p>;' \
  "違反 [raw-palette]"

expect_guard "スタイル規約: 文章の中央揃え（text-center）" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="text-sm text-center">x</p>;' \
  "違反 [centered-text]"

expect_guard "スタイル規約: バリアント付きの text-center" \
  guard_client_styles \
  "apps/client/features/__selftest/ui/selftest-style.tsx" \
  'export const SelftestUi = () => <p className="text-left md:text-center">x</p>;' \
  "違反 [centered-text]"

# components/ は inline-style の対象外なので、style で中央揃えにする形は centered-text が拾う
expect_guard "スタイル規約: style の textAlign で中央揃え（components/）" \
  guard_client_styles \
  "apps/client/components/__selftest/selftest-style.tsx" \
  'export const SelftestUi = () => <p style={{ textAlign: "center" }}>x</p>;' \
  "違反 [centered-text]"

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

# client の日本語文言(ui-copy.mjs)は検出の経路ごとに 1 件ずつ既知違反を置く。
expect_guard "UI 文言: AI が書く文章に出やすい語（プリセットの辞書）" \
  guard_ui_copy \
  "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const SelftestUi = () => <p>この設定が効きます</p>;' \
  "\"効く\" は"

expect_guard "UI 文言: 追加の辞書（scripts/check/ai-words.json）" \
  guard_ui_copy \
  "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const SelftestUi = () => <p aria-label="シームレスな連携">x</p>;' \
  "\"シームレス\" は"

expect_guard "UI 文言: 誇張表現" \
  guard_ui_copy \
  "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const selftestCopy = (count: number) => `${count} 件の革命的な改善`;' \
  "違反 [@textlint-ja/ai-writing/no-ai-hype-expressions]"

expect_guard "UI 文言: 全角ダッシュ" \
  guard_ui_copy \
  "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const selftestCopy = "保存しました——一覧に戻ります";' \
  "違反 [fullwidth-dash]"

expect_guard "UI 文言: 前後に空白のある全角ダッシュ" \
  guard_ui_copy \
  "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const selftestCopy = "保存しました — 一覧に戻ります";' \
  "違反 [fullwidth-dash]"

# 逆向き（誤検出）の回帰テスト: 正当なコードで client-styles.mjs が通ることを確認する。
mkfix "apps/client/features/__selftest/ui/selftest-style-ok.tsx" \
  'export const labels = { light: "Light", dark: "Dark" };
export const C = () => <a href="https://example.com/a//b" className="p-4 data-[state=open]:bg-muted">x</a>;
export const D = () => <p>© 2026 → 次へ</p>;
export const E = () => <svg><path fill="currentColor" stroke="none" d="M0 0" /></svg>;
export const F = () => <div className="flex items-center justify-center text-left">x</div>;
export const G = () => <Popover align="center">x</Popover>;'
# style 属性は components/ の部品の中だけは許す（値が実行時に決まるものを閉じ込める場所）
mkfix "apps/client/components/__selftest/selftest-style-ok.tsx" \
  'export const Bar = ({ pct }: { pct: number }) => <div className="h-2 bg-primary" style={{ width: `${pct}%` }} />;'
if STYLE_OK_OUT=$(node scripts/check/client-styles.mjs 2>&1); then
  echo "✅ スタイル規約: 正当なコード（dark キー・URL・任意バリアント・記号）を誤検出しない"
else
  echo "❌ スタイル規約: 正当なコードを誤検出しました"
  printf '%s\n' "$STYLE_OK_OUT"
  FAIL=1
fi
rm -f "apps/client/features/__selftest/ui/selftest-style-ok.tsx" "apps/client/components/__selftest/selftest-style-ok.tsx"

# 逆向き（誤検出）の回帰テスト: 画面に出ないコメントと、文をつないでいないダッシュ（空欄の「—」・括弧の中・
# 区切り線・数字の範囲）では ui-copy.mjs が落ちない。ダッシュの例は日本語を含めて、ダッシュの判定まで届くようにしている。
mkfix "apps/client/features/__selftest/ui/selftest-copy-ok.tsx" \
  '// この設定が効く（コメントは画面に出ない）
export const SelftestUi = () => <td>—</td>;
export const selftestUnset = "未設定（—）";
export const selftestDivider = "──── または ────";
export const selftestRange = "1—3 件";'
if COPY_OK_OUT=$(node scripts/check/ui-copy.mjs 2>&1); then
  echo "✅ UI 文言: 正当なコード（コメント・文をつないでいないダッシュ）を誤検出しない"
else
  echo "❌ UI 文言: 正当なコードを誤検出しました"
  printf '%s\n' "$COPY_OK_OUT"
  FAIL=1
fi
rm -f "apps/client/features/__selftest/ui/selftest-copy-ok.tsx"

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

# client の actions / queries もテストが無いファイルを検出する（カバレッジは import されないファイルを数えない）
expect_guard "feature 構造（client の actions のテスト欠落）" \
  guard_feature_structure \
  "apps/client/features/tasks/actions/__selftest-untested.ts" \
  'export const selftestUntested = 1;' \
  "actions/__selftest-untested.ts に co-located テスト"

expect_guard "feature 構造（client の actions のサブディレクトリのテスト欠落）" \
  guard_feature_structure \
  "apps/client/features/tasks/actions/__selftest-bulk/archive.ts" \
  'export const selftestUntested = 1;' \
  "actions/__selftest-bulk/archive.ts に co-located テスト"
rmdir "apps/client/features/tasks/actions/__selftest-bulk" 2>/dev/null || true

# **本体（arch-guards.sh）が全検査を実際に呼ぶことの検証。** 上の各ケースは検査関数を直接呼ぶので、
# 本体から検査が抜ける・並べ忘れる・ループが失敗を握りつぶす、を捕まえられない。
# (1) 定義済みの guard_* 関数の集合と ARCH_GUARDS の集合が一致すること（件数ではなく集合で比べる。
#     関数を1つ足して別の1つを並べ忘れる、名前を打ち間違える、のように件数が合ってしまう形を捕まえるため）
DEFINED_GUARDS=$(declare -F | awk '{print $3}' | grep '^guard_' | sort)
LISTED_GUARDS=$(printf '%s\n' "${ARCH_GUARDS[@]}" | sort)
if [ "$DEFINED_GUARDS" = "$LISTED_GUARDS" ]; then
  echo "✅ ARCH_GUARDS に定義済みの全検査関数が並んでいる"
else
  echo "❌ ARCH_GUARDS と定義済みの検査関数が一致しません（並べ忘れ・消し忘れ・打ち間違い）"
  diff <(printf '%s\n' "$DEFINED_GUARDS") <(printf '%s\n' "$LISTED_GUARDS") | sed 's/^/    /'
  FAIL=1
fi
# (2) 構造チェックが ARCH_GUARDS の最後にあること。下の (3) はこれを前提にしている
#     （新しい検査を末尾に足すと、本体が構造チェックで止まって新しい検査まで届かない）
LAST_GUARD="${ARCH_GUARDS[${#ARCH_GUARDS[@]}-1]}"
if [ "$LAST_GUARD" = "guard_feature_structure" ]; then
  echo "✅ ARCH_GUARDS の最後が guard_feature_structure"
else
  echo "❌ ARCH_GUARDS の最後が $LAST_GUARD です。guard_feature_structure を最後に置き、新しい検査はその前に並べてください"
  FAIL=1
fi
# (3) 本体を実行し、全検査を順に呼ぶこと。この時点で置いている fixture は最後の検査（構造チェック）に
#     だけ引っかかるので、本体は全検査を実行したうえで最後に失敗するはず
e2e_out=$(bash scripts/check/arch-guards.sh 2>&1)
e2e_rc=$?
e2e_headers=$(printf '%s\n' "$e2e_out" | grep -c '^\[guard\]')
defined_count=$(printf '%s\n' "$DEFINED_GUARDS" | grep -c .)
if [ "$e2e_rc" -ne 0 ] && [ "$e2e_headers" -eq "$defined_count" ] &&
  printf '%s' "$e2e_out" | grep -qF "usecase.test.ts がありません"; then
  echo "✅ arch-guards.sh が全 ${defined_count} 検査を実行し、違反で失敗する"
else
  echo "❌ arch-guards.sh: exit=${e2e_rc}、実行した検査 ${e2e_headers}/${defined_count}（全検査を実行して違反で失敗するはず）"
  FAIL=1
fi
rm -rf "$SELFTEST_ACTION_DIR"
# (4) 本体が途中の違反で止まること。(3) は最後の検査の違反なので、本体の set -e が外れて「全検査を
#     最後まで回し、最後の検査の終了コードで終わる」状態でも通ってしまう。guard_export_star にだけ
#     引っかかる fixture を置き、本体がその検査で止まる（見出しの数 = その検査の位置）ことを確かめる。
#     位置は ARCH_GUARDS から求めるので、並べ替えや先頭への追加では誤検出しない
STOP_GUARD="guard_export_star"
stop_index=0
for guard in "${ARCH_GUARDS[@]}"; do
  stop_index=$((stop_index + 1))
  [ "$guard" = "$STOP_GUARD" ] && break
done
mkfix "$D/application/__selftest_export_star.ts" 'export * from "./nope";'
stop_out=$(bash scripts/check/arch-guards.sh 2>&1)
stop_rc=$?
stop_headers=$(printf '%s\n' "$stop_out" | grep -c '^\[guard\]')
if ! printf '%s' "$stop_out" | grep -qF "export * の使用が禁止"; then
  echo "❌ arch-guards.sh: $STOP_GUARD が export * の違反を検出しませんでした（検査が壊れているか、ARCH_GUARDS から外れている）"
  FAIL=1
elif [ "$stop_rc" -ne 0 ] && [ "$stop_headers" -eq "$stop_index" ]; then
  echo "✅ arch-guards.sh が途中の違反（${STOP_GUARD}、${stop_index} 番目）で止まる"
else
  echo "❌ arch-guards.sh: ${stop_index} 番目の $STOP_GUARD の違反で exit=${stop_rc}、実行した検査 ${stop_headers}（そこで止まるはず。本体の set -e が外れていないか）"
  FAIL=1
fi
rm -f "$D/application/__selftest_export_star.ts"

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
  # npm パッケージへのルール（hono の解決先 node_modules/…/hono/dist/ が exclude の部分一致で消えると空振りする）
  mkfix "$D/application/__selftest_dc_hono.ts" 'import { Hono } from "hono";
export const selftestDcHono = Hono;'
  mkfix "$D/domain/__selftest_dc_zod.ts" 'import { z } from "zod";
export const selftestDcZod = z;'
  # 実際のコードで使う形（サブパスと import type）。素の値 import だけを試すと、この 2 つの空振りに気づけない
  mkfix "$D/application/__selftest_dc_hono_subpath.ts" 'import { createMiddleware } from "hono/factory";
export const selftestDcHonoSubpath = createMiddleware;'
  mkfix "$D/application/__selftest_dc_hono_type.ts" 'import type { Context } from "hono";
export type SelftestDcHonoType = Context;'
  # application 以外の層からの越境と、domain から integrations への依存（以前は application だけ・typo で空振りしていた）
  mkfix "$D/infrastructure/__selftest_dc_infra_cross.ts" 'import { reconstituteActivity } from "@app/features/activity/domain/models";
export const selftestDcInfraCross = reconstituteActivity;'
  mkfix "$D/domain/__selftest_dc_domain_integrations.ts" 'import { readAuthApiError } from "@app/integrations/external/auth";
export const selftestDcDomainIntegrations = readAuthApiError;'
  DC_OUT=$(bunx depcruise -c dependency-cruiser.config.cjs apps/api-service/src 2>/dev/null || true)
  for fixture in __selftest_dc_infra_cross __selftest_dc_domain_integrations; do
    if printf '%s' "$DC_OUT" | grep -q "$fixture"; then
      echo "✅ dep-cruiser: ${fixture#__selftest_dc_} を検出"
    else
      echo "❌ dep-cruiser: $fixture の依存を検出しませんでした（feature 間・domain → integrations の規則を確認）"
      FAIL=1
    fi
  done
  for rule in server-cross-features-tasks server-presentation-no-infra-or-domain server-domain-no-db \
    server-features-no-web-framework server-domain-no-framework-libs; do
    if printf '%s' "$DC_OUT" | grep -q "$rule"; then
      echo "✅ dep-cruiser: $rule"
    else
      echo "❌ dep-cruiser: $rule が違反を検出しませんでした"
      FAIL=1
    fi
  done
  for fixture in __selftest_dc_hono_subpath __selftest_dc_hono_type; do
    if printf '%s' "$DC_OUT" | grep "server-features-no-web-framework" -A 2 | grep -q "$fixture"; then
      echo "✅ dep-cruiser: server-features-no-web-framework（${fixture#__selftest_dc_}）"
    else
      echo "❌ dep-cruiser: $fixture の hono を検出しませんでした（exports の解決・tsPreCompilationDeps を確認）"
      FAIL=1
    fi
  done
  rm -f "$D/application/__selftest_dc_cross_feature.ts" "$D/presentation/__selftest_dc_infra.ts" "$D/domain/__selftest_dc_db.ts" \
    "$D/application/__selftest_dc_hono.ts" "$D/domain/__selftest_dc_zod.ts" \
    "$D/application/__selftest_dc_hono_subpath.ts" "$D/application/__selftest_dc_hono_type.ts"

  # パスに dist / build / generated を含むだけのソース（feature 名 distribution 等）が解析から外れないこと
  mkfix "$D/application/__selftest_dc_distribution.ts" 'import { reconstituteActivity } from "@app/features/activity/domain/models";
export const selftestDcDistribution = reconstituteActivity;'
  DC_DIST_OUT=$(bunx depcruise -c dependency-cruiser.config.cjs apps/api-service/src 2>/dev/null || true)
  rm -f "$D/application/__selftest_dc_distribution.ts"
  if printf '%s' "$DC_DIST_OUT" | grep -q "__selftest_dc_distribution"; then
    echo "✅ dep-cruiser: パスに dist を含むソースも解析する"
  else
    echo "❌ dep-cruiser: パスに dist を含むソースが exclude で解析から外れています（exclude の部分一致を確認）"
    FAIL=1
  fi

  # client は @/ alias 経由の import が主流。tsconfig.depcruise.json に @/* が無いと解決できずに
  # ルールが空振りする（相対 import だけ検出して緑になる）ので、alias の形で置く
  CD="apps/client/features/tasks"
  mkfix "$CD/ui/__selftest_dc_client_cross.tsx" 'import { signOut } from "@/features/auth/actions/sign-out";
export const selftestDcClientCross = signOut;'
  mkfix "apps/client/shared/lib/__selftest_dc_shared_to_features.ts" 'import { advanceTask } from "@/features/tasks/actions/advance-task";
export const selftestDcShared = advanceTask;'
  mkfix "$CD/ui/__selftest_dc_server_module.tsx" 'import { getApiClient } from "@/shared/lib/api-client";
export const selftestDcServerModule = getApiClient;'
  # 型だけの import はバンドルに入らないので許す（UI が SessionUser を使う形は自然に出てくる）
  mkfix "$CD/ui/__selftest_dc_server_type.tsx" 'import type { SessionUser } from "@/shared/lib/api-client";
export type SelftestDcServerType = SessionUser;'
  DC_CLIENT_OUT=$(bunx depcruise -c dependency-cruiser.config.cjs apps/client 2>/dev/null || true)
  if printf '%s' "$DC_CLIENT_OUT" | grep -q "__selftest_dc_server_type"; then
    echo "❌ dep-cruiser: client-browser-no-server-modules が型だけの import を誤検出しました"
    FAIL=1
  fi
  for rule in client-cross-features-tasks client-shared-to-features client-browser-no-server-modules; do
    if printf '%s' "$DC_CLIENT_OUT" | grep -q "$rule"; then
      echo "✅ dep-cruiser: ${rule}（@/ alias 経由）"
    else
      echo "❌ dep-cruiser: $rule が @/ alias 経由の違反を検出しませんでした（tsconfig.depcruise.json の paths を確認）"
      FAIL=1
    fi
  done
  rm -f "$CD/ui/__selftest_dc_client_cross.tsx" "apps/client/shared/lib/__selftest_dc_shared_to_features.ts" \
    "$CD/ui/__selftest_dc_server_module.tsx" "$CD/ui/__selftest_dc_server_type.tsx"

  # import { type X } の形は dependency-cruiser では型だけの import になり上のルールを通るが、verbatimModuleSyntax では
  # 副作用の import として残ってバンドルに入る。oxlint の no-import-type-side-effects で止めていること
  mkfix "$CD/ui/__selftest_inline_type_import.tsx" 'import { type SessionUser } from "@/shared/lib/api-client";
export type SelftestInlineTypeImport = SessionUser;'
  INLINE_OUT=$(bunx oxlint "$CD/ui/__selftest_inline_type_import.tsx" 2>&1 || true)
  rm -f "$CD/ui/__selftest_inline_type_import.tsx"
  if printf '%s' "$INLINE_OUT" | grep -q "no-import-type-side-effects"; then
    echo "✅ oxlint: no-import-type-side-effects（型の指定子だけの import）"
  else
    echo "❌ oxlint: import { type X } の形を検出しませんでした（.oxlintrc.json の no-import-type-side-effects を確認）"
    FAIL=1
  fi
fi

echo "=== 指示ファイル参照チェック自己テスト ==="
mkfix ".claude/rules/__selftest_refs.md" \
  '参照: `scripts/check/nope.sh` と `bun run no-such-script` と AGENTS.md の「存在しない見出し」
アプリ別: `apps/api-service/AGENTS.md` の「Feature structure」「パス付きの存在しない見出し」と apps/no-such-app/AGENTS.md の「X」'
# docs/ と README も対象(旧構成のまま古くなったガイドがゲートを素通りしていた)。相対リンクも見る。
# gitignore 対象の生成物(ビルド成果物)への参照は誤検出しない
mkfix "docs/dev/__selftest_refs.md" \
  '参照: `scripts/check/docs-nope.sh` と [壊れたリンク](no-such-doc.md) と [正しいリンク](testing.md) と `apps/client/dist/server/index.js`'
INSTR_OUT=$(node scripts/check/instruction-files.mjs 2>&1 || true)
rm -f ".claude/rules/__selftest_refs.md" "docs/dev/__selftest_refs.md"
if printf '%s' "$INSTR_OUT" | grep -qE "testing\.md|dist/server"; then
  echo "❌ instruction-files: 実在するリンク・gitignore 対象の生成物を誤検出しました"
  FAIL=1
fi
for expected in "nope.sh" "no-such-script" "「存在しない見出し」" \
  "apps/api-service/AGENTS.md に見出し「パス付きの存在しない見出し」" "apps/no-such-app/AGENTS.md\` が実在しない" \
  "docs-nope.sh" "リンク先 no-such-doc.md"; do
  if printf '%s' "$INSTR_OUT" | grep -qF "$expected"; then
    echo "✅ instruction-files: $expected を検出"
  else
    echo "❌ instruction-files: $expected を検出できませんでした"
    FAIL=1
  fi
done

echo "=== PostToolUse フック(文言チェック)自己テスト ==="
# expect_edit_hook <ラベル> <フック> <fixture パス> <fixture 内容> <期待する終了コード> [stderr に含むべき文字列]
# CLAUDE_PROJECT_DIR はリポジトリの外を指させる。worktree では編集したファイルが CLAUDE_PROJECT_DIR の
# 外にあるので、フックがファイル自身の場所からルートを求めていることをここで確かめる。
expect_edit_hook() {
  mkfix "$3" "$4"
  local out rc
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$ROOT/$3" |
    CLAUDE_PROJECT_DIR="$(mktemp -d)" bash ".claude/hooks/$2" 2>&1)
  rc=$?
  if [ "$rc" -eq "$5" ] && { [ -z "${6:-}" ] || printf '%s' "$out" | grep -qF "$6"; }; then
    echo "✅ $1"
  else
    echo "❌ $1: $2 の結果が想定と違います（exit=$rc、期待 $5）"
    printf '%s\n' "$out"
    FAIL=1
  fi
  rm -f "$3"
}
expect_edit_hook "文言フック: 文書の指摘を返す" on-prose-edit.sh "docs/__selftest_prose.md" \
  $'# selftest\n\nこの設定が効きます。\n' 2 '"効く" は'
expect_edit_hook "文言フック: 指摘の無い文書は通す" on-prose-edit.sh "docs/__selftest_prose.md" \
  $'# selftest\n\n設定を保存します。\n' 0
expect_edit_hook "文言フック: 対象外のファイルは見ない" on-prose-edit.sh "__selftest_prose.md" \
  $'# selftest\n\nこの設定が効きます。\n' 0
expect_edit_hook "TS 編集フック: 整形の後に画面文言の指摘を返す" on-ts-edit.sh \
  "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const SelftestUi = () => <p>この設定が効きます</p>;' 2 '違反 [ai-words-ja/no-ai-words]'
# シンボリックリンク経由のパスでも見逃さない（git rev-parse は実体のパスを返すので、そのまま比べると一致しない）
SELFTEST_LINK_DIR=$(mktemp -d)
ln -s "$ROOT" "$SELFTEST_LINK_DIR/repo"
expect_link_hook() { # $1 フック, $2 fixture パス, $3 fixture 内容
  mkfix "$2" "$3"
  local out rc
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$SELFTEST_LINK_DIR/repo/$2" |
    CLAUDE_PROJECT_DIR="$(mktemp -d)" bash ".claude/hooks/$1" 2>&1)
  rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "✅ $1: シンボリックリンク経由のパスでも指摘を返す"
  else
    echo "❌ $1: シンボリックリンク経由のパスで指摘を返しませんでした（exit=$rc）"
    printf '%s\n' "$out"
    FAIL=1
  fi
  rm -f "$2"
}
expect_link_hook on-prose-edit.sh "docs/__selftest_prose.md" $'# selftest\n\nこの設定が効きます。\n'
expect_link_hook on-ts-edit.sh "apps/client/features/__selftest/ui/selftest-copy.tsx" \
  'export const SelftestUi = () => <p>この設定が効きます</p>;'
rm -rf "$SELFTEST_LINK_DIR"

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
