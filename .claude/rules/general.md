# 基本ルール

## コミュニケーション

- すべてのコミュニケーションは日本語で行う。
- コミットメッセージは Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）+ 日本語で書く。
- ブランチ名は `feat/xxx` / `fix/xxx` / `docs/xxx` / `refactor/xxx` のようにプレフィックスを付ける。

## 編集方針

- 既存ファイルのインデント（タブ/スペース、幅）は必ず維持する。変換・混在をしない。
- コメントは非自明な理由・前提・注意点のみ。行動説明コメントや自明なコメントは書かない。
- 命名は `docs/dev/coding-standards.md` に従う（関数は動詞・変数は名詞・1〜2文字の短名や過度な省略語を避ける。ファイル名は kebab-case — `bun run check:kebab` で検査される）。

## Git 安全運用

- `--no-verify` を使った commit / push は禁止。lefthook の pre-commit フックや CI チェックのスキップはコード品質を損なう。
- 自動修正系のコマンド（削除を含む）は可能な限りブランチ上で行う。
- 削除系は「検証 → 意図確認 → 段階適用」の順で。指摘のみで即削除しない。

## Gemini モデルを利用する場合

ユーザーの指示なく、以下以外のモデルを使うのは禁止。

- `gemini-3-flash-preview`
- `gemini-3-pro-preview`

SDK は `@ai-sdk/google-vertex` を使用し、認証は ADC（Application Default Credentials）を使う。API キーは使用しない。
