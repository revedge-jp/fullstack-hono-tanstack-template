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
    // client: features 間の直接参照を禁止（機能間の独立性を担保）
    // 共通コンポーネントが必要な場合は apps/client/shared に移動すること
    {
      name: "client-cross-features",
      severity: "error",
      from: { path: "^apps/client/features/([^/]+)/" },
      to: { path: "^apps/client/features/(?!\\1)/" },
    },
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
    // server: application 層のクロス feature 参照を警告
    {
      name: "server-application-cross-features",
      severity: "warn",
      from: { path: "^apps/api-service/src/features/([^/]+)/application/" },
      to: { path: "^apps/api-service/src/features/(?!\\1)/" },
    },
    // server: middlewares から integrations への直接参照禁止（ports.ts 経由を強制）
    {
      name: "server-middlewares-no-direct-integrations",
      severity: "error",
      from: { path: "^apps/api-service/src/middlewares/" },
      to: { path: "^apps/api-service/src/integrations/" },
    },
    // server: integrations は features の ports.ts 型のみ参照可（他の feature コードへの依存禁止）
    {
      name: "server-integrations-no-features-except-ports",
      severity: "error",
      from: { path: "^apps/api-service/src/integrations/" },
      to: {
        path: "^apps/api-service/src/features/",
        pathNot: "^apps/api-service/src/features/[^/]+/ports\\.ts$",
      },
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
