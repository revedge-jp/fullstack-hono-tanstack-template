# ADR-003: `as` 型アサーション 許容例外ポリシー

**ステータス**: 採用済み
**日付**: 2026-07-04

---

## 背景

TypeScript の `as` キャストは型安全性を破壊するため、コーディング規約では原則禁止としている。
一方で実装上、合理的な `as` が存在する。

規約が厳格すぎると：
- 型推論の限界を迎えた箇所でコンパイルエラーを回避できない
- ブランド型（Branded Types）の構築が不可能になる
- テストコードで疑似的なオブジェクトを渡せなくなる

一方で例外を無制限に認めると：
- 外部入力の未検証キャストによる実行時エラーが増加する
- 型エラーを `as` で黙らせる習慣が定着する

---

## 決定

`as` は原則禁止のまま維持しつつ、以下 4 パターンを **許容例外** として明文化する。

### 許容パターン一覧

#### 1. `as const`

リテラル型の固定。ROP パターンで `err()` の引数がユニオン型に推論されることを防ぐために必要。

```typescript
// OK
return err("NotFound" as const);
return ok({ type: "success" as const });
```

#### 2. `import { X as Y }`（型アサーションではない）

モジュールのインポート時の名前変更。型システムとは無関係。

```typescript
// OK（型アサーションではない）
import { someFunction as myFunction } from "./module";
```

#### 3. ブランド型の構築（バリデーション通過後のみ）

型エイリアスに名目的型付け（Nominal Typing）を持たせるブランド型は、バリデーション通過後に限り `as` で付与を許容する。**直前に検証済みであることが必須条件**。詳細は [ADR-004](./adr-004-branded-types-as-cast.md) を参照。

```typescript
// OK: 直前で検証済み
const trimmed = email.trim();
if (!EMAIL_PATTERN.test(trimmed)) return err("Invalid" as const);
return ok(trimmed as Email);  // 検証済みなので許容

// NG: 検証なしで付与
const email = userInput as Email;
```

#### 4. テストコードでのキャスト（`*.test.ts` 内のみ）

テスト専用の疑似オブジェクトや fetch モックを作成する際に限り許容。

```typescript
// OK: テスト内の疑似オブジェクト
const fakeRepo = {} as TasksRepository;

// OK: fetch モック (as unknown as T パターン)
global.fetch = (() => Promise.resolve({ ok: true })) as unknown as typeof fetch;

// OK: ブランド型のアサーション（テスト用フィクスチャ）
const testEmail = "test@example.com" as Email;
```

---

## 禁止パターン

```typescript
// NG: 外部入力の未検証キャスト（最も危険）
const body = req.body as CreateTaskInput;

// NG: TSエラーを黙らせるキャスト
const y = unknownValue as SpecificType;

// NG: 検証なしブランド型付与
const email = userInput as Email;

// NG: as で型を広げる（as unknown の乱用）
const x = someValue as unknown as CompletelyDifferentType; // 本番コードで
```

---

## 判定フロー（レビュー時）

```
as を見つけたら:
  |- as const                                          -> OK
  |- import { X as Y }                                 -> OK
  |- テストファイル (*.test.ts)
  |    かつ {as unknown / as string / as unknown as T} -> OK
  |- ブランド型 かつ 直前に検証済み                     -> OK
  +- それ以外                                          -> NG 要修正
```

---

## 代替案と却下理由

| 代替案 | 却下理由 |
|--------|----------|
| `as` を完全禁止 | ブランド型の構築・ライブラリ境界での型推論限界に対応不可 |
| `as` を自由に使用 | 型安全性が形骸化し、実行時エラーが増加する |
| lint ルールで機械的に制御 | biome は `as const` 等を区別できないため、人的判断が必要な部分は規約で補う |

---

## 影響範囲

- CLAUDE.md の TypeScript スタイルガイド（`No as type assertions` の記述）はこの ADR を参照

---

## 参照

- [TypeScript Branded Types](https://www.typescriptlang.org/play#example/nominal-typing)
