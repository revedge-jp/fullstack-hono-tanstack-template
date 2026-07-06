---
paths:
  - "apps/api-service/src/**"
---

# api-service 実装ルール（CLAUDE.md の補足）

アーキテクチャの全体像・feature 構造・ROP パターンは CLAUDE.md を参照。ここでは
`bun run arch:guards`（`scripts/check/arch-guards.sh`）で機械的に強制される規約と、
CLAUDE.md に載っていない細部の規約をまとめる。

## arch:guards で強制される禁止事項

違反すると CI で落ちる。実装前に把握しておくこと。

- **`throw` 禁止**（`middlewares/`・`config.ts`（起動時 fail-fast 検証）・テストは除外）。エラーは Result チェーンで表現する。
- **`class` / `interface` 禁止**（`.d.ts` / `.gen.ts` は除外）。type エイリアス + ファクトリ関数（`makeXxx`）を使う。
- **`export *` 禁止**（`packages/**` は許可）。バレルは named re-export で書く。
- **`usecase.ts` で `async` / `try-catch` 禁止**。`okAsync().andThen()` チェーンのみ。try-catch が必要な処理は `steps.ts` / infrastructure に委譲する。
- application 層から infrastructure / integrations の直参照禁止（`import type` も不可）。
- application 層で `fetch` / axios / node-fetch の直叩き禁止。
- `features/` 配下（api-service・client とも）で `process.env` 直参照禁止。`config.ts` の `loadConfig()` → container DI 経由。
- `ports.ts` は `features/<feature>/application/ports.ts` にのみ配置可。
- `createAuthedApp()` を使うファイルには `.use(requireAuth(...))` の登録が必須。
- 旧 `@repo/result` API（`result.type ===`）の使用禁止。neverthrow の `result.isOk()` / `result.isErr()` を使う。

## 命名・型配置

- **DTO**: `XxxInput` と命名し、`application/{action}/validators.ts` で定義・export する。
- **エラー型**: ユースケース意図 + `Error`（例: `CreateTaskError`）。`usecase.ts` のファイル先頭に非 export で定義。
- **ステップ**: ファクトリは `makeXxxStep(deps)`、入出力型は `XxxStepInput` / `XxxStepOutput` をファイル先頭に非 export で置く。
- 同じ型を複数のシグネチャで使う場合はトップレベル型エイリアスを参照する。関数内型定義は、その関数内で完結する一時的な型のみ許容。

## バリデーションの流れ

- application 層のバリデータ（`validateXxx`）は DTO を受け取る。
- domain 層の不変条件検証を呼ぶ際は、**DTO を分解してプリミティブな値を渡す**（domain を DTO から独立させるため）。
- domain の検証関数はプリミティブを受け取る純粋関数として実装する。

## ステップの分割基準

- ステップ数 2〜3 で密結合なら 1 ファイル（`steps.ts`）。4 以上、または責務が明確に異なるなら分割する。

## 外部 SDK（integrations/external）

- 外部サービスの SDK は必ず `src/integrations/external/` に薄いラッパーとして配置。features / middlewares から SDK を直接 import しない。
- ラッパーは `process.env` を参照せず、設定値は呼び出し元（container）からパラメータで受け取る。
- feature 間連携は ports + `integrations/composition/` アダプタ（CLAUDE.md 参照）。adapter を追加したら co-located テストを必ず書く。

参照: `docs/dev/adding-features.md`（実装例）/ `docs/dev/coding-standards.md`
