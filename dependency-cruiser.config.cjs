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
      from: { path: "^apps/api-service/src/features/.+/domain/" },
      to: { path: `^packages/database/|${npmPackagePath("drizzle-orm")}` },
    },
    // server: features -> routes の逆参照禁止
    {
      name: "server-features-to-routes",
      severity: "error",
      from: { path: "^apps/api-service/src/features/" },
      to: { path: "^apps/api-service/src/routes/" },
    },
    // server: application 層から infrastructure 参照禁止（同一 feature 内）
    {
      name: "server-application-no-infra",
      severity: "error",
      from: { path: "^apps/api-service/src/features/[^/]+/application/" },
      to: { path: "^apps/api-service/src/features/[^/]+/infrastructure/" },
    },
    // server: application 層から integrations 参照禁止（Cloud Tasks 等の直接利用防止）+ 旧 alias もブロック
    {
      name: "server-application-no-integrations",
      severity: "error",
      from: { path: "^apps/api-service/src/features/.+/application/" },
      to: { path: "^apps/api-service/src/integrations?/" },
    },
    // server: routes から domain/infrastructure への直接依存を禁止（service 経由を強制）
    {
      name: "server-routes-no-infra-or-domain",
      severity: "error",
      from: { path: "^apps/api-service/src/routes/" },
      to: {
        path: "^apps/api-service/src/features/.+/(infrastructure|domain)/",
      },
    },
    // server: presentation 層から domain/infrastructure への直接依存を禁止（application/service 経由を強制）
    {
      name: "server-presentation-no-infra-or-domain",
      severity: "error",
      from: { path: "^apps/api-service/src/features/[^/]+/presentation/" },
      to: { path: "^apps/api-service/src/features/.+/(infrastructure|domain)/" },
    },
    // server: domain 層から上位層/境界への依存を禁止
    {
      name: "server-domain-no-upward",
      severity: "error",
      from: { path: "^apps/api-service/src/features/[^/]+/domain/" },
      to: {
        path: "^apps/api-service/src/(features/[^/]+/(application|infrastructure|presentation)/|routes/|integration/)",
      },
    },
    // server: domain 層でフレームワーク/検証/HTTP/SDK の直参照禁止
    {
      name: "server-domain-no-framework-libs",
      severity: "error",
      from: { path: "^apps/api-service/src/features/[^/]+/domain/" },
      to: {
        path: ["hono", "zod", "axios", "node-fetch"].map(npmPackagePath).join("|"),
      },
    },
    // server: infrastructure から application/presentation/routes への逆依存禁止
    {
      name: "server-infrastructure-no-upward",
      severity: "error",
      from: { path: "^apps/api-service/src/features/[^/]+/infrastructure/" },
      to: {
        path: "^apps/api-service/src/(features/[^/]+/(application|presentation)/|routes/)",
      },
    },
    // server: application 層で DB 直参照禁止
    {
      name: "server-application-no-db",
      severity: "error",
      from: { path: "^apps/api-service/src/features/[^/]+/application/" },
      to: { path: `^packages/database/|${npmPackagePath("drizzle-orm")}` },
    },
    ...serverCrossFeatureRules,
    // server: middlewares から integrations への直接参照禁止（ports.ts 経由を強制）
    {
      name: "server-middlewares-no-direct-integrations",
      severity: "error",
      from: { path: "^apps/api-service/src/middlewares/" },
      to: { path: "^apps/api-service/src/integrations/" },
    },
    // server: middlewares は feature の application（と domain の型）のみ参照可。
    // infrastructure / presentation への依存は横断層の役割を逸脱する
    {
      name: "server-middlewares-no-infra-or-presentation",
      severity: "error",
      from: { path: "^apps/api-service/src/middlewares/" },
      to: { path: "^apps/api-service/src/features/[^/]+/(infrastructure|presentation)/" },
    },
    // server: shared（横断ヘルパ）は feature 非依存に保つ
    {
      name: "server-shared-no-features",
      severity: "error",
      from: { path: "^apps/api-service/src/shared/" },
      to: { path: "^apps/api-service/src/features/" },
    },
    // server: integrations/external（外部SDKラッパー）は features に依存不可
    {
      name: "server-integrations-external-no-features",
      severity: "error",
      from: { path: "^apps/api-service/src/integrations/external/" },
      to: { path: "^apps/api-service/src/features/" },
    },
    // server: integrations/composition（feature 間合成アダプタ）は各 feature の application 層
    // （service.ts / ports.ts）のみ参照可。domain・infrastructure・presentation への直接依存は禁止し、
    // feature の公開APIを経由させる。
    {
      name: "server-integrations-composition-only-application",
      severity: "error",
      from: { path: "^apps/api-service/src/integrations/composition/" },
      to: { path: "^apps/api-service/src/features/[^/]+/(domain|infrastructure|presentation)/" },
    },
    // server: features 層から Web フレームワークの直接参照を禁止（presentation 層のみ許可）
    {
      name: "server-features-no-web-framework",
      severity: "error",
      from: {
        path: "^apps/api-service/src/features/",
        pathNot: "^apps/api-service/src/features/[^/]+/presentation/",
      },
      to: { path: npmPackagePath("hono") },
    },
  ],
};
