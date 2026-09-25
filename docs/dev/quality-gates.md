# 品質ゲート ガイド

このテンプレートは **AI がコードの大半を書く**前提で、「生成より検証」を品質戦略の主軸にしている。
**なぜ**そうするかは [ADR-006: AI コーディング時代の品質・テスト戦略](../architecture/adr-006-ai-era-quality-strategy.md) を参照。
本ドキュメントは **どんなゲートがあり、いつ実行され、どう開発を進めると効率が良いか** を説明する。

---

## ゲート一覧と実行タイミング

| ゲート | 何を守るか | 手動コマンド | pre-push (`check-all`) | CI |
|---|---|:--:|:--:|:--:|
| Lint / Typecheck | 整形・型安全 | `bun run lint` / `typecheck` | ✓ | ✓ |
| Unit / Contract | ロジック・APIスキーマ形状 | `bun run test:unit` / `test:contract` | ✓ | ✓ |
| Integration（実DB） | Drizzle クエリ・DB制約の実挙動 | `bun run test:integration` | ✓（api-service の `test` が `*.int.test.ts` も含めて実行する。DB 必須） | ✓（別ジョブ） |
| 依存方向（dependency-cruiser） | 内部レイヤ境界・feature間の直接依存禁止 | `bun run arch:dc` | ✓ | ✓ |
| 構文/配置ガード（grep） | npm 依存禁止・domain 純粋性・責務の混入 | `bun run arch:guards` | ✓ | ✓ |
| feature 構造完全性 | 必須の層・co-located テスト・配線の有無 | `bun run check:feature` | ✓（guards 内） | ✓ |
| UI 文言（textlint） | client の日本語文言に AI が書く文章に出やすい語・誇張・全角ダッシュが無いか | `bun run check:ui-copy` | ✓（guards 内） | ✓ |
| 文書の文体（textlint） | 指示ファイル・docs に同じ語彙・誇張・冗長な言い回しが無いか（Markdown の構造のルールは外している） | `bun run lint:prose` | ✓ | ✓（`instructions` ジョブ） |
| FSD（steiger） | client の Feature-Sliced Design | `bun run arch:fsd` | ✓ | ✓ |
| 未使用コード（knip） | デッドコード/依存 | `bun run knip` | ✗（lefthook が `SKIP_KNIP=1` で飛ばす） | PR コメントのみ（Unlisted binaries / Unresolved imports だけ落とす） |
| 重複（jscpd） | コピペ重複（しきい値5%）。**テストコードも対象**（除外すると写経テストの増殖が測定すらされない — 派生プロダクトで計測値が20%に達した後から入れるのは困難なため、小さいうちから対象に含める） | `bun run dup:check` | ✗ | ✓ |
| ガード自己テスト | ガード自身（PreToolUse フック含む）が正しく動くか | `bun run arch:selftest` | ✗ | ✓ |
| 指示ファイル・ドキュメント参照整合 | AGENTS.md / `.claude/rules` / `docs/**` / README のパス・`bun run`・見出し参照・相対リンクの実在 | `bun run check:instructions` | ✗ | ✓（`instructions` ジョブ。`ci` ジョブの arch:check にも含まれる） |
| 検証器の変更理由 | `scripts/check/verifier-paths.txt` に当たる変更が PR 本文の「## 検証器の変更理由」を持つか | — | ✗ | ✓（`verifier-change` ジョブ） |
| カバレッジ閾値（api） | domain/application の網羅（85%） | `bun run coverage:check` | ✗ | ✓ |
| カバレッジ閾値（client） | actions/queries の網羅（80%） | `bun run coverage:check:client` | ✗ | ✓ |
| ミューテーション | domain/application のテストの**質**（90%） | `cd apps/api-service && bun run mutation` | ✗ | ✓（PR 差分のみ、[ADR-007](../architecture/adr-007-mutation-testing-diff-scope.md)） |
| 依存脆弱性（bun audit） | allowlist（`.github/security-audit-allowlist.json`）に無い既知の advisory | `bun run check:security-audit` | ✗ | 週次のみ（`security-audit.yml`。PR では実行されず、該当があれば issue を立てる） |

