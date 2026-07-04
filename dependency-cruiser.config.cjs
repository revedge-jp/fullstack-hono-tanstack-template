// dependency-cruiser は from/to 間の正規表現バックリファレンス（\1 等）をサポートしない
// （to.path は from.path の capture group を参照できず、独立した正規表現として評価される）。
// そのため「feature 間の直接依存禁止」は、既知の feature 名を列挙してルールを動的生成する。
// 新しい feature を追加したら、このリストにも追記すること。
const SERVER_FEATURE_DIRS = ["activity", "auth", "tasks"];
const CLIENT_FEATURE_DIRS = ["auth"];

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
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "node_modules",
        "\\.next",
        "dist",
        "build",
        "generated",
        "__tests__",
        "\\.test\\.",
        "\\.spec\\.",
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
    {
      name: "server-domain-no-db",
      severity: "error",
      from: { path: "^apps/api-service/src/features/.+/domain/" },
      to: { path: "^(?:@repo/db|drizzle-orm(?:/|$))" },
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
        path: "^(?:@?hono(?:/|$)|zod|axios|node-fetch)",
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
      to: { path: "^(?:@repo/db|drizzle-orm(?:/|$))" },
    },
    ...serverCrossFeatureRules,
    // server: middlewares から integrations への直接参照禁止（ports.ts 経由を強制）
    {
      name: "server-middlewares-no-direct-integrations",
      severity: "error",
      from: { path: "^apps/api-service/src/middlewares/" },
      to: { path: "^apps/api-service/src/integrations/" },
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
      to: { path: "^@?hono(?:/|$)" },
    },
  ],
};
