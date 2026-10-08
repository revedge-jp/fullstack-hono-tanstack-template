#!/usr/bin/env bash
# .claude/shared.lock の読み取りと検証。sync-shared-claude.sh と check-shared-claude.sh が source で読む。
# 単体では何もしない。

# 成功時は SHARED_REPO・SHARED_REF・SHARED_FILES を設定して 0 を返す。
# 失敗時は理由を ❌ の行で stdout に出して 1 を返す（exit はしない。呼び出し側が決める）
read_shared_lock() {
  local lock="$1" line f rc=0
  local repo_count=0 ref_count=0
  SHARED_REPO=""; SHARED_REF=""; SHARED_FILES=()

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
      repo=*) SHARED_REPO="${line#repo=}"; repo_count=$((repo_count + 1)) ;;
      ref=*) SHARED_REF="${line#ref=}"; ref_count=$((ref_count + 1)) ;;
      file=*) SHARED_FILES+=("${line#file=}") ;;
      *) echo "❌ $lock に解釈できない行があります: $line"; rc=1 ;;
    esac
  done < "$lock"

  if [ "$repo_count" != "1" ] || [ -z "$SHARED_REPO" ]; then
    echo "❌ $lock に repo= が 1 つ必要です（$repo_count 個あります）"; rc=1
  fi
  if [ "$ref_count" != "1" ]; then
    echo "❌ $lock に ref= が 1 つ必要です（$ref_count 個あります）"; rc=1
  fi
  if ! printf '%s' "$SHARED_REF" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "❌ ref は 40 桁の 16 進である必要があります: $SHARED_REF"; rc=1
  fi
  if [ "${#SHARED_FILES[@]}" -lt 1 ]; then
    echo "❌ $lock に file= が 1 つ以上必要です"; rc=1
  fi

  for f in ${SHARED_FILES[@]+"${SHARED_FILES[@]}"}; do
    case "$f" in
      *..*) echo "❌ file に .. は使えません: $f"; rc=1 ;;
      /*) echo "❌ file は / で始められません: $f"; rc=1 ;;
      .claude/shared.lock|.claude/shared.manifest) echo "❌ $f は共有の対象にできません"; rc=1 ;;
      .claude/*) ;;
      *) echo "❌ file は .claude/ で始まる必要があります: $f"; rc=1 ;;
    esac
  done
  return "$rc"
}
