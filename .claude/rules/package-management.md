# パッケージ管理（Bun）と未使用コード検出（knip）

## 依存の追加・削除

- 依存の追加・更新・削除は必ず `bun` コマンドで行う。**`package.json` の dependencies を手動編集するのは禁止**。
  - 追加: `bun add <pkg>`（開発依存は `bun add -d <pkg>`）
  - 削除: `bun remove <pkg>`
- モノレポなので、**対象パッケージのディレクトリで実行する**（例: `cd apps/api-service && bun add zod`）。
- バージョン指定は原則不要。必要時のみ `@<version>` を付け、理由を共有する。
  - **モデルの知識カットオフ日を根拠にしたバージョン固定・手動記載は禁止**。`bun.lock` と Bun の解決戦略を信頼する。

## knip（未使用エクスポート/依存の検出）

- 手動実行: `bun run knip`。自動修正: `bun run knip:fix`（ファイル削除を伴うため必ずブランチ上で）。
- 「実際に使っているのに削除」リスクを避けるため、未使用判定の削除は段階的に行う。
- 判断に迷う依存は一時的に `knip.json` の `ignoreDependencies` に入れ、後日見直す。
- shadcn 配下の UI コンポーネントや生成物・ビルド成果物は除外設定済み。

## 公開直後のパッケージ版は入らない（`bunfig.toml` の `minimumReleaseAge`）

`bun add` / `bun update` は**公開から3日経っていない版を解決対象から外す**（2026年の npm
サプライチェーン攻撃はいずれも公開後数時間が露出窓だったため）。最新版を指定して
`blocked by minimum-release-age` で失敗したら、**バージョン指定を外して1つ前の版を入れる**のが
既定の対応。緊急のセキュリティ修正で即日必要なときだけ、そのパッケージ名を
`minimumReleaseAgeExcludes` に理由コメント付きで一時追加し、取り込み後に外す。