> **⚠ 対象範囲は `src/features/*/{domain,application}` に限られる。**
> カバレッジ閾値（api）・ミューテーション・`arch:guards` の一部（application 層の import 禁止）は、
> いずれも `src/features` 配下しか見ていない（`process.env` 直参照は `api-process-env.sh` が `src/` 全体を見る）。**feature から
> `src/shared/` へロジックを移すと、これらのゲートから静かに外れる**（エラーは出ず CI も緑のまま）。
> `integrations/composition/` の adapter も同様に対象外。移したら `stryker.config.json` の
> `mutate` へ個別に列挙して戻すこと。詳細は
> [`.claude/rules/api-service.md`](../../.claude/rules/api-service.md) の
> 「`src/shared/` へロジックを移すと品質ゲートから静かに外れる」を参照。

- **pre-push（`bun run check-all`）= 速い中核**。lint/type/test/arch/guards を回す。lint・typecheck・テストは
  `TURBO_FILTER`（既定 `...[origin/main]`）で origin/main から変更のあるパッケージとその依存元に絞られる。
  api-service が対象に入るとその `test` が integration も実行するので、DB が無いと push できない。
- **重め・専門的なゲート（knip・jscpd・自己テスト・指示ファイル・カバレッジ・ミューテーション）は CI 主体**。pre-push を軽く保つため。
  依存脆弱性は PR ではなく週次で見る（advisory は自分の変更と無関係に増えるので、ゲートにすると無関係な PR が止まる）。
- **CI の `ci` ジョブ（lint/type と arch:check 一式。テスト・カバレッジ・ミューテーションは apps/packages の変更時だけ）は、
  コード・`scripts/`・ゲートの設定ファイル・依存のどれかに触れる PR で必ず実行される**。
  `ci.yml` の `changes` ジョブが paths-filter で判定し、どのフィルタにも当たらないコード変更も受け皿（`catchall`）で拾う。
  ワークフロー・フック・`.claude/settings.json`（ガードのチェック対象と検証器）も含む。
  実行されないのは `docs/`・`*.md`・`.claude/` の残りなど受け皿の除外に書いたものだけで、そのうち指示ファイル（`*.md`・`.claude/`）は
  軽量な `instructions` ジョブが参照整合と文体（`lint:prose`）を見る。新しい設定ファイルを足しても追記は不要（受け皿に当たる）。
- ローカルでアーキ一式（jscpd・自己テスト込み）を回したいときは **`bun run arch:check`**。`FAST=1` を付けると knip/deps/dc/jscpd/自己テストをスキップして高速化できる。

---

## テスト層と「何をどこでテストするか」

| 層 | 置き場所 | 検証する対象 | ミューテーション/カバレッジ |
|---|---|---|---|
| unit | `features/*/{domain,application}/**.test.ts`（co-located） | 値オブジェクト・ユースケース・ステップの純粋ロジック | **ミューテーション + カバレッジ対象** |
| contract | `__tests__/contract/{feature}.contract.test.ts` | API レスポンスのスキーマ形状 | — |
| integration | `__tests__/integration/{feature}.int.test.ts` | 実 DB での Drizzle・制約・トランザクション | — |
| E2E | `apps/client/tests/e2e/*.spec.ts` | ブラウザ通し（成功ケース＋エラーケース）。dev モードに加え、CI では **prod-shape**（ビルド成果物を workerd で起動）でも実行し、dev（Bun / vite dev）と本番（workerd）のランタイム乖離を検出する。ローカルは `bun run test:e2e -- --prod-shape` | — |
| client actions/queries | `features/*/{actions,queries}/*.test.ts`（co-located） | フォーム検証・API 連携・キャッシュ無効化 | **カバレッジ対象（80%）** |

