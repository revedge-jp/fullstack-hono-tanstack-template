# 品質ゲート ガイド

このテンプレートは **AI がコードの大半を書く**前提で、「生成より検証」を品質戦略の主軸にしている。
**なぜ**そうするかは [ADR-006: AI コーディング時代の品質・テスト戦略](../architecture/adr-006-ai-era-quality-strategy.md) を参照。
本ドキュメントは **どんなゲートがあり、いつ走り、どう開発を進めると効率が良いか** を説明する。

---

## ゲート一覧と実行タイミング

| ゲート | 何を守るか | 手動コマンド | pre-push (`check-all`) | CI |
|---|---|:--:|:--:|:--:|
| Lint / Typecheck | 整形・型安全 | `bun run lint` / `typecheck` | ✓ | ✓ |
| Unit / Contract | ロジック・APIスキーマ形状 | `bun run test:unit` / `test:contract` | ✓ | ✓ |
| Integration（実DB） | Drizzle クエリ・DB制約の実挙動 | `bun run test:integration` | ✗ | ✓（別ジョブ） |
| 依存方向（dependency-cruiser） | 内部レイヤ境界・feature間の直接依存禁止 | `bun run arch:dc` | ✓ | ✓ |
| 構文/配置ガード（grep） | npm 依存禁止・domain 純粋性・責務漏れ | `bun run arch:guards` | ✓ | ✓ |
| feature 構造完全性 | 必須の層・co-located テスト・配線の有無 | `bun run check:feature` | ✓（guards 内） | ✓ |
| FSD（steiger） | client の Feature-Sliced Design | `bun run arch:fsd` | ✓ | ✓ |
| 未使用コード（knip） | デッドコード/依存 | `bun run knip` | ✓ | ✓（PRコメントは非ブロック） |
| 重複（jscpd） | コピペ重複（しきい値5%）。**テストコードも対象**（除外すると写経テストの増殖が測定すらされない — 派生プロダクトで実測20%に達した後から入れるのは困難なため、小さいうちから対象に含める） | `bun run dup:check` | ✗ | ✓ |
| ガード自己テスト | ガード自身が壊れていないか | `bun run arch:selftest` | ✗ | ✓ |
| カバレッジ閾値（api） | domain/application の網羅（85%） | `bun run coverage:check` | ✗ | ✓ |
| カバレッジ閾値（client） | actions/queries の網羅（80%） | `bun run coverage:check:client` | ✗ | ✓ |
| ミューテーション | domain/application のテストの**質**（90%） | `cd apps/api-service && bun run mutation` | ✗ | ✓（PR 差分のみ、[ADR-007](../architecture/adr-007-mutation-testing-diff-scope.md)） |
| 依存脆弱性（bun audit） | 既知の高脆弱性 | `bun audit --audit-level=high` | ✗ | ✓（別ジョブ、deps変更時） |

> **⚠ 対象範囲は `src/features/*/{domain,application}` に限られる。**
> カバレッジ閾値（api）・ミューテーション・`arch:guards` の一部（`process.env` 直参照禁止、
> application 層の import 禁止）は、いずれも `src/features` 配下しか見ていない。**feature から
> `src/shared/` へロジックを移すと、これらのゲートから静かに外れる**（エラーは出ず CI も緑のまま）。
> `integrations/composition/` の adapter も同様に対象外。移したら `stryker.config.json` の
> `mutate` へ個別に列挙して戻すこと。詳細は
> [`.claude/rules/api-service.md`](../../.claude/rules/api-service.md) の
> 「`src/shared/` へロジックを移すと品質ゲートから静かに外れる」を参照。

- **pre-push（`bun run check-all`）= 速い中核**。lint/type/test/arch/guards/knip を回す。
- **重め・専門的なゲート（jscpd・自己テスト・カバレッジ・ミューテーション・integration・audit）は CI 主体**。pre-push を軽く保つため。
- ローカルでアーキ一式（jscpd・自己テスト込み）を回したいときは **`bun run arch:check`**。`FAST=1` を付けると knip/deps/dc/jscpd/自己テストをスキップして高速化できる。

---

## テスト層と「何をどこでテストするか」

| 層 | 置き場所 | 検証する対象 | ミューテーション/カバレッジ |
|---|---|---|---|
| unit | `features/*/{domain,application}/**.test.ts`（co-located） | 値オブジェクト・ユースケース・ステップの純粋ロジック | **ミューテーション + カバレッジ対象** |
| contract | `__tests__/contract/{feature}.contract.test.ts` | API レスポンスのスキーマ形状 | — |
| integration | `__tests__/integration/{feature}.int.test.ts` | 実 DB での Drizzle・制約・トランザクション | — |
| E2E | `apps/client/tests/e2e/*.spec.ts` | ブラウザ通し（成功＋エラー経路）。dev モードに加え、CI では **prod-shape**（ビルド成果物を workerd で起動）でも実行し、dev（Bun / vite dev）と本番（workerd）のランタイム乖離を検出する。ローカルは `bun run test:e2e -- --prod-shape` | — |
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
4. 一区切りでフル確認        bun run check-all          # lint/type/test/arch/guards/knip
5. ロジックを変えたら        cd apps/api-service && bun run mutation:diff   # 任意・差分のみで速い
6. push → CI が全ゲート実行  カバレッジ・ミューテーション（差分スコープ）・jscpd・自己テスト・integration
```

- **新機能**: Domain → Infrastructure → Application → Presentation の順。各 action に `usecase.test.ts` は必須
  （無いと feature 構造チェックで落ちる）。正典は `apps/api-service/src/features/tasks`。
- **テストは「ok を返すか」でなく「正しい値になったか」を assert する**。
  in-memory リポジトリの状態や更新後の値まで検証すると、ミューテーション/挙動の穴が埋まる。
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
| **ミューテーション**（score < 90） | テストがアサーション不足（"perpetually green"）。出力の `[Survived]` の行を見て、その挙動を assert するテストを足す。境界値（`<` vs `<=` 等）やオブジェクトの各フィールドを直接 assert するテストが効きやすい |
| **カバレッジ**（< 閾値） | 対象層（domain/application or client actions/queries）に未テストの分岐。低い順にファイルが表示される |
| **arch-guards 違反** | 層をまたぐ依存・npm 依存の持ち込み・domain への漏れ。メッセージに違反ファイルが出る。設計を直す（回避しない） |
| **feature 構造** | 必須の層・`usecase.test.ts`・contract テスト・container/app への配線が欠落 |
| **jscpd**（重複率超過） | 本物のコピペは共通化。意図的テンプレ重複は `// jscpd:ignore-start` 〜 `// jscpd:ignore-end` |
| **knip** | 未使用の export/file/依存。消すか、設定（`knip.json`）で除外 |
| **ガード自己テスト** | ガードそのものが既知違反を検出できなくなっている（正規表現の書き間違い等）。ガードの実装を疑う |
| **bun audit** | 高脆弱性の新規混入。`bun update` で解決するか、`package.json` の `overrides` で該当パッケージの安全なバージョンを強制する |

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
- [テストガイド](./testing.md)（feature ごとに書くテストの規約・パターン）
- [機能追加ガイド](./adding-features.md)（実装順序）
