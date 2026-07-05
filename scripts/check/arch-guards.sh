#!/bin/bash
set -euo pipefail

echo "[guard] export * 禁止（packages/** は許可）"
EXPORT_VIOL=""
while IFS= read -r -d '' f; do
  if grep -nE 'export \*' "$f" >/dev/null 2>&1; then
    case "$f" in
      packages/*) : ;; # allowed
      *) EXPORT_VIOL+="$f\n" ;;
    esac
  fi
done < <(find apps packages \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)
if [ -n "$EXPORT_VIOL" ]; then
  echo "違反: export * の使用が禁止されています（packages/** は許可）"
  echo -e "$EXPORT_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi
echo "OK"

echo "[guard] window.location.href への代入禁止（router.push() を使用）"
# 旧 Biome GritQL プラグイン (no-window-location-href.grit) からの移設
LOCATION_VIOL=$(find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' -o -path '*/build/*' -o -path '*/.output/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE 'window\.location\.href\s*=[^=]' -- || true)
if [ -z "$LOCATION_VIOL" ]; then
  echo "OK"
else
  echo "違反: window.location.href への代入は禁止されています。router.push() を使用してください"
  echo "$LOCATION_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] api-service の throw 禁止（middlewares・起動時 config 検証・テストは除外）"
# 除外対象を先に -prune し、ファイルのみを -type f で絞り込む
# config.ts は起動時（リクエスト処理の外）の fail-fast 検証であり、ROP フローの対象外のため除外する
THROW_VIOL=$(find apps/api-service/src \
  \( -path '*/__tests__/*' -o -name '*.test.ts' -o -name '*.spec.ts' -o -path '*/middlewares/*' -o -name 'config.ts' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE '\bthrow\b' -- || true)
if [ -z "$THROW_VIOL" ]; then
  echo "OK"
else
  echo "違反: api-service では throw の使用が禁止されています（middlewares・config.ts・テストは除外）"
  echo "$THROW_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] class/interface 禁止"
CLASS_VIOL=$(find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' -o -path '*/build/*' -o -path '*/generated/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 |
  xargs -0 grep -nE '^\s*(export\s+)?class\b' || true)
INTF_VIOL=$(find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' -o -path '*/build/*' -o -path '*/generated/*' -o -path '*/.output/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 |
  xargs -0 grep -nE '^\s*(export\s+)?interface\b' | grep -vE '^[^:]*\.(d|gen)\.ts:' || true)
if [ -n "$CLASS_VIOL" ]; then
  echo "違反: class の使用が禁止されています"
  echo "$CLASS_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi
if [ -n "$INTF_VIOL" ]; then
  echo "違反: interface の使用が禁止されています（.d.ts は除外）"
  echo "$INTF_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi
echo "OK"

echo "[guard] application 層から infrastructure 直参照禁止（import type を含む）"
INFRA_VIOL=$(find apps/api-service/src/features -type f \( -name '*.ts' -o -name '*.tsx' \) -path '*/application/*' ! -name '*.test.ts' -print0 | \
  xargs -0 grep -nE "from ['\"](\.\./)+infrastructure/" -- || true)
if [ -z "$INFRA_VIOL" ]; then
  echo "OK"
else
  echo "違反: application 層から infrastructure を直接参照できません（import type も含む）"
  echo "$INFRA_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] application 層で integrations 直参照禁止 (@app/integrations) と旧 alias (@app/integration)"
INTEG_VIOL=$(find apps/api-service/src/features -type f \( -name '*.ts' -o -name '*.tsx' \) -path '*/application/*' -print0 | \
  xargs -0 grep -nE "from ['\"]@app/(integrations|integration)/" -- || true)
if [ -z "$INTEG_VIOL" ]; then
  echo "OK"
else
  echo "違反: application 層で integrations を直接参照できません"
  echo "$INTEG_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] application 層で fetch 直叩き禁止（境界でのみ許容）"
FETCH_VIOL=$(find apps/api-service/src/features -type f \( -name '*.ts' -o -name '*.tsx' \) -path '*/application/*' -print0 | \
  xargs -0 grep -nE "\bfetch\s*\(" -- || true)
if [ -z "$FETCH_VIOL" ]; then
  echo "OK"
else
  echo "違反: application 層で fetch を直接呼び出すことは禁止されています（境界でのみ許容）"
  echo "$FETCH_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] application 層で直接 HTTP クライアント使用禁止 (axios/node-fetch)"
HTTP_VIOL=$(find apps/api-service/src/features -type f \( -name '*.ts' -o -name '*.tsx' \) -path '*/application/*' -print0 | \
  xargs -0 grep -nE "from ['\"]axios['\"]|from ['\"]node-fetch['\"]" -- || true)
if [ -z "$HTTP_VIOL" ]; then
  echo "OK"
else
  echo "違反: application 層で直接 HTTP クライアント（axios/node-fetch）の使用が禁止されています"
  echo "$HTTP_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] application 層で @google-cloud/* 直参照禁止（integration に閉じ込める）"
GCP_VIOL=$(find apps/api-service/src/features -type f \( -name '*.ts' -o -name '*.tsx' \) -path '*/application/*' -print0 | \
  xargs -0 grep -nE "from ['\"]@google-cloud/" -- || true)
if [ -z "$GCP_VIOL" ]; then
  echo "OK"
else
  echo "違反: application 層で @google-cloud/* を直接参照できません（integration に閉じ込めてください）"
  echo "$GCP_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] 旧 alias (@app/integration) の残存禁止（全体）"
OLD_ALIAS=$(find apps/api-service/src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE "from ['\"]@app/integration/" -- || true)
if [ -z "$OLD_ALIAS" ]; then
  echo "OK"
else
  echo "違反: 旧 alias (@app/integration) の使用が禁止されています"
  echo "$OLD_ALIAS" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] Server Actions 配置（features/**/actions/** または features/**/queries/** のみ許容）"
SA_VIOL=$(find apps/client/features -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/actions/*' ! -path '*/queries/*' -print0 2>/dev/null |
  xargs -0 grep -nE "'use server'|\"use server\"" || true)
if [ -z "$SA_VIOL" ]; then
  echo "OK"
else
  echo "違反: Server Actions は features/**/actions/** または features/**/queries/** に配置してください"
  echo "$SA_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] kebab-case ファイル名"
BAD=$(find apps/client/features apps/client/shared apps/api-service/src -regex '.*/[a-z]*[A-Z][a-zA-Z]*\.tsx\?$' | grep -Ev '\\.test\.|\\.spec\.|\\.d\\.ts|generated|/index\.ts$' || true)
[ -z "$BAD" ] && echo "OK" || { echo "$BAD"; exit 1; }

