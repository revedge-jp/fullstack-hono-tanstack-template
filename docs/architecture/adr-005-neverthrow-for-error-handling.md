# ADR-005: エラーハンドリングに neverthrow を採用する

**ステータス**: 採用済み
**日付**: 2026-07-04

---

## コンテキスト

api-service は Clean Architecture + ROP（Railway Oriented Programming）を採用しており、
ドメイン・インフラ・アプリケーション・ルーティングの各層をまたいでエラーを伝播させる。

従来は自前の `@repo/result` パッケージでこれを実現していたが、メンテナンスコストとエコシステムの観点から
標準的なライブラリへ移行した。

`throw` ベースの例外処理には、本プロジェクトの設計と相性の悪い問題がある：

- **例外が型に現れない**: 関数が失敗しうるか、どんなエラーを投げるかがシグネチャから分からない。
  ドキュメントやソースの精読に頼ることになる。
- **握り忘れがコンパイルを通る**: `try/catch` を書き忘れても、対応漏れの分岐があっても、
  ビルドは成功する。問題が表面化するのは本番でそのエラーが実際に起きた瞬間（ランタイム）。
- **エラー種別の網羅性を保証できない**: 新しいエラー種別を追加しても、
  対応漏れの呼び出し元が機械的には洗い出されない。
- **層をまたぐ伝播で `try/catch` がネストする**: ROP のフローが読みにくくなる。

---

## 決定

エラーハンドリングに **[neverthrow](https://github.com/supermacro/neverthrow)** を採用する。
自前の `@repo/result` は廃止し、全面移行する。

成功値とエラーを `Result<T, E>` / `ResultAsync<T, E>` で表現し、
`ok()` / `err()` / `okAsync()` / `errAsync()` で生成、`map` / `andThen` / `mapErr` で連結する。

### 採用によって得られる利点

#### 1. （最重要）コンパイル時にエラーの握り忘れを防げる

`Result` から成功値を取り出すには、必ずエラーかどうかを分岐させる必要がある。
エラー処理を書くのが「任意」ではなく「必須」になり、書き忘れるとコンパイラが止める。

```typescript
const result = await getSession(request);
//    型: ResultAsync<AuthUser, "Unauthorized" | "Unexpected">

// result.email は存在しない（result は AuthUser ではなく Result）→ コンパイルエラー
if (result.isErr()) {
  // result.error は "Unauthorized" | "Unexpected"。ここで処理しないと先へ進めない
  // （presentation 層では toHttp(c, result, errorMap) でまとめて HTTP に変換する）
  return handleError(result.error);
}
const user = result.value; // ここで初めて AuthUser が手に入る
```

これにより「特定のエラーケースの処理を書き忘れ、稀な条件で落ちる」という、
本番で初めて発覚しがちな最も厄介なバグをデプロイ前に潰せる。

#### 2. エラー種別を型で網羅的に扱える

エラーをユニオン型（例: `"Invalid" | "NotFound" | "Conflict" | "Unexpected"`）で表現でき、
`switch` の分岐漏れも型で検知できる。新しいエラー種別を追加すると、
それを処理していない箇所が**すべてコンパイルエラーとして洗い出される**。

これは以下の派生的メリットの土台になる：

- **HTTP への変換が網羅的・正確になる**: `toHttp` ヘルパー（`apps/api-service/src/shared/http/to-http.ts`）が
  エラー種別を適切な HTTP ステータスへマッピングする（種別 → ステータスの対応漏れを型で防ぐ）。
- **ログでの原因特定がしやすくなる**: エラーが「値」なので、ルーティング層など境界で
  `mapErr` を通して種別つきの構造化ログを一箇所に集約できる。`Unexpected` のときだけ
  元の例外を残す、といった制御もしやすい。

#### 3. ROP のフローが読みやすくなる

`andThen` / `mapErr` でエラーを横道に流しつつ成功パスを連結でき、`try/catch` のネストが消える。

```typescript
return okAsync(input)
  .andThen(validateCreateTask)
  .andThen(createTaskStep)
  .map(toCreateTaskResponse);
```

---

## 適用範囲

| 範囲 | 方針 |
|------|------|
| **api-service（全層）** | neverthrow を使用。層をまたぐエラーは `Result` で伝播させる |
| **client の Server Fn（mutation）** | `{ ok: true } \| { ok: false; message: string }` 型を使用（事実上の Result 型）。フォームの pending 状態管理と整合 |
| **client の loader / Server Fn（read）** | `throw` を継続使用し、TanStack Start のルート `errorComponent` に委譲する |

### client に neverthrow を導入しない理由

- client のエラー伝播は「アクション1個 / クエリ1個」で完結し、層をまたぐ多段の連鎖がほぼない。
- 表示上のエラーは事実上「成功 or メッセージ」の二値で、`{ ok, message }` 型で十分。
- loader の `throw` は TanStack Start の error boundary に乗せる正しい作法であり、`Result` で包むと
  フレームワークの仕組みを殺してしまう。
- 将来 client 側で複数 API を連結する複雑なロジックが出てきた場合に限り、
  その Server Fn 内での局所的な導入を再検討する。

---

## 用語の整理：握り忘れ防止 と ログでの原因特定 は別物

混同しやすいが、両者は時間軸が異なる別の関心事である。

| | コンパイル時の握り忘れ防止 | ログでの原因特定 |
|---|---|---|
| タイミング | コードを動かす**前** | 動いて壊れた**後** |
| 目的 | バグの**予防**（事故を起こさない） | バグの**診断**（事故を調べる） |

握り忘れ防止が効いているほど、ログに残る異常は「想定済みの種別」と
「本当に予期しないもの（`Unexpected`）」にきれいに分かれるため、結果としてログも読みやすくなる
（間接的な相乗効果）。ただし機能としては独立しており、neverthrow を入れただけで
ログが自動で充実するわけではない。

---

## 代替案と却下理由

| 代替案 | 却下理由 |
|--------|----------|
| `throw` ベースの例外処理 | エラーが型に現れず、握り忘れがコンパイルを通る。ROP との相性が悪い |
| 自前の `@repo/result` を継続 | メンテナンスコストが高く、エコシステム・ドキュメントの蓄積がない |
| client にも neverthrow を統一適用 | TanStack Start の error boundary と二重管理になり複雑化。バンドルサイズ増。client にその必要性がない |

---

## 影響範囲

- `AGENTS.md` の共有パッケージ表・アーキテクチャ例を neverthrow ベースに更新
- `@repo/result` は廃止
- `scripts/check/arch-guards.sh` に旧API検出ガード（`result.type ===` 禁止）と
  usecase.ts の chain 強制ガードを追加
- ADR-003 の許容パターン一覧から `@repo/result` 内部ジェネリクスの項目を除外（廃止のため対象外）

---

## 参照

- [neverthrow（GitHub）](https://github.com/supermacro/neverthrow)
- [ADR-003: `as` 型アサーション 許容例外ポリシー](./adr-003-as-type-assertion-policy.md)
