# api-service

ルール本体は複製しない。ここで作業する前に、以下をこの順で読む。

1. `../../AGENTS.md` の「Architecture: api-service」「Testing Conventions」「Adding a New Feature」
2. `../../.claude/rules/api-service.md`（細部の規約。Claude Code 以外のツールは自動ロードされない）
3. `../../.claude/rules/env-vars.md`（環境変数を足すとき）

参照実装は `src/features/tasks`（CRUD + ports）。テストは `bun test <file>`、
機械検査は `bun run arch:check`（ルート）。
