# client

ルール本体は複製しない。ここで作業する前に、以下をこの順で読む。

1. `../../AGENTS.md` の「Architecture: client」「Testing Conventions」
2. `../../.claude/rules/client.md`（SSR / `window` 参照 / デザイン規約 / a11y / テストヘルパ。Claude Code
   以外のツールは自動ロードされない）

参照実装は `features/tasks`。actions / queries のテストは `test-helpers/api-mock.ts` から書き始める。
