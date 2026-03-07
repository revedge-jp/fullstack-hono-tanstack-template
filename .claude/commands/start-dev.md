これから新しい開発を始めます。以下の手順で進めてください。

## 手順

### 1. 実装内容の確認

AskUserQuestion ツールを使って「何を実装しますか？」とユーザーに聞いてください。

### 2. ブランチ名の提案

ユーザーの回答をもとに、以下のプレフィックス規則でブランチ名を提案してください：

- 新機能: `feat/<kebab-case-description>`
- バグ修正: `fix/<kebab-case-description>`
- リファクタリング: `refactor/<kebab-case-description>`
- その他の作業: `chore/<kebab-case-description>`

ブランチ名は英語の kebab-case で、短く明確に。提案したブランチ名でよいか AskUserQuestion で確認してください。

### 3. ブランチ作成と環境セットアップ

確認が取れたら以下を順番に実行してください：

1. `git checkout -b <branch-name>` でブランチを作成
2. `bun run start-from-main` で main と同期・依存関係更新・DB セットアップ
