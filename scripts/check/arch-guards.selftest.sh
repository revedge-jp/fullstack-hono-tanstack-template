#!/bin/bash
# アーキテクチャガードの自己テスト。
#
# 目的: 「ガードが書いてある」だけでなく「ガードが実際に違反を検出する」ことを保証する。
# 各ガードに対し既知の違反 fixture を一時的に作成し、ガードがそれを検出して失敗する
# （期待する違反メッセージを出す）ことを確認する。ガードが壊れて違反を見逃すと、
# この自己テストが失敗する（= false negative の検出）。
#
# 背景: dependency-cruiser の feature 間依存禁止ルールが正規表現バックリファレンス
#        （from の capture group を to で \1 参照する書き方）に依存しており、実際には
#        機能していなかった（dependency-cruiser は from/to 間のバックリファレンスを
#        サポートしない）。ガード自体にテストが無かったことが原因。このスクリプトは
#        その再発を防ぐ。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

FAIL=0
FIXTURES=()
cleanup() {
  local f
  for f in "${FIXTURES[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  rm -rf "apps/api-service/src/features/tasks/application/__selftest_action" 2>/dev/null || true
}
trap cleanup EXIT

mkfix() { # $1 path, $2 content
  mkdir -p "$(dirname "$1")"
  printf '%s' "$2" >"$1"
  FIXTURES+=("$1")
}

# arch-guards.sh が「期待する違反メッセージ」を出して失敗することを確認。
# arch-guards.sh は最初の違反で停止するため、fixture は対象ガードだけを発火させる配置にする。
expect_guard() { # $1 ラベル, $2 fixtureパス, $3 fixture内容, $4 期待メッセージ部分文字列
  mkfix "$2" "$3"
  local out
  out=$(bash scripts/check/arch-guards.sh 2>&1)
  if printf '%s' "$out" | grep -qF "$4"; then
    echo "✅ $1"
  else
    echo "❌ $1: 期待した違反 '$4' を検出できませんでした（ガードが壊れている可能性）"
    FAIL=1
  fi
  rm -f "$2"
}

D="apps/api-service/src/features/tasks"

echo "=== arch-guards 自己テスト ==="

expect_guard "window.location.href 代入禁止" \
  "apps/client/features/__selftest/ui/selftest-location.tsx" \
  'export function selftestLocation() { window.location.href = "/foo"; }' \
  "window.location.href への代入は禁止"

expect_guard "throw 禁止" \
  "$D/application/__selftest_throw.ts" \
  'export function selftestThrow() { throw new Error("x"); }' \
  "throw の使用が禁止"

expect_guard "class 禁止" \
  "$D/application/__selftest_class.ts" \
  'export class SelftestFoo {}' \
  "class の使用が禁止"

expect_guard "interface 禁止" \
  "$D/application/__selftest_interface.ts" \
  'export interface SelftestBar { x: number }' \
  "interface の使用が禁止"

expect_guard "application→infrastructure 直参照禁止" \
  "$D/application/__selftest_infra.ts" \
  'import { createTasksRepository } from "../infrastructure/tasks.repository.drizzle";
export const selftestInfra = createTasksRepository;' \
  "application 層から infrastructure を直接参照できません"

expect_guard "application→integrations 直参照禁止" \
  "$D/application/__selftest_integrations.ts" \
  'import { createAuth } from "@app/integrations/external/auth";
export const selftestIntegrations = createAuth;' \
  "application 層で integrations を直接参照できません"

expect_guard "application→fetch 直叩き禁止" \
  "$D/application/__selftest_fetch.ts" \
  'export const selftestFetch = () => fetch("https://example.com");' \
  "application 層で fetch を直接呼び出すことは禁止"

expect_guard "application→axios/node-fetch 禁止" \
  "$D/application/__selftest_axios.ts" \
  'import axios from "axios";
export const selftestAxios = axios;' \
  "直接 HTTP クライアント（axios/node-fetch）の使用が禁止"

expect_guard "application→@google-cloud 禁止" \
  "$D/application/__selftest_gcp.ts" \
  'import { CloudTasksClient } from "@google-cloud/tasks";
export const selftestGcp = CloudTasksClient;' \
  "@google-cloud/* を直接参照できません"

expect_guard "features 配下 process.env 直接参照禁止" \
  "$D/application/__selftest_env.ts" \
  'export const selftestEnv = process.env.SELFTEST;' \
  "features 配下で process.env を直接参照できません"

expect_guard "client features process.env 直接参照禁止" \
  "apps/client/features/__selftest/queries/get-x.ts" \
  'export const selftestEnv = process.env.SELFTEST;' \
  "client features 配下で process.env を直接参照できません"

expect_guard "UI からの processXxx 直接 import 禁止" \
  "apps/client/features/__selftest/ui/x.tsx" \
  'import { processFoo } from "../actions/foo";
export const SelftestUi = processFoo;' \
  "UI コンポーネントから processXxx を直接 import できません"

expect_guard "旧 @repo/result API (result.type ===) 禁止" \
  "$D/application/__selftest_legacy_result.ts" \
  'export function selftestLegacy(result: { type: string }) {
  if (result.type === "ok") return true;
  return false;
}' \
  "旧 @repo/result API です"

expect_guard "usecase.ts の async 禁止" \
  "$D/application/__selftest_usecase_async/usecase.ts" \
  'export async function makeSelftestAsync() {
  return async () => null;
}' \
  "usecase.ts で async は禁止です"

expect_guard "usecase.ts の try/catch 禁止" \
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
  "$D/application/__selftest_usecase_chain/usecase.ts" \
  'export function makeSelftestChain() {
  return function selftestChain() {
    return Promise.resolve(null);
  };
}' \
  "Result チェーンである必要があります"

expect_guard "ports.ts は application/ 直下のみ" \
  "$D/__selftest_ports/ports.ts" \
  'export type SelftestPort = { x(): void };' \
  "ports.ts は features/<feature>/application/ports.ts にのみ配置してください"

SELFTEST_ACTION_DIR="$D/application/__selftest_action"
mkdir -p "$SELFTEST_ACTION_DIR"
# 有効な usecase.ts（先行ガードを通過する）を置くが usecase.test.ts は作らない
# → feature 構造チェックが「co-located テスト欠落」を検出するはず
printf 'import { okAsync } from "neverthrow";\nexport function makeSelftestAction() {\n  return () => okAsync(null);\n}\n' >"$SELFTEST_ACTION_DIR/usecase.ts"
st_out=$(bash scripts/check/arch-guards.sh 2>&1)
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

echo ""
if [ "$FAIL" = "0" ]; then
  echo "✅ ガード自己テスト: 全ガードが既知違反を検出"
  exit 0
else
  echo "❌ ガード自己テスト: 違反を見逃したガードがあります（ガードの実装を確認してください）"
  exit 1
fi
