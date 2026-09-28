# ADR-008: SmartHR Design System のガイドラインと値を取り込み、smarthr-ui は使わない

**ステータス**: 採用済み
**日付**: 2026-09-28

---

## コンテキスト

client の UI は shadcn/ui（`style: base-vega`、Base UI 前提）と Tailwind v4 で組み、使える色・余白・
文字サイズを `.claude/rules/client.md` の「デザイン規約」と `scripts/check/client-styles.mjs` で絞っている。
ただし、規約の値（配色・余白の段階）と文言の書き方は、このテンプレートの中で決めたもので、拠り所となる
外部の基準が無かった。

[SmartHR Design System](https://smarthr.design/)（以下 SmartHR DS）は、日本語の業務向け SaaS のための
デザインシステムで、デザイントークン（色・余白・文字サイズ・角丸）、ライティングのガイドラインと用字用語、
WCAG 2.2 に沿ったアクセシビリティのチェックリスト、画面パターン（削除ダイアログ・余白の取り方等）を
公開している。実装ライブラリとして smarthr-ui（MIT）もある。

SmartHR DS を取り込む方法として、次の 2 つを比べた。

1. smarthr-ui に置き換える
2. shadcn/ui のまま、SmartHR DS の値とガイドラインだけを取り込む

2026-09-28 時点の smarthr-ui（v99.8.0）の配布物を確認した結果、1 には次の問題がある。

- **Tailwind の世代が違う**。smarthr-ui は依存に Tailwind CSS v3 を持ち、ビルド済みの `smarthr-ui.css`
  （約 150KB、v3 のリセット CSS を含む）を読み込ませる。この CSS は `@layer` の外にあるので、`@layer` の中に
  出力される Tailwind v4 のクラスとぶつかると、CSS の仕様上 smarthr-ui 側が常に勝つ。`className` で配置を
  付けるという client の規約どおりに書いても、指定した余白や幅にならない箇所が出る
- **peer 依存が重い**。`styled-components` v5 と `react-intl` が必須で、`IntlProvider` で全体を包む必要がある。
  TanStack Start の SSR で styled-components v5 のスタイルを集める仕組みも別に要る
- **メジャー版が速く上がる**。2026-02 の v85 から 2026-07 の v99 まで、半年で 15 回上がっている。smarthr-ui は
  SmartHR 社の自社プロダクトに合わせて開発されているので、テンプレートの利用者が破壊的変更を追い続けることになる
- **規約とガードを作り直すことになる**。トークン表・文字サイズの規約・`client-styles.mjs` の規則・oxlint と knip の
  除外設定は shadcn を前提にしている
- **AI エージェントが書きにくい**。shadcn は学習データに多く、公式の agent skill もある。API が毎週のように
  変わる smarthr-ui では、エージェントが古い書き方を出しやすい（ADR-006 の「生成と検証」の考え方と逆になる）

## 決定

**shadcn/ui と Tailwind v4 のまま、SmartHR DS の値とガイドラインを取り込む。smarthr-ui は依存に入れない。**

- 値: `apps/client/app/globals.css` のライトの配色を SmartHR DS のセマンティックトークン（`MAIN` / `TEXT_BLACK` /
  `TEXT_GREY` / `BORDER` / `OUTLINE` / `DANGER` / `CHART_COLOR_*` 等）に合わせ、角丸を SmartHR DS の
  4px / 6px / 8px にした。各行のコメントに対応するトークン名を書いている
- ガイドライン: `.claude/rules/client.md` の「デザイン規約」に、余白の段階・文言の形（ボタンは動詞の終止形、
  見出しは名詞等）・用字用語・エラー文言の「事象・原因・対処」・削除の確認・アクセシビリティの項目を足した
- 既存の画面の文言は、上の規約に合わせて直した（「ホームに戻る」「読み込み中…」、ページの `<title>` の区切りを「｜」にする等）

SmartHR DS の値をそのまま使わなかった箇所と理由:

- **削除の色**: SmartHR DS の Danger ボタンは赤地に白文字だが、shadcn の `variant="destructive"` は薄い赤の地に
  赤の文字で描く。`DANGER`（`#e01e5a`）のままだと地が 10% のとき 4.0:1 になり AA（4.5:1）を割るので、同じ色相で
  明るさだけ下げた
- **ダークモード**: SmartHR DS には定義が無い。SmartHR DS のグレースケールと同じ色相で作り、既存と同じ基準
  （本文・削除ボタンの hover で 4.5:1 以上）を満たす値にした
- **本文の文字サイズ**: SmartHR DS の本文は 16px だが、shadcn のコンポーネントが 14px（`text-sm`）で揃っている
  ので 14px のままにした
- **書体**: SmartHR DS は `system-ui` を指定しているが、LINE Seed JP のままにした

## 結果

- 配色・余白・文言を決めるときに、「SmartHR DS に合わせる」という外部の拠り所を持てる。規約に無いことで
  迷ったら SmartHR DS の該当ページを読めば決まる
- smarthr-ui の更新を追う必要はない。一方で、SmartHR DS のガイドラインが更新されても自動では反映されない。
  `client.md` の AI slop の表と同じく、半年を目安に見直す
- 主要ボタンの hover（shadcn の `bg-primary/80`）は、ライトで 3.4:1 と AA を割る。SmartHR DS は hover で色を
  暗くするが、shadcn の生成物は薄くするためで、変更前の配色（3.3:1）から続いている。生成物は書き換えない規約なので、
  この ADR では直していない
- SmartHR DS のコンポーネント（`ActionDialog` 等）は無いので、ガイドラインに出てくるコンポーネントは同じ役割の
  shadcn のコンポーネントで組む

## 関連

- `.claude/rules/client.md` の「デザイン規約」
- `apps/client/app/globals.css`
- [ADR-006: AI 時代の品質戦略](adr-006-ai-era-quality-strategy.md)