**ミューテーションは純粋ロジック（domain/application）のみ**。ルーティング・fetch・cache 等の
グルー層は宣言的でミューテーションがノイジーなため、**カバレッジ + 挙動アサーション**で守る
（理由は [ADR-006](../architecture/adr-006-ai-era-quality-strategy.md#3-ミューテーションは純粋ロジック層のみに限定する)）。

---

## 効率の良い開発の進め方

**速いゲートを手元で回し、重いゲートは CI に任せる**。

```
1. ブランチを切る            feat/<name> 等
2. 実装                      Domain → Infrastructure → Application → Presentation の順
3. こまめに速い確認          bun run typecheck && bun run lint
4. 一区切りでフル確認        bun run check-all          # lint/type/test/arch/guards
5. ロジックを変えたら        cd apps/api-service && bun run mutation:diff   # 任意・差分のみで速い
6. push → CI が全ゲート実行  カバレッジ・ミューテーション（差分スコープ）・jscpd・自己テスト・integration
```

- **新機能**: Domain → Infrastructure → Application → Presentation の順。各 action に `usecase.test.ts` は必須
  （無いと feature 構造チェックで落ちる）。手本は `apps/api-service/src/features/tasks`。
- **テストは「ok を返すか」でなく「正しい値になったか」を assert する**。
  in-memory リポジトリの状態や更新後の値まで検証すると、ミューテーション/挙動の検証の抜けがなくなる。
- **feature 間連携**が必要な場合は、利用側 feature の `application/ports.ts` に抽象ポート型を定義し、
  実装（アダプタ）は `integrations/composition/` に置き、`container.ts` で配線する
  （`tasks` → `activity` の `ActivityRecorder` が実例）。feature 間の直接 import は
  dependency-cruiser が検知して落とす。
- **手元で重いゲートを試したいとき**: `bun run coverage:check` / `coverage:check:client` /
  `cd apps/api-service && bun run mutation:diff`（差分のみ、CI と同じ）/ `bun run mutation`（全体監査）/
  `bun run dup:check` / `bun run arch:selftest` を個別に叩ける。

---

## ゲートが落ちたときの読み方

| 落ちたゲート | 典型原因と対処 |
|---|---|
| **ミューテーション**（score < 90） | テストがアサーション不足（"perpetually green"）。出力の `[Survived]` の行を見て、その挙動を assert するテストを足す。境界値（`<` vs `<=` 等）やオブジェクトの各フィールドを直接 assert するテストで改善しやすい |
| **カバレッジ**（< 閾値） | 対象層（domain/application or client actions/queries）に未テストの分岐。低い順にファイルが表示される |
| **arch-guards 違反** | 層をまたぐ依存・npm 依存の持ち込み・domain への責務の混入。メッセージに違反ファイルが出る。設計を直す（回避しない） |
| **feature 構造** | 必須の層・`usecase.test.ts`・contract テスト・container/app への配線が欠落 |
| **UI 文言** | 出力の語を、何がどうなるかを書く言葉に置き換える（`.claude/rules/client.md` の「UI 文言の書き方」）。画面の用語として必要な語だけ `.textlintrc.json` の `allows` に足す |
| **jscpd**（重複率超過） | 本物のコピペは共通化。意図的テンプレ重複は `// jscpd:ignore-start` 〜 `// jscpd:ignore-end` |
| **knip** | 未使用の export/file/依存。消すか、設定（`knip.json`）で除外 |
| **ガード自己テスト** | ガードそのものが既知違反を検出できなくなっている（正規表現の書き間違い等）。まずガードの実装を確認する |
| **bun audit**（週次の issue） | allowlist に無い advisory。ランタイムに到達するなら `bun update <pkg>`（上げられなければ `package.json` の `overrides`）、ビルド・開発時にしか使わないなら allowlist に advisory 単位・期限付きで登録する（手順は issue 本文） |

---

## しきい値の調整

| ゲート | 既定 | 調整方法 |
|---|---|---|
| カバレッジ（api） | 85% | `COVERAGE_THRESHOLD` 環境変数 |
| カバレッジ（client） | 80% | `package.json` の `coverage:check:client` 内 `COVERAGE_THRESHOLD` |
| ミューテーション | break 90 | `apps/api-service/stryker.config.json` の `thresholds.break` |
| 重複（jscpd） | 5% | `.jscpd.json` の `threshold` |

いずれも**保守的な floor**として設定している（急落を検知するのが目的で満点強制ではない）。運用しながら締める。

### lint 設定は turbo の `globalDependencies` に入れる

`.oxlintrc.json` / `.oxfmtrc.json` は `turbo.json` の `globalDependencies` に登録している。
登録が無いと **lint 設定を変えても turbo のキャッシュが無効化されず**、`bun run lint` が古い結果を
replay する。設定を触ったのに結果が変わらないときは、まず `bun run lint --force` で確かめること。
lint ルールを別ファイルへ切り出す場合は `globalDependencies` にも足す。

---

## 参照

- [ADR-006: AI コーディング時代の品質・テスト戦略](../architecture/adr-006-ai-era-quality-strategy.md)（思想）
- [ADR-007: mutation testing を PR の差分ファイルにスコープする](../architecture/adr-007-mutation-testing-diff-scope.md)（CI での実行方式）
- [テストガイド](./testing.md)（書くテストの規約への案内と、書き始めに開く実物）
- [機能追加の手引き](./adding-features.md)（feature を足すときに読む規約と参照実装）
