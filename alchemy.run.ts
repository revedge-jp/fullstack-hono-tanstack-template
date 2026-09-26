/**
 * Alchemy (Infrastructure as TypeScript) — Cloudflare + PlanetScale リソース定義
 *
 * PlanetScale の DB/Role 作成、Hyperdrive の作成、Worker のデプロイを
 * TypeScript 一枚で管理する（DB → 接続情報 → Hyperdrive → Worker が全自動）。
 * CI（deploy.yml）はこれを 2 段実行する:
 *   1) SKIP_WORKER=1 — DB/Role/Hyperdrive を作成し DATABASE_URL を GITHUB_ENV へ export
 *   2) drizzle-kit migrate（新コードが旧スキーマを踏まないよう Worker 更新より先に流す）
 *   3) SKIP_WORKER なし — Worker をデプロイ
 *
 * 使い方: docs/dev/alchemy-iac.md を参照
 *   bun run infra:deploy:staging   # ビルド + staging デプロイ
 *   bun run infra:destroy:staging  # staging リソース削除（DB 本体は削除されず state からのみ外れる）
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

import alchemy from "alchemy";
import {
  Assets,
  createCloudflareApi,
  CustomDomain,
  findZoneForHostname,
  Hyperdrive,
  LogPushJob,
  Ruleset,
  Worker,
} from "alchemy/cloudflare";
import { Branch, Database, Role } from "alchemy/planetscale";
import { CloudflareStateStore } from "alchemy/state";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`環境変数 ${key} が未設定です（.env を確認してください）`);
  }
  return value;
}

const appName = requireEnv("APP_NAME");
if (appName.includes("{{")) {
  throw new Error("APP_NAME がテンプレートプレースホルダーのままです");
}

// state は CF アカウント上の Durable Object に置く（ローカルと CI で共有 — 使い捨ての
// CI ランナーでも state が失われない）。ALCHEMY_STATE_TOKEN は同じ CF アカウント内の全実行環境で同一の値に
// すること（別アカウントには別の値。docs/dev/alchemy-iac.md「state と資格情報の権限境界」）。
requireEnv("ALCHEMY_STATE_TOKEN");
const app = await alchemy(appName, {
  stateStore: (scope) => new CloudflareStateStore(scope),
});

const stage = app.stage;
// pr-<番号> は PR プレビュー環境（preview.yml が管理。DB は staging DB のブランチ）
const isPreview = /^pr-\d+$/.test(stage);
if (stage !== "staging" && stage !== "production" && !isPreview) {
  throw new Error(
    `stage は staging | production | pr-<番号> のみ対応です（--stage で指定、現在: ${stage}）`,
  );
}

// wrangler.jsonc の env 命名と揃える: staging は -staging サフィックス、production は素の名前
const workerName = stage === "production" ? appName : `${appName}-${stage}`;

// ---- オプション機能（カスタムドメイン運用時のみ有効化） -------------------
// いずれも preview では無視する（preview の URL は常に workers.dev、リソースは使い捨て）。
//
// CUSTOM_DOMAIN: Worker に割り当てるホスト名（例: app.example.com）。zone が同じ
// CF アカウントにあれば zone ID はホスト名から自動解決され、DNS レコードの作成・
// TLS 証明書の発行まで Cloudflare 側で自動化される。API トークンには Workers 権限に
// 加えて対象 zone の Zone:Read + DNS:Edit が必要（docs/deploy/cloudflare-workers.md）。
// Cloudflare はホスト名を小文字で返すので、比べる前にそろえる（大文字のままだと Custom Domains の一覧と一致せず、
// workers.dev の URL がいつまでも閉じない）
const customDomain = (!isPreview && process.env.CUSTOM_DOMAIN?.toLowerCase()) || undefined;
if (customDomain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(customDomain)) {
  throw new Error(
    `CUSTOM_DOMAIN はホスト名のみで指定してください（例: app.example.com — URL 形式・パス・ポート付きは不可。現在: ${customDomain}）`,
  );
}

// EDGE_RATE_LIMIT_RPM: エッジ（WAF）での /api/* レート制限。IP ごとの分間リクエスト数。
// zone 必須のため CUSTOM_DOMAIN とセットでのみ有効。
//
// 【重要】Ruleset リソースは対象 zone の http_ratelimit フェーズの entrypoint を
// 「丸ごと」管理する（既存ルールは上書き、destroy でフェーズ全体が空になる）。
// このため deploy 時に既存ルールを検査し、この stage の管理外のルール（手動ルールや
// 別 stage のルール）が zone にある場合は上書きせずエラーで中断する（下のガード参照）。
//   - 同じ zone を他のアプリ・手動ルールと共有している場合は有効化しないこと
//   - staging と production が同一 zone を共有する場合、有効化はどちらか一方のみ
const edgeRateLimitRpmRaw = (!isPreview && process.env.EDGE_RATE_LIMIT_RPM) || undefined;
const edgeRateLimitRpm = edgeRateLimitRpmRaw ? Number(edgeRateLimitRpmRaw) : undefined;
if (
  edgeRateLimitRpm !== undefined &&
  (!Number.isInteger(edgeRateLimitRpm) || edgeRateLimitRpm < 6)
) {
  throw new Error(
    `EDGE_RATE_LIMIT_RPM は 6 以上の整数で指定してください（現在: ${edgeRateLimitRpmRaw}）`,
  );
}
if (edgeRateLimitRpm !== undefined && !customDomain) {
  throw new Error(
    "EDGE_RATE_LIMIT_RPM には CUSTOM_DOMAIN が必要です（zone 単位の WAF ルールのため）",
  );
}

// LOGPUSH_DESTINATION: Worker の trace ログ（console.log / 例外）を外部へ転送する
// Logpush の宛先 URI（例: R2 なら r2://bucket/path?account-id=...&access-key-id=...&
// secret-access-key=...）。Workers Paid プランが必要。値に資格情報を含むため secret 扱い。
const logpushDestination = (!isPreview && process.env.LOGPUSH_DESTINATION) || undefined;

// ---- PlanetScale (DB + Role) -------------------------------------------
// 認証はサービストークン（PLANETSCALE_SERVICE_TOKEN_ID / PLANETSCALE_SERVICE_TOKEN）。
// プロバイダは環境変数を暗黙参照するが、エラーを早期化するためここで検証する。
requireEnv("PLANETSCALE_SERVICE_TOKEN_ID");
requireEnv("PLANETSCALE_SERVICE_TOKEN");
const planetscaleOrg = requireEnv("PLANETSCALE_ORGANIZATION");

let dbRole: Role;
let dbDisplayName: string;
if (isPreview) {
  // PR プレビュー: staging DB のブランチ（PS-DEV、存在時間分だけの課金）を使い捨て DB として使う。
  // スキーマ・データは複製されないため、preview.yml が migration を頭から適用する。
  const branch = await Branch("db-branch", {
    name: stage, // 例: pr-123
    database: `${appName}-staging`, // staging DB が親（先に staging がデプロイされている必要がある）
    organization: planetscaleOrg,
    isProduction: false,
    adopt: true,
    // 必ず明示する: JSDoc は「デフォルト true」と言うが実装は `props.delete ?? false`
    // （alchemy 0.93 のドキュメント齟齬）。明示しないと destroy で state から外れるだけで
    // ブランチ実体が残り、PS-DEV の課金が続く
    delete: true,
  });
  dbRole = await Role("db-role", {
    database: `${appName}-staging`,
    organization: planetscaleOrg,
    branch,
    inheritedRoles: ["postgres"],
  });
  dbDisplayName = `${appName}-staging#${stage}`;
} else {
  const database = await Database("database", {
    name: `${appName}-${stage}`,
    organization: planetscaleOrg,
    kind: "postgresql",
    clusterSize: "PS_5",
    // 0 = シングルノード（$5/月）。未指定だと PlanetScale デフォルトの HA（Primary+レプリカ2 = 3倍額）
    // で作られるため必ず明示する。本番を HA にしたくなったら 2 に上げる（create 時のみ有効。
    // 既存 DB はダッシュボードの Cluster 設定から変更する）
    replicas: 0,
    arch: "arm", // Graviton。x86 より価格性能比が良い
    region: { slug: "ap-northeast" }, // AWS Tokyo (ap-northeast-1)
    adopt: true,
    // delete はデフォルト false: infra:destroy しても DB 本体は削除されない（誤削除防止）
  });

  // アプリ/マイグレーション用ロール。TTL なし（無期限）。
  dbRole = await Role("db-role", {
    database,
    inheritedRoles: ["postgres"],
  });
  dbDisplayName = database.name;
}

// ---- Hyperdrive --------------------------------------------------------
// ADR-002: origin は PlanetScale の直接続エンドポイント（port 5432）。
// pooled 接続（port 6432 / PgBouncer）を使うと Hyperdrive と pooler の二段構成になり、
// Supabase 時代に踏んだものと同種の接続調整エラーの温床になるため使わない。
const hyperdrive = await Hyperdrive("hyperdrive", {
  name: `${appName}-${stage}`,
  adopt: true,
  // クエリキャッシュは切る（既定では有効で、同じ SELECT を最大 60 秒キャッシュから返す）。作った直後の一覧に
  // 古い結果が出る・削除したセッションの行が返る・/api/health の SELECT 1 がキャッシュから返って DB の障害を
  // 隠す、が起きる。ローカルと E2E は Hyperdrive を通らないので、テストでは見つからない
  caching: { disabled: true },
  origin: {
    host: dbRole.host,
    port: 5432,
    database: dbRole.databaseName,
    user: dbRole.username,
    password: dbRole.password,
  },
});

// Hyperdrive の origin 接続数上限を是正する。alchemy の HyperdriveProps には
// origin_connection_limit を設定するプロパティが存在しないため、Cloudflare API を直接叩く。
// 値は DB 側の実際の接続上限より低く保つ（既定の 60 では PlanetScale の接続枠を先に枯渇させる）。
// クラスタサイズを変えたときは見直しの順序を誤ると接続枯渇障害になる — 背景と手順は
// docs/dev/alchemy-iac.md の「Hyperdrive の origin_connection_limit」。
const HYPERDRIVE_ORIGIN_CONNECTION_LIMIT = 15;
{
  const cfApi = await createCloudflareApi();
  const patchRes = await cfApi.patch(
    `/accounts/${cfApi.accountId}/hyperdrive/configs/${hyperdrive.hyperdriveId}`,
    { origin_connection_limit: HYPERDRIVE_ORIGIN_CONNECTION_LIMIT },
  );
  if (!patchRes.ok) {
    throw new Error(
      `Hyperdrive の origin_connection_limit 設定に失敗しました（HTTP ${patchRes.status}）`,
    );
  }
  console.info(
    `[alchemy] hyperdrive origin_connection_limit=${HYPERDRIVE_ORIGIN_CONNECTION_LIMIT} に是正しました`,
  );
}

// Cloudflare の Workers Custom Domains の一覧で、このホスト名がこの Worker に付いているかを見る
async function isCustomDomainAttached(hostname: string, service: string): Promise<boolean> {
  const cfApi = await createCloudflareApi();
  const res = await cfApi.get(
    `/accounts/${cfApi.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
  );
  if (!res.ok) {
    throw new Error(
      `Workers Custom Domains の確認に失敗しました（HTTP ${res.status}）。CLOUDFLARE_API_TOKEN の権限を確認してください`,
    );
  }
  const body: { result?: Array<{ hostname?: string; service?: string }> } = await res.json();
  return (body.result ?? []).some(
    (domain) => domain.hostname === hostname && domain.service === service,
  );
}

// /api/health/live が 200 を返すまで待つ（証明書の発行・DNS の反映に数分かかることがある）
async function waitUntilServing(origin: string): Promise<boolean> {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    try {
      const res = await fetch(`${origin}/api/health/live`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        return true;
      }
    } catch {
      // まだ届かない
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return false;
}

const ALLOW_UNVERIFIED_HINT =
  "初回デプロイなど稼働中の版が無いときだけ ALLOW_UNVERIFIED_LOCAL_DEPLOY=1 を付けて実行してください";

// 稼働中のインフラの定義の commit（/api/health/live の infraCommit）を、手元の HEAD が含むかを確かめる
async function assertLocalCheckoutCoversRunningInfra(origin: string): Promise<void> {
  let running: string | undefined;
  try {
    const res = await fetch(`${origin}/api/health/live`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body: { infraCommit?: unknown; commit?: unknown } = await res.json();
      const value = body.infraCommit ?? body.commit;
      running = typeof value === "string" ? value : undefined;
    }
  } catch {
    running = undefined;
  }
  if (running === undefined || !/^[0-9a-f]{40}$/.test(running)) {
    throw new Error(
      `稼働中のインフラの定義の commit を ${origin}/api/health/live から読めません` +
        "（CUSTOM_DOMAIN 等の GitHub Environment の変数を入れ忘れた・稼働中の版を GIT_SHA 無しでデプロイした等）。" +
        ALLOW_UNVERIFIED_HINT,
    );
  }
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  try {
    git("merge-base", "--is-ancestor", running, "HEAD");
  } catch {
    throw new Error(
      `手元の HEAD が稼働中のインフラの定義の commit（${running}）を含みません。git fetch して、それを含む commit ` +
        "からデプロイしてください（古い checkout でデプロイすると、その後に足したリソースを finalize が削除する）",
    );
  }
  if (
    git(
      "status",
      "--porcelain",
      "--untracked-files=no",
      "--",
      "alchemy.run.ts",
      "package.json",
      "bun.lock",
    )
  ) {
    throw new Error(
      "alchemy.run.ts・package.json・bun.lock にコミットしていない変更があります。コミットしてからデプロイしてください",
    );
  }
}

// ---- Worker ------------------------------------------------------------
// vite build（@cloudflare/vite-plugin）の成果物をそのままデプロイする。
// noBundle: true — dist/server/ 以下の .js チャンクは既に CF Workers 向けにバンドル済み。
// SKIP_WORKER=1（CI の provision フェーズ）では DB/Hyperdrive までで止める。
if (process.env.SKIP_WORKER !== "1") {
  const entrypoint = "apps/client/dist/server/index.js";
  if (!existsSync(entrypoint)) {
    throw new Error(
      `${entrypoint} がありません。先に \`cd apps/client && bun run build\` を実行してください`,
    );
  }

  // Better Auth / CORS はデプロイ後の公開 URL を必要とする。
  // CUSTOM_DOMAIN（Alchemy がドメイン割り当てまで行う）→ APP_ORIGIN（手動割り当てした URL の
  // 明示指定・後方互換）→ WORKERS_SUBDOMAIN（workers.dev URL の組み立て）の順で解決する。
  // ?? ではなく || : CI では未設定の GitHub Variable が「空文字列」として渡ってくるため、
  // 空でも次の候補へフォールバックさせる。
  // preview では CUSTOM_DOMAIN / APP_ORIGIN を無視する（staging のカスタムドメインを指すため。
  // preview の URL は常に workers.dev — WORKERS_SUBDOMAIN が必須）。
  const appOrigin =
    (customDomain && `https://${customDomain}`) ||
    (!isPreview && process.env.APP_ORIGIN) ||
    (process.env.WORKERS_SUBDOMAIN
      ? `https://${workerName}.${process.env.WORKERS_SUBDOMAIN}.workers.dev`
      : undefined);
  if (!appOrigin) {
    throw new Error(
      "APP_ORIGIN または WORKERS_SUBDOMAIN を設定してください（BETTER_AUTH_URL / CORS_ORIGIN に使用）",
    );
  }

  // カスタムドメインが既にこの Worker に付いているときだけ、Worker の更新で workers.dev の URL を閉じる。ドメインを
  // 足すデプロイで先に閉じると、CustomDomain の作成が失敗したとき（同じホスト名の DNS レコードが既にある等）に、
  // どちらの URL からも届かなくなる（smoke も自動ロールバックも走らない）。足すデプロイでは、ドメインが応答してから
  // 閉じる（下の CustomDomain の後）
  const customDomainAttached = customDomain
    ? await isCustomDomainAttached(customDomain, workerName)
    : false;
  const workersDevOrigin = process.env.WORKERS_SUBDOMAIN
    ? `https://${workerName}.${process.env.WORKERS_SUBDOMAIN}.workers.dev`
    : undefined;

  // ローカル（CI 以外）から staging / production へデプロイするときは、手元の checkout が稼働中のインフラの定義を
  // 含むときだけ進める（古い checkout・作業中のブランチでデプロイすると、稼働中より古い定義で Worker 等が上書きされる）。
  // GitHub Environment にしか無い変数の入れ忘れはここでは分からないので、ローカルでは finalize しない（ファイル末尾）。
  // 初回デプロイなど稼働中の版が無いときだけ ALLOW_UNVERIFIED_LOCAL_DEPLOY=1 で飛ばす
  if (!process.env.CI && !isPreview && process.env.ALLOW_UNVERIFIED_LOCAL_DEPLOY !== "1") {
    // ドメインを足すデプロイでは、稼働中の版はまだ workers.dev で動いている
    const runningOrigin = customDomain && !customDomainAttached ? workersDevOrigin : appOrigin;
    await assertLocalCheckoutCoversRunningInfra(runningOrigin ?? appOrigin);
  }

  // WAF の上書きガードは Worker を更新する前に確かめる（後で止めると、新しいコードだけが公開されたまま smoke を通らない）
  const ruleMarker = `[alchemy:${workerName}]`;
  if (customDomain && edgeRateLimitRpm !== undefined) {
    // 上書きガード: Ruleset はフェーズの entrypoint を全置換するため、この stage の目印
    // （ruleMarker）を持たないルールが zone に残っている場合は、消さずに中断する。
    // 別 stage のルールも目印が異なるので検出される（「1 zone 1 stage」の機械的な強制）。
    const cfApi = await createCloudflareApi();
    const { zoneId } = await findZoneForHostname(cfApi, customDomain);
    const entrypointRes = await cfApi.get(
      `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`,
    );
    if (entrypointRes.ok) {
      const entrypoint: { result?: { rules?: Array<{ description?: string }> } } =
        await entrypointRes.json();
      const foreignRules = (entrypoint.result?.rules ?? []).filter(
        (rule) => !(rule.description ?? "").includes(ruleMarker),
      );
      if (foreignRules.length > 0) {
        const summary = foreignRules.map((r) => r.description || "(説明なし)").join(" / ");
        throw new Error(
          `zone の http_ratelimit フェーズに管理外のルールが ${foreignRules.length} 件あります（${summary}）。` +
            "EDGE_RATE_LIMIT_RPM はフェーズを丸ごと上書きするため中断しました。" +
            "管理外のルールをダッシュボードで別の zone へ移すか削除してから、もう一度デプロイしてください。" +
            "EDGE_RATE_LIMIT_RPM を外して再デプロイしてはいけません（Ruleset の削除はフェーズ全体を空にするので、" +
            "ここに挙げた管理外のルールも消えます）",
        );
      }
    } else if (entrypointRes.status !== 404) {
      // 404 = entrypoint 未作成（ルールなし）。それ以外は権限不足などの異常
      throw new Error(
        `http_ratelimit エントリポイントの確認に失敗しました（HTTP ${entrypointRes.status}）。` +
          "CLOUDFLARE_API_TOKEN に対象 zone の WAF 権限があるか確認してください",
      );
    }
  }

  const worker = await Worker("client", {
    name: workerName,
    entrypoint,
    noBundle: true,
    compatibilityDate: "2026-06-01", // wrangler.jsonc の compatibility_date と揃える
    compatibilityFlags: ["nodejs_compat"],
    adopt: true,
    // カスタムドメインがあるときは workers.dev の URL を閉じる。開けたままだと、そのドメインにかけた WAF の
    // レート制限（EDGE_RATE_LIMIT_RPM）を workers.dev 経由で素通りできる（閉じるのはドメインが付いた後。上を参照）
    url: !customDomainAttached,
    observability: { enabled: true, traces: { enabled: true } }, // wrangler.jsonc と揃える
    // Logpush 転送は Worker 側のフラグと LogPushJob の両方が必要（下のブロック参照）
    logpush: logpushDestination !== undefined,
    bindings: {
      ASSETS: await Assets({ path: "apps/client/dist/client" }),
      HYPERDRIVE: hyperdrive,
      NODE_ENV: "production",
      CORS_ORIGIN: appOrigin,
      BETTER_AUTH_URL: appOrigin,
      // /api/health が返すビルド情報。CI（deploy.yml / preview.yml）が環境変数で渡す。
      APP_VERSION: process.env.APP_VERSION || "dev",
      GIT_SHA: process.env.GIT_SHA || "dev",
      // 自動ロールバックはアプリだけを戻し、インフラの定義は今回の commit のものを使う（deploy.yml）
      INFRA_SHA: process.env.INFRA_SHA || process.env.GIT_SHA || "dev",
      BETTER_AUTH_SECRET: alchemy.secret(requireEnv("BETTER_AUTH_SECRET")),
      GOOGLE_CLIENT_ID: alchemy.secret(requireEnv("GOOGLE_CLIENT_ID")),
      GOOGLE_CLIENT_SECRET: alchemy.secret(requireEnv("GOOGLE_CLIENT_SECRET")),
    },
  });

  console.info(`[alchemy] worker=${workerName} url=${worker.url ?? "(workers.dev URL 無効)"}`);

  // ---- カスタムドメイン（opt-in） ----------------------------------------
  // DNS レコード・TLS 証明書は Cloudflare が自動管理。appOrigin はこのドメインから
  // 導出済みなので、Better Auth / CORS の URL も自動で一致する。
  if (customDomain) {
    await CustomDomain("custom-domain", {
      name: customDomain,
      workerName,
      adopt: true,
    });
    console.info(`[alchemy] custom domain=${customDomain} -> ${workerName}`);
    // ドメインを足したデプロイでは Worker を workers.dev を開けたまま更新している。ドメインで応答が返るのを確かめてから
    // 同じデプロイの中で閉じる（開けたままだと、ドメインにかけた WAF のレート制限を workers.dev 経由で素通りできる）。
    // 応答が返らなければ開けたままにする（次のデプロイで Worker の url: false が閉じる）
    if (!customDomainAttached) {
      if (await waitUntilServing(`https://${customDomain}`)) {
        const cfApi = await createCloudflareApi();
        const res = await cfApi.post(
          `/accounts/${cfApi.accountId}/workers/scripts/${workerName}/subdomain`,
          { enabled: false },
        );
        if (!res.ok) {
          throw new Error(`workers.dev の URL を閉じられませんでした（HTTP ${res.status}）`);
        }
        console.info("[alchemy] ドメインの応答を確かめたので workers.dev の URL を閉じました");
      } else {
        console.info(
          "[alchemy] ドメインがまだ応答しないので workers.dev の URL を開けたままにします（次のデプロイで閉じる）",
        );
      }
    }
  }

  // ---- エッジレート制限（opt-in・zone の http_ratelimit フェーズを専有） ----
  // アプリ内の rate-limit ミドルウェア（isolate ローカル）より手前、Cloudflare エッジで
  // IP ごとに /api/* を制限する。無料プランの制約（period/mitigation_timeout = 10 秒固定）に
  // 合わせて RPM を 10 秒あたりに換算する。ホスト名でスコープしているが、entrypoint の
  // 「専有」は zone 単位なので、上の EDGE_RATE_LIMIT_RPM の注意書きを必ず読むこと。
  if (customDomain && edgeRateLimitRpm !== undefined) {
    const requestsPer10s = Math.max(1, Math.round(edgeRateLimitRpm / 6));
    await Ruleset("edge-rate-limit", {
      zone: customDomain,
      phase: "http_ratelimit",
      description: `${workerName}: /api/* rate limit (managed by alchemy)`,
      rules: [
        {
          description: `${ruleMarker} limit /api/* to ${edgeRateLimitRpm} req/min per IP`,
          expression: `(http.host eq "${customDomain}" and starts_with(http.request.uri.path, "/api/"))`,
          action: "block",
          ratelimit: {
            characteristics: ["cf.colo.id", "ip.src"],
            period: 10,
            requests_per_period: requestsPer10s,
            mitigation_timeout: 10,
          },
        },
      ],
    });
    console.info(
      `[alchemy] edge rate limit=${edgeRateLimitRpm} rpm (${requestsPer10s}/10s) on ${customDomain}/api/*`,
    );
  }

  // ---- Logpush（opt-in・Workers Paid） -----------------------------------
  // Worker の logpush フラグ（上の Worker 定義）とセット。dataset は Worker の
  // console.log / 例外 / メタデータを含む workers_trace_events（アカウントレベル）。
  if (logpushDestination) {
    await LogPushJob("worker-logpush", {
      name: `${workerName}-trace`,
      dataset: "workers_trace_events",
      destination: alchemy.secret(logpushDestination),
      enabled: true,
    });
    console.info(`[alchemy] logpush job=${workerName}-trace (workers_trace_events)`);
  }
}

console.info(`[alchemy] stage=${stage} hyperdrive=${hyperdrive.hyperdriveId}`);
console.info(`[alchemy] planetscale db=${dbDisplayName} role=${dbRole.username}`);

// CI の migrate フェーズへ DATABASE_URL を渡す。値はログに出さずマスク登録のみ行う
// （::add-mask:: 以降、GitHub Actions のログでこの値は *** に置換される）。
if (process.env.GITHUB_ENV) {
  const databaseUrl = dbRole.connectionUrl.unencrypted;
  console.info(`::add-mask::${databaseUrl}`);
  appendFileSync(process.env.GITHUB_ENV, `DATABASE_URL=${databaseUrl}\n`);
}

// ローカルでのマイグレーション/デバッグ用の取り出し口。
// シークレットのログ漏えい防止のため、明示的に要求されたときだけ表示する。
// CI では絶対に有効化しないこと。
if (process.env.SHOW_DATABASE_URL === "1" && !process.env.CI) {
  console.info(`[alchemy] DATABASE_URL=${dbRole.connectionUrl.unencrypted}`);
}

// finalize は「state にあるが今回宣言されなかったリソース」を削除する。SKIP_WORKER=1 の段は Worker 以降を
// 宣言しないため、ここで finalize すると稼働中の Worker（と CustomDomain / Ruleset / LogPushJob）が消え、
// migrate の間サービスが止まる（migrate が失敗すると消えたまま残る）。宣言から外したリソースの削除は
// 全リソースを宣言する Worker の段の finalize に任せる（作成済みリソースの state は finalize を待たずに保存される）。
//
// ローカル（CI 以外）のデプロイでは finalize しない（リソースを削除しない）。GitHub Environment にしか無い変数
// （EDGE_RATE_LIMIT_RPM・LOGPUSH_DESTINATION 等）を入れ忘れると、その宣言が外れて finalize が稼働中のリソースを
// 削除する。宣言から外したリソースの削除は、Environment の変数でデプロイする CI に限る
if (process.env.SKIP_WORKER !== "1") {
  if (process.env.CI) {
    await app.finalize();
  } else {
    console.info(
      "[alchemy] ローカルのデプロイなので、宣言から外れたリソースは削除しません（削除は CI のデプロイで行われる）",
    );
  }
}
