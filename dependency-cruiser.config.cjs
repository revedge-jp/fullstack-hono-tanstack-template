// dependency-cruiser は from/to 間の正規表現バックリファレンス（\1 等）をサポートしない
// （to.path は from.path の capture group を参照できず、独立した正規表現として評価される）。
// そのため「feature 間の直接依存禁止」は、feature 名ごとにルールを動的生成する。
// feature 名はディレクトリ一覧から自動導出する（手動リストだと feature 追加時に
// 追記を忘れ、新 feature だけガードが効かない事故が起きるため）。
const { readdirSync } = require("node:fs");
const listFeatureDirs = (base) => {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};
const SERVER_FEATURE_DIRS = listFeatureDirs("apps/api-service/src/features");
const CLIENT_FEATURE_DIRS = listFeatureDirs("apps/client/features");

// npm パッケージへの to.path は「解決済みファイルパス」に対してマッチする
// （インポート指定子そのものではない）。node_modules 配下のパスは
// パッケージマネージャ・レイアウト（bun の `.bun/<pkg>@<ver>+hash/`、pnpm の `.pnpm/` 等）で
// 形が変わるため、`node_modules/` の後に任意の中間パスを許容してパッケージ名にマッチさせる。
// `.*` を optional group ( (…)? ) で包むと dependency-cruiser の安全な正規表現チェックに
// 引っかかる（ReDoS 疑いで弾かれる）ため、group化せずそのまま使う。
const npmPackagePath = (pkg) => `(^|/)node_modules/.*/${pkg}/`;

const serverCrossFeatureRules = SERVER_FEATURE_DIRS.map((feature) => ({
  name: `server-application-cross-features-${feature}`,
  severity: "error",
  comment:
    "feature 間の直接依存禁止。連携が必要な場合は自 feature の application/ports.ts に" +
    "抽象ポート型を定義し、実装(アダプタ)は integrations/composition に置き、container.ts で配線する。",
  from: { path: `^apps/api-service/src/features/${feature}/application/` },
  to: { path: `^apps/api-service/src/features/(?!${feature}/)` },
}));

