---
paths:
  - "apps/api-service/src/integrations/**"
  - "**/config.ts"
  - "alchemy.run.ts"
---

# Gemini モデルを利用する場合

ユーザーの指示なく、以下以外のモデルを使うのは禁止。

- `gemini-3.5-flash` — 既定。東京（`asia-northeast1`）で使える。利用者の個人情報を扱う機能はこれ
- `gemini-3-flash-preview` — `global` リージョンのみ（東京では使えない）
- `gemini-3-pro-preview` — 東京では使えない（派生プロダクトで試したところ `global` でも 404）

3.6〜3.8 の Flash は後継が出ると 45 日で引退する短期提供モデルで、東京にも無いため候補にしない
（派生プロダクトでの調査。`gemini-2.5-flash` は 2026-10-20 引退）。

SDK は `@ai-sdk/google-vertex/edge`（Edge / Workers 対応版）を使う。本番は Cloudflare Workers で、
ファイルシステム・gcloud CLI・メタデータサーバーが無いため **ADC（Application Default Credentials）は
機能しない**。認証はサービスアカウントの `client_email` / `private_key` を `config.ts` 経由で DI し、
明示的に渡す（`createGoogleVertex({ googleCredentials: ... })`）。Node 版の `createVertex`（ADC 前提）と
API キー（Express Mode）は使わない。鍵は機密なので `alchemy.secret(...)` で渡す（`env-vars.md`）。