echo "[guard] routes 配下の直置きファイル（index.ts 以外）"
if [ -d apps/api-service/src/routes ]; then
  BAD_ROUTES=$(find apps/api-service/src/routes -maxdepth 1 -type f -name '*.ts' | grep -v 'index.ts' || true)
  if [ -n "$BAD_ROUTES" ]; then
    echo "$BAD_ROUTES"
    echo "WARN: 直下ルートファイルが存在します（将来のグルーピング候補）"
  else
    echo "OK"
  fi
else
  echo "OK (routes ディレクトリなし)"
fi

echo "[guard] features 配下での process.env 直接参照禁止（config 経由に統一）"
ENV_VIOL=$(find apps/api-service/src/features -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE "process\.env\." -- || true)
if [ -z "$ENV_VIOL" ]; then
  echo "OK"
else
  echo "違反: features 配下で process.env を直接参照できません（config 経由に統一してください）"
  echo "$ENV_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] client features 配下での process.env 直接参照禁止（loadConfig() 経由に統一）"
CLIENT_ENV_VIOL=$(find apps/client/features -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null | \
  xargs -0 grep -nE "process\.env\." -- || true)
if [ -z "$CLIENT_ENV_VIOL" ]; then
  echo "OK"
else
  echo "違反: client features 配下で process.env を直接参照できません（loadConfig() 経由に統一してください）"
  echo "$CLIENT_ENV_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] UI コンポーネントから processXxx の直接 import 禁止（xxxAction 経由に統一）"
PROCESS_IMPORT_VIOL=$(find apps/client/features -type f \( -name '*.ts' -o -name '*.tsx' \) -path '*/ui/*' -print0 2>/dev/null | \
  xargs -0 grep -nE "import\s+.*\bprocess[A-Z][a-zA-Z]*" -- || true)
if [ -z "$PROCESS_IMPORT_VIOL" ]; then
  echo "OK"