const clientCrossFeatureRules = CLIENT_FEATURE_DIRS.map((feature) => ({
  name: `client-cross-features-${feature}`,
  severity: "error",
  comment:
    "client: features 間の直接参照を禁止（機能間の独立性を担保）。共通コンポーネントは apps/client/shared へ。",
  from: { path: `^apps/client/features/${feature}/` },
  to: { path: `^apps/client/features/(?!${feature}/)` },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsConfig: {
      fileName: "tsconfig.depcruise.json",
    },
    // doNotFollow は node_modules 配下への「再帰」を止めるが、エッジ自体は葉として報告される
    // ため to.path での判定に使える。exclude は node_modules を含めない
    // （含めるとエッジ自体がグラフから消え、npm パッケージを禁止する to.path ルールが
    // 全く発火しなくなる — 実際にこの不具合が存在していた）。
    doNotFollow: { path: "node_modules" },
    // `.claude/worktrees` はメインのチェックアウト配下に作られる git worktree の置き場で、
    // 中身は別ブランチのソース一式。depcruise はリポジトリルート(`.`)から走査し gitignore も
    // 見ないため、除外しないと他ブランチのコードまで解析対象になる。実害は2つ:
    //   1. 走査対象が桁違いに増えて arch:dc が無駄に遅い
    //   2. 他の worktree で mutation テスト(Stryker)が動いていると、走査中にサンドボックスが
    //      破棄されて ENOENT で落ちる。自分の変更と無関係に push が失敗し、原因も分かりにくい
    // `.stryker-tmp` 自体も、メイン側で mutation テストを回した場合に同じ問題を起こすため除外する。
    exclude: {
      path: [
        "\\.next",
        "dist",
        "build",
        "generated",
        "__tests__",
        "\\.test\\.",
        "\\.spec\\.",
        "\\.claude/worktrees",
        "\\.stryker-tmp",
      ],
    },
  },
  forbidden: [
    // client: shared -> features 禁止
    {
      name: "client-shared-to-features",
      severity: "error",
      comment:
        "shared は feature 非依存に保つ。feature 固有の型・関数が必要なら shared 側に抽象を置き、feature から shared を参照する向きに直す。",
      from: { path: "^apps/client/shared/" },
      to: { path: "^apps/client/features/" },
    },
    ...clientCrossFeatureRules,
    // server: domain 層で DB 直参照禁止
    // @repo/db は tsconfig paths でワークスペース内ファイルに解決されるため、
    // to.path は解決後のファイルパス（packages/database/）にマッチさせる
    {
      name: "server-domain-no-db",
      severity: "error",
      comment:
        "domain は永続化を知らない。DB アクセスは infrastructure の *.repository.drizzle.ts に置き、domain には repository インターフェース(型)だけを残す。",
      from: { path: "^apps/api-service/src/features/.+/domain/" },
      to: { path: `^packages/database/|${npmPackagePath("drizzle-orm")}` },
    },
    // server: features -> routes の逆参照禁止
    {
      name: "server-features-to-routes",
      severity: "error",
      comment:
        "features から routes を参照しない。ルーティングは app.ts が features/*/presentation を組み立てる一方向。",
      from: { path: "^apps/api-service/src/features/" },
      to: { path: "^apps/api-service/src/routes/" },
    },
    // server: application 層から infrastructure 参照禁止（同一 feature 内）
    {
      name: "server-application-no-infra",
      severity: "error",
      comment:
        "application は infrastructure を直接参照しない。domain の repository インターフェース型を deps で受け取り、container.ts で Drizzle 実装を注入する。",
      from: { path: "^apps/api-service/src/features/[^/]+/application/" },
      to: { path: "^apps/api-service/src/features/[^/]+/infrastructure/" },
    },
    // server: application 層から integrations 参照禁止（Cloud Tasks 等の直接利用防止）+ 旧 alias もブロック
    {
      name: "server-application-no-integrations",
      severity: "error",
      comment:
        "application は integrations を直接参照しない。必要な外部機能は application/ports.ts に型として宣言し、integrations/composition のアダプタを container.ts で注入する。",
      from: { path: "^apps/api-service/src/features/.+/application/" },
      to: { path: "^apps/api-service/src/integrations?/" },
    },
    // server: routes から domain/infrastructure への直接依存を禁止（service 経由を強制）
    {
      name: "server-routes-no-infra-or-domain",
      severity: "error",
      comment:
        "routes は service 経由でだけ feature を使う。domain/infrastructure が必要になったら application/service.ts に操作を足す。",
      from: { path: "^apps/api-service/src/routes/" },
      to: {
        path: "^apps/api-service/src/features/.+/(infrastructure|domain)/",
      },
    },
    // server: presentation 層から domain/infrastructure への直接依存を禁止（application/service 経由を強制）
    {
      name: "server-presentation-no-infra-or-domain",
      severity: "error",
      comment:
        "presentation(router.ts)は HTTP I/O だけを担当し service を呼ぶ。domain の型や repository が必要なら application 層のレスポンス mapper / service に寄せる。",
      from: { path: "^apps/api-service/src/features/[^/]+/presentation/" },
      to: { path: "^apps/api-service/src/features/.+/(infrastructure|domain)/" },
    },
    // server: domain 層から上位層/境界への依存を禁止
    {
      name: "server-domain-no-upward",
      severity: "error",
      comment:
        "domain は最下層。application/infrastructure/presentation の型が必要に見えたら、その型を domain/models.ts に移す(DTO なら application に留めて domain には渡さない)。",
      from: { path: "^apps/api-service/src/features/[^/]+/domain/" },
      to: {
        path: "^apps/api-service/src/(features/[^/]+/(application|infrastructure|presentation)/|routes/|integration/)",
      },
    },
    // server: domain 層でフレームワーク/検証/HTTP/SDK の直参照禁止
    {
      name: "server-domain-no-framework-libs",
      severity: "error",
      comment:
        "domain は純粋な TypeScript。Zod のバリデーションは application/validators.ts、HTTP は presentation に置く。",
      from: { path: "^apps/api-service/src/features/[^/]+/domain/" },
      to: {
        path: ["hono", "zod", "axios", "node-fetch"].map(npmPackagePath).join("|"),
      },
    },
    // server: infrastructure から application/presentation/routes への逆依存禁止
    {
      name: "server-infrastructure-no-upward",
      severity: "error",
      comment:
        "infrastructure は domain だけに依存する。application の型が欲しくなったら、それは domain に置くべき型。",
      from: { path: "^apps/api-service/src/features/[^/]+/infrastructure/" },
      to: {
        path: "^apps/api-service/src/(features/[^/]+/(application|presentation)/|routes/)",
      },
    },
    // server: application 層で DB 直参照禁止
    {
      name: "server-application-no-db",
      severity: "error",
      comment:
        "application は DB を直接触らない。クエリは infrastructure の repository 実装に置き、application は repository インターフェース経由で呼ぶ。",
      from: { path: "^apps/api-service/src/features/[^/]+/application/" },
      to: { path: `^packages/database/|${npmPackagePath("drizzle-orm")}` },
    },
    ...serverCrossFeatureRules,
    // server: middlewares から integrations への直接参照禁止（ports.ts 経由を強制）
    {
      name: "server-middlewares-no-direct-integrations",
      severity: "error",
      comment:
        "middlewares は integrations を直接参照しない。必要な機能は deps(ports)として受け取り、container.ts で注入する。",
      from: { path: "^apps/api-service/src/middlewares/" },
      to: { path: "^apps/api-service/src/integrations/" },
    },
    // server: middlewares は feature の application（と domain の型）のみ参照可。
    // infrastructure / presentation への依存は横断層の役割を逸脱する
    {
      name: "server-middlewares-no-infra-or-presentation",
      severity: "error",
      comment:
        "middlewares は feature の application(service / ports)と domain の型だけを使う。infrastructure が必要なら application 経由に寄せる。",
      from: { path: "^apps/api-service/src/middlewares/" },
      to: { path: "^apps/api-service/src/features/[^/]+/(infrastructure|presentation)/" },
    },
    // server: shared（横断ヘルパ）は feature 非依存に保つ
    {
      name: "server-shared-no-features",
      severity: "error",
      comment:
        "shared は feature 非依存の横断ヘルパ。feature の型が必要なら、その型を shared に持ち上げるか、ヘルパをジェネリックにする。",
      from: { path: "^apps/api-service/src/shared/" },
      to: { path: "^apps/api-service/src/features/" },
    },
    // server: integrations/external（外部SDKラッパー）は features に依存不可
    {
      name: "server-integrations-external-no-features",
      severity: "error",
      comment:
        "integrations/external は第三者 SDK の薄いラッパー。feature の知識は integrations/composition のアダプタに置く。",
      from: { path: "^apps/api-service/src/integrations/external/" },
      to: { path: "^apps/api-service/src/features/" },
    },
    // server: integrations/composition（feature 間合成アダプタ）は各 feature の application 層
    // （service.ts / ports.ts）のみ参照可。domain・infrastructure・presentation への直接依存は禁止し、
    // feature の公開APIを経由させる。
    {
      name: "server-integrations-composition-only-application",
      severity: "error",
      comment:
        "composition アダプタは feature の application/service.ts か application/ports.ts だけを使う。domain/infrastructure が必要なら service にメソッドを足す。",
      from: { path: "^apps/api-service/src/integrations/composition/" },
      to: { path: "^apps/api-service/src/features/[^/]+/(domain|infrastructure|presentation)/" },
    },
    // server: features 層から Web フレームワークの直接参照を禁止（presentation 層のみ許可）
    {
      name: "server-features-no-web-framework",
      severity: "error",
      comment:
        "hono を import してよいのは presentation だけ。Context が必要な処理は presentation で値を取り出して application に渡す。",
      from: {
        path: "^apps/api-service/src/features/",
        pathNot: "^apps/api-service/src/features/[^/]+/presentation/",
      },
      to: { path: npmPackagePath("hono") },
    },
  ],
};
