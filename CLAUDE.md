@AGENTS.md

- `.claude/commands/`（スラッシュコマンド）と `.claude/hooks/`（PostToolUse / UserPromptExpansion）は
  Claude Code 専用。プロジェクトのルール本体は AGENTS.md（ルートと各アプリ）と `.claude/rules/` にあり、
  ここには書かない
- `apps/*/CLAUDE.md` も `@AGENTS.md` だけを持つ。ルートに CLAUDE.md がある限り Claude Code は
  サブディレクトリの AGENTS.md を自動では読まないため、そのディレクトリのファイルを読んだときに
  取り込ませるための入口として置いている
