タグを切って本番デプロイを起動します。以下の手順で進めてください。

## 手順

### 1. main の最新化とタグの確認

```bash
git fetch origin main --tags --quiet
git describe --tags --abbrev=0 origin/main
```

最新タグ（例: `v1.2.0`）を確認する。タグがまだ無いリポジトリでは、初回リリースとして `v0.1.0` から始める。

### 2. タグ以降の未リリースコミットを一覧化

```bash
git log <最新タグ>..origin/main --oneline
```

各行の `(#123)` から PR 番号を拾い、次の形式でユーザーに示す:

```
最新タグ: v1.2.0
タグ以降のマージ済み PR（N 件）:
#124 タイトル
#125 タイトル
```

タグ以降のコミットが無ければ「反映するものがありません」と報告してここで止める。

### 3. main の CI 状況を確認

```bash
gh run list --branch main --limit 3 --json databaseId,name,status,conclusion,headSha
```

直近の `CI Pipeline` と `Deploy`（staging）が `success` であることを確かめる。失敗・実行中のときは
タグを打たずにユーザーへ報告する（失敗している状態を本番にも出してしまうため）。

### 4. バージョンの決定

現在のタグ以降のコミット（Conventional Commits）から次のバージョンを決める:

- **patch**: `vX.Y.Z+1`（バグ修正中心）
- **minor**: `vX.Y+1.0`（新機能あり）
- **major**: `vX+1.0.0`（破壊的変更）

### 5. タグ作成・プッシュ

決めたバージョンと変更一覧を示し、**ユーザーの承認を 1 回だけ取る**（本番デプロイが起動する、元に戻せない操作なので
ここは確認を残す。`general.md` の「自律運用」）。承認されたら:

```bash
git tag <new-version> origin/main -m "<new-version>"
git push origin <new-version>
```

タグを push すると `deploy.yml` の `detect-target` が `v<数字>.<数字>.<数字>` の形のタグを `target=production` と判定し、
本番デプロイが自動で始まる。

### 6. デプロイの確認

```bash
gh run list --limit 8 --json databaseId,name,status,conclusion,headBranch,event
```

タグ名を `headBranch` に持つ `CI Pipeline` の完了を待つ。続けて、その完了を拾う `Deploy` の完了を待ち、
`gh run view <id> --json conclusion,jobs` で `Detect deploy target` と `Deploy (Alchemy)` の両ジョブが
成功していることを確かめる。

**失敗したとき**: `SMOKE_BASE_URL` が設定されていれば、smoke チェックの失敗時に deploy.yml がデプロイ前の版へ
自動で戻す（`docs/deploy/operations.md` の「ロールバック」）。ジョブは赤のまま残るので、原因を調べて
ユーザーへ報告し、**原因を直すまで次のタグは打たない**。GitHub Release も作らない（次の手順へ進まない）。

### 7. GitHub Release の作成

デプロイ成功を確かめたら、GitHub Release を作る:

```bash
gh release create <new-version> --title "<new-version>" --generate-notes --latest
```

`--generate-notes` が直前のタグとの差分から、マージ済み PR を自動で並べる。デプロイが成功してから作るのは、
smoke 失敗で戻された版に「リリース済み」の記録を残さないため。

### 8. 完了報告

反映された PR 一覧・タグ名・デプロイ結果・Release の URL を、短くユーザーへ報告する。
