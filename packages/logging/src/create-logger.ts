/** biome-ignore-all lint/suspicious/noConsole: console is the log sink itself (Workers-safe stream) */
import pino from "pino";

export type CreateLoggerOptions = {
  service: string;
  version?: string;
  level?: string;
  environment?: string;
};

// Cloudflare Workers（本番・および wrangler/vite-plugin のローカル emulation 両方）の標準的な検出方法。
// client アプリは開発時でも @cloudflare/vite-plugin 経由で workerd 上で動くため、
// NODE_ENV=development であっても worker_threads は使えない。
// そのため「development か」ではなく「Workers ランタイムか」で出力先を判定する。
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

// pino の Node ビルドは `browser` オプションを無視し、stream 引数を渡さない限り常に
// SafeSonicBoom（内部で WeakRef 等の Node 専用APIを使う）を構築しようとする。Workers
// ランタイムにはそれらが無いため、stream を明示的に渡してデフォルトの destination
// 構築自体を完全にスキップさせる。console 呼び出しのみに依存する。
// レベルに応じて console.error / console.warn を使い分けることで、
// Cloudflare ダッシュボード側のログ重要度表示を正しくする。
const WARN_LEVEL = 40;
const ERROR_LEVEL = 50;

// Cloudflare Workers Observability は、ログ JSON の `error` / `err` キーの値を
// `$metadata.error` に取り込む。ダッシュボードの既定フィルタ `exists($metadata.error)` は
// それを「Errors」として数えるため、warn 以下のログ(業務上の拒否・fail-open の失敗など、
// ユーザー操作には影響しないもの)がこの2つのキーを使うと、本物の異常(5xx・未捕捉例外)が
// その中に埋もれる(実測で1日あたり大半が正常な401だった)。
//
// マップされるのはこの2キー「だけ」であることは使い捨て Worker を本番アカウントへ
// 一時デプロイして実測済み。error / err は載り、errorCode / errCode / error_code /
// exception / reason / resultCode / failure / errors / code / message / detail は載らない。
//
// 各呼び出し箇所の規約でこれを守るのは現実的でない(pino の `err` はスタックを直列化する
// 既定シリアライザのキーでもあり、自然に使われる)ため、ログ生成の出口で一元的に退避させる。
// 退避先の `failure` はこの関数の予約キー。level が 50 以上のログは意図的に対象外
// (5xx・未捕捉例外は `$metadata.error` に載って検知されるべき)。
//
// **この退避は Workers 用 stream にしか無い**(下の pino-pretty / stdout の分岐は通らない)。
// CF Observability の都合による対策であり、他のログシンクでは不要なため。
//
// **redact との順序に注意**: pino の redact は直列化時、つまりこの関数より前に適用される。
// したがって REDACT_PATHS は常に退避「前」のキー名(`err.*` / `error.*`)を指す必要がある。
// 出力を見て `failure.*` を REDACT_PATHS に足しても無言で何もしない。
function moveErrorKeysOutOfIndex(obj: Record<string, unknown>): Record<string, unknown> {
  // 大多数のログ(リクエスト毎のアクセスログ等)はこの2キーを持たない。最頻経路で
  // 中間オブジェクトを作らないよう、判定だけで抜ける。
  if (obj.error === undefined && obj.err === undefined) {
    return obj;
  }
  const { error, err, failure: callerFailure, ...rest } = obj;
  const moved = {
    ...(error === undefined ? {} : { error }),
    ...(err === undefined ? {} : { err }),
  };
  return {
    ...rest,
    // 予約キーが既に使われていた場合でも呼び出し側の値は落とさない(退避分をネストする)。
    failure: callerFailure === undefined ? moved : { original: callerFailure, ...moved },
  };
}

const workersConsoleStream = {
  write(msg: string) {
    try {
      const obj = JSON.parse(msg);
      const level = typeof obj.level === "number" ? obj.level : 0;
      if (level >= ERROR_LEVEL) {
        console.error(obj);
      } else if (level >= WARN_LEVEL) {
        console.warn(moveErrorKeysOutOfIndex(obj));
      } else {
        console.log(moveErrorKeysOutOfIndex(obj));
      }
    } catch {
      console.log(msg);
    }
  },
};

// 個別のログ呼び出しは機微情報を渡さないよう慎重に書かれているが、将来
// logger.info({ password }) や logger.info({ user }) のような呼び出しが紛れ込んだ
// 場合の最終防御網として、pino 自体にも redact を設定しておく（値は "[Redacted]"
// に置換される）。pino の "*.xxx" はルート直下の各キーの1階層下にのみ掛かり、
// ルート直下の xxx 自体には掛からないため、フィールド名ごとに素の名前と
// "*.名前" の両方を列挙する（2階層以上ネストした場合は捕捉できない — pino は
// 再帰ワイルドカードを持たないため、既知の深いパスは req.headers.* のように
// 個別に列挙する）。
const SENSITIVE_FIELD_NAMES = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "cookie",
  "authorization",
];
const REDACT_PATHS = [
  ...SENSITIVE_FIELD_NAMES,
  ...SENSITIVE_FIELD_NAMES.map((name) => `*.${name}`),
  "req.headers.authorization",
  "req.headers.cookie",
];

export function createLogger(options: CreateLoggerOptions) {
  const { service, version, level, environment } = options;
  const base = { service, ...(version ? { version } : {}) };

  if (environment === "test") {
    return pino({ level: "silent" }, workersConsoleStream);
  }

  // Workers ランタイム（本番の CF Workers・および client 開発時の workerd emulation）:
  // worker_threads / sonic-boom が使えないため console ベースの stream に固定する。
  if (isCloudflareWorkersRuntime()) {
    return pino(
      {
        level: level ?? (environment === "development" ? "debug" : "info"),
        base,
        redact: REDACT_PATHS,
      },
      workersConsoleStream,
    );
  }

  if (environment === "development") {
    // ローカル開発（api-service を Bun で直接起動する場合）: pino-pretty で見やすく整形する。
    // pino-pretty（transport）は worker_threads を使うため Workers ランタイムでは使えない。
    return pino({
      level: level ?? "debug",
      base,
      redact: REDACT_PATHS,
      transport: { target: "pino-pretty" },
    });
  }

  // Bun / Node の本番実行（コンテナ等）: pino デフォルトの stdout 出力（NDJSON）。
  // console.log(object) は util.inspect 形式になり構造化ログでなくなるため、
  // Workers 以外の本番で console ベースの stream を使ってはいけない。
  return pino({ level: level ?? "info", base, redact: REDACT_PATHS });
}
