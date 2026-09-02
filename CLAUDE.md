@AGENTS.md

<!-- Claude Code 固有の補足だけをここに書く。プロジェクトのルール本体は AGENTS.md と .claude/rules/。 -->

- `.claude/rules/` のパススコープ規則（`api-service.md` / `client.md` / `env-vars.md`）は Claude Code が
  自動ロードする。`.claude/commands/` のスラッシュコマンド、`.claude/hooks/` の PostToolUse /
  UserPromptExpansion フックも Claude Code 専用
- worktree で作業したものを `/code-review` に掛けるときは PR 番号を必ず渡す（`.claude/rules/general.md`）
