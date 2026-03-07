# checkout-new-branch: 新しいブランチの作成

このコマンドは、現在の変更差分を確認し、新しいブランチを作成します。

**重要: このコマンド実行中は、すべての応答を日本語で行ってください。**

## 実行内容

1. 現在の変更差分を取得
2. 新しいブランチを作成

## 指示

- まず `git status` で現在の変更状態を確認してください
- 変更内容に基づいて適切なブランチ名を決定してください
  - 例) `feature/add-user-api-endpoint`, `fix/login-error`, `docs/update-readme`
- `git checkout -b {ブランチ名}` で新しいブランチを作成してください

---

実行: チャット入力で `/checkout-new-branch` を選択してください。