else
  echo "違反: UI コンポーネントから processXxx を直接 import できません（xxxAction 経由に統一してください）"
  echo "$PROCESS_IMPORT_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] 旧 @repo/result API (result.type ===) の使用禁止"
LEGACY_RESULT_VIOL=$(find apps/api-service/src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE '\.type\s*===\s*["'"'"'](ok|err)["'"'"']' -- || true)
if [ -z "$LEGACY_RESULT_VIOL" ]; then
  echo "OK"
else
  echo "違反: それは旧 @repo/result API です。result.isOk() / result.isErr() を使ってください"
  echo "$LEGACY_RESULT_VIOL" | while IFS= read -r line; do
    echo "  • $line"
  done
  exit 1
fi

echo "[guard] usecase.ts は async/try-catch を禁止し okAsync/ResultAsync チェーンを使う"
USECASE_FILES=$(find apps/api-service/src/features -type f -name 'usecase.ts' 2>/dev/null || true)
if [ -n "$USECASE_FILES" ]; then
  USECASE_ASYNC_VIOL=$(echo "$USECASE_FILES" | xargs grep -nE '\basync\s+function\b|\basync\s*\(' -- || true)
  USECASE_TRY_VIOL=$(echo "$USECASE_FILES" | xargs grep -nE '\btry\s*\{' -- || true)
  USECASE_NO_CHAIN=$(echo "$USECASE_FILES" | xargs grep -LE '\b(okAsync|ResultAsync)\b' -- || true)
  if [ -n "$USECASE_ASYNC_VIOL" ]; then
    echo "違反: usecase.ts で async は禁止です（okAsync().andThen() チェーンを使ってください）"
    echo "$USECASE_ASYNC_VIOL" | while IFS= read -r line; do echo "  • $line"; done
    exit 1
  fi
  if [ -n "$USECASE_TRY_VIOL" ]; then
    echo "違反: usecase.ts で try/catch は禁止です（steps.ts に委譲し、Result チェーンで表現してください）"
    echo "$USECASE_TRY_VIOL" | while IFS= read -r line; do echo "  • $line"; done
    exit 1
  fi
  if [ -n "$USECASE_NO_CHAIN" ]; then
    echo "違反: usecase.ts は okAsync または ResultAsync を使った Result チェーンである必要があります"
    echo "$USECASE_NO_CHAIN" | while IFS= read -r line; do echo "  • $line"; done
    exit 1
  fi
fi
echo "OK"

echo "[guard] ports.ts は feature の application/ 直下にのみ配置可（feature 間連携の抽象ポート定義）"
BAD_PORTS=$(find apps/api-service/src/features -name 'ports.ts' 2>/dev/null | grep -vE '^apps/api-service/src/features/[^/]+/application/ports\.ts$' || true)
if [ -z "$BAD_PORTS" ]; then
  echo "OK"
else
  echo "違反: ports.ts は features/<feature>/application/ports.ts にのみ配置してください"
  echo "$BAD_PORTS" | while IFS= read -r line; do echo "  • $line"; done
  exit 1
fi

echo "[guard] createAuthedApp を使う router は requireAuth を必ず適用する"
# createAuthedApp は c.get("user") を non-null に型付けするが、認証自体は
# .use(requireAuth(...)) を登録した場合にのみ有効。付け忘れてもコンパイルは通り、
# 未認証エンドポイント化（または実行時 undefined）になるため機械的に検出する。
AUTHED_FILES=$(grep -rlE '\bcreateAuthedApp\(' apps/api-service/src --include='*.ts' 2>/dev/null | \
  grep -vE '(\.test\.ts$|/factory\.ts$|/__tests__/)' || true)
AUTHED_VIOL=""
if [ -n "$AUTHED_FILES" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! grep -qE '\.use\(requireAuth\(' "$f"; then
      AUTHED_VIOL+="$f\n"
    fi
  done <<< "$AUTHED_FILES"
fi
if [ -z "$AUTHED_VIOL" ]; then
  echo "OK"
else
  echo "違反: createAuthedApp() を使うファイルには .use(requireAuth(...)) の登録が必要です"
  echo -e "$AUTHED_VIOL" | while IFS= read -r line; do
    [ -n "$line" ] && echo "  • $line"
  done
  exit 1
fi

echo "[guard] feature 構造の完全性（必須の層・co-located テスト・配線）"
node scripts/check/feature-structure.mjs
