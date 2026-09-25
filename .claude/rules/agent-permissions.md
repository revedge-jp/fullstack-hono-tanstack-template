---
paths:
  - ".github/workflows/**"
  - ".claude/settings.json"
  - ".mcp.json"
---

# エージェントに渡す権限の「Rule of Two」

エージェント（Claude Code・CI 上の claude-code-action・MCP サーバー経由の接続）に、次の 3 つを
**同時に**持たせない。信頼できない入力だけでもエージェントは乗っ取られうる（CVE-2026-24887 は
Claude Code の承認プロンプト回避で、前提は「信頼できない内容がコンテキストに入ること」のみ）が、
2026年上期に実証された被害の大きい攻撃（PromptPwnd / GitInject 等の資格情報窃取・不正 push）は
3 つが揃った構成で成立している。1 つ欠けるだけで被害の上限が大きく下がる。

1. **本番の資格情報**（本番 DB 接続、Workers Secrets、デプロイ用トークン、OIDC トークン）
2. **信頼できない外部入力**（第三者が書ける issue / PR 本文、Web ページ、外部 API 応答、ユーザー投稿）
3. **外部への送信・書き込み**（git push、PR 作成、外部 HTTP、メッセージ送信）

- CI 上でエージェントに実装させるワークフロー（issue コメント起動の claude-code-action 等）は
  **置かない**。公開リポジトリでは第三者が issue やコメントを書けるため 2 を排除できず、実装 PR を
  作るには 3（push / PR 作成）が必須で、2 と 3 が常に同居する。実装はローカルの Claude Code で行い、
  CI にエージェントを置くなら読み取り専用のレビュー（`contents: read`、sandbox read-only）に限る
  （現状は置いていない。レビューはローカルの `/code-review` と Claude Code Review）。`uses:` の SHA ピン留めと `id-token: write` の不在は `arch:guards` が機械的にチェックする。
- PR プレビュー（`preview.yml`）は PR のコードを preview Environment の資格情報で実行する。
  `ALCHEMY_STATE_TOKEN` と Workers を編集できる `CLOUDFLARE_API_TOKEN` はアカウント内の全 stage の state と
  Worker に届くので、preview を使うなら production は別の Cloudflare アカウントに置く
  （`docs/dev/alchemy-iac.md` の「state と資格情報の権限境界」）
- MCP で本番 DB に接続するときは**読み取り専用の接続**を使う（PlanetScale / BigQuery 等の
  `*_readonly` ツール）。書き込みが必要なら人が SQL を確認して実行する。
- ローカルの Claude Code は `.env` に本番資格情報を置かない前提で動く。本番の値を扱う作業では、
  その間は Web 取得や外部投稿を伴うツールを使わない。
