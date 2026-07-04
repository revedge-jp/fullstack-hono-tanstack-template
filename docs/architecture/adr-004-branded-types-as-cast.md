# ADR-004: Domain層ブランド型ファクトリにおける `as` キャストの許容

**ステータス**: 採用済み
**日付**: 2026-07-04

---

## 背景

TypeScriptの交差型ブランド（`string & { readonly __brand: "Email" }` 等）を Domain 層の値オブジェクトに採用する。
バリデーション済みの値やDBからの再構築時に、`string` から `string & Brand` へのナローイングが必要になる。

TypeScriptの型システムでは、交差型（intersection type）へのナローイングを型ガード関数で実現できない。
型ガードが `value is Email` を返しても、コンパイラは `string` から `string & { __brand: "Email" }` への変換を自動的に認めないため、**型ガードではなく `as` キャストが唯一の手段になる**。

## 検討した選択肢

### 選択肢 A: `as` を許容し、規約として例外明記する（採用）

- ファクトリ関数（`makeEmail` 等）: バリデーションを通過した後の `as` なので型安全性は担保される
- 再構築関数（`reconstituteXxx` 等）: 呼び出し元は「DBの永続化済みデータ」に限定されており、信頼できるソースとして扱う

規約に「ブランド型の `as` は例外」と明記することで、意図的な使用であることをチームが認識できる。

### 選択肢 B: `Result` を返すファクトリで `as` を隠蔽する

`makeXxx()` は既に `Result<T, "InvalidXxx">` を返している。これ以上ラップする余地はなく、内部実装の `as` を取り除くことはできない。

### 選択肢 C: クラスベースの実装に変更する

```typescript
class Email {
  private constructor(public readonly value: string) {}
  static make(v: string): Result<Email, "InvalidEmail"> { ... }
}
```

`as` は不要になるが、以下の理由で採用しない：

- 既存コード全体（Infrastructure層の mapper、Application層）への影響が大きい
- プリミティブ型でなくなるため、呼び出し側で `.value` アクセスが必要になり可読性が下がる
- 現状の型安全性の問題を解決しない（ファクトリ内部ではどちらも等価）
- CLAUDE.md の TypeScript スタイルで `class` / `interface` を禁止しており、既存規約と矛盾する

### 選択肢 D: `unknown` 経由のダブルキャスト（`value as unknown as Email`）

型安全性を更に損なうため採用しない。

## 決定

**選択肢 A を採用する（`as` 例外化）。**

Domain層のブランド型ファクトリ・再構築関数において、以下の条件を満たす `as` キャストを許容する：

1. **ファクトリ関数内のみ**（`makeXxx` 関数）: バリデーション通過後の値に限定
2. **再構築関数内のみ**（`reconstituteXxx` 関数）: 信頼できる永続化済みデータ（DB等）からの再構築に限定

これ以外の文脈での `as` ブランド型キャストは引き続き禁止。

## 根拠

- TypeScriptの型システムの制約上、交差型ブランドへのナローイングに `as` は回避不可能
- 両パターンとも「なぜ安全か」が関数境界で明確（バリデーション済み、DB永続化済み）
- 到達不可能なエラーハンドリングを強制することは、コードの意図を不明瞭にする
- クラスベース等の根本的な再設計は破壊的変更を伴い、現段階でのコストに見合わない

## 影響

- **既存コード**: `apps/api-service/src/features/auth/domain/models.ts` の `reconstituteAuthUser` が該当パターン（`raw.id as AuthUserId`）
- **新規機能追加時**: 新しいブランド型を追加する際も同パターンを踏襲する（例: `apps/api-service/src/features/tasks/domain/models.ts` の `TaskTitle` 等）

## 関連

- [ADR-003: `as` 型アサーション 許容例外ポリシー](./adr-003-as-type-assertion-policy.md)
