import { zValidator as baseZValidator } from "@hono/zod-validator";

// 値をログに残しても安全な(氏名・金額・メモ等の個人情報/機微情報を含まない)フィールド名の
// ホワイトリスト。内部IDのみで、ここに無いフィールドの値は絶対にログへ出さない。
// "id" は各 feature の `:id` パスパラメータ(例: z.object({ id: z.uuid() }))の共通キーで、
// 中身は常にその feature 自身のエンティティIDのみ。ID系フィールドを増やしたらここへ追加する
// (追加してよいのは「値が内部IDである」ことが構造的に保証されるフィールド名だけ)。
const SAFE_TO_LOG_FIELD_NAMES = new Set(["id", "taskId", "ids"]);

function getValueAtPath(data: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
}

// zod は配列要素の検証失敗時、issue.path の末尾を要素の数値indexにする(例: ["ids", 2])。
// この場合のホワイトリスト判定はその1つ手前(配列自体のフィールド名)で行う — 配列自体が
// ID専用フィールドなら要素の値も安全にログ可能(末尾が数値のままだと配列要素は常に
// 非ロギング扱いになる)。
function resolveLoggableFieldName(path: ReadonlyArray<PropertyKey>): string | undefined {
  const lastKey = path[path.length - 1];
  if (typeof lastKey === "string") {
    return lastKey;
  }
  const parentKey = path[path.length - 2];
  return typeof parentKey === "string" ? parentKey : undefined;
}

// zod スキーマ検証で 400 になった場合に「どのフィールドがなぜ弾かれたか」をアクセスログと
// 同じ requestId で相関できるよう構造化ログに残す(本番で 400 連発が起きた際、アクセスログの
// status だけでは理由を後から特定できないため)。リクエスト値そのもの(名前・金額等)は
// 原則ログに含めないが、SAFE_TO_LOG_FIELD_NAMES に載っているID系フィールドに限り、
// 実際に送信された値(文字列のときのみ)を残す(「Invalid UUID」で弾かれ続ける原因は
// 値を見ないと特定できない)。
// ホワイトリスト判定(安価なSet参照)を rawData の走査より先に行う — 大半のissueは
// ホワイトリスト外のフィールドで、その場合 getValueAtPath の走査は無駄になるため。
// rawData は zValidator フックに渡る検証前の生値(@hono/zod-validator は失敗時、
// hook 引数の data に validator へ渡した生の値をそのまま乗せる)。
// error は zod v4 の $ZodError(z.ZodError と型非互換)も受けられるよう構造的な最小型にする。
function logRequestSchemaFailure(
  logger: { warn(obj: unknown, msg?: string): void } | undefined,
  error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> },
  rawData: unknown,
): void {
  logger?.warn(
    {
      issues: error.issues.map((issue) => {
        const fieldName = resolveLoggableFieldName(issue.path);
        const isWhitelisted = fieldName !== undefined && SAFE_TO_LOG_FIELD_NAMES.has(fieldName);
        const value = isWhitelisted ? getValueAtPath(rawData, issue.path) : undefined;
        const canLogValue = isWhitelisted && typeof value === "string";
        return {
          path: issue.path.join("."),
          message: issue.message,
          ...(canLogValue ? { value } : {}),
        };
      }),
    },
    "request_validation_failed",
  );
}

// 呼び出し側の hook を「失敗時に診断ログを出してから委譲する」hook に差し替えた引数列を作る。
// hook への委譲により、param 検証で 404 を返すような使い方は変わらない。
// hook が無い/何も返さない場合に zValidator の既定 400 応答が使われるのも本家と同じ。
function withDiagnosticLog(
  args: Parameters<typeof baseZValidator>,
): Parameters<typeof baseZValidator> {
  const [target, schema, hook, options] = args;
  return [
    target,
    schema,
    (result, c) => {
      if (!result.success) {
        logRequestSchemaFailure(c.get("logger"), result.error, result.data);
      }
      return hook?.(result, c);
    },
    options,
  ];
}

// zValidator 経由のすべての 400 で診断ログを自動的に出すための共有ラッパー。
// 本家 zValidator はジェネリクスつきオーバーロード2本の関数型で、通常のラッパー関数は
// この型へ `as` なしでは代入できない(戻り値の MiddlewareHandler 第4型引数が各オーバーロード
// で異なるため)。Proxy なら公開型を本家の `typeof baseZValidator` のまま保てるので、
// ルート定義側の c.req.valid / Hono RPC(AppType) の型推論が一切変わらない。
// 引数列の組み替えは位置ベース(第3引数=hook, 第4引数=options)のため、ライブラリ更新で
// 並びが変わると型を通ったまま実行時に壊れうる。この契約は z-validator.test.ts
// (既定400・hook委譲)が本家実体を通して固定しており、@hono/zod-validator 更新で
// それらが落ちたらここを見直すこと。
export const zValidator: typeof baseZValidator = new Proxy(baseZValidator, {
  apply(fn, thisArg: unknown, argumentsList: Parameters<typeof baseZValidator>) {
    return Reflect.apply(fn, thisArg, withDiagnosticLog(argumentsList));
  },
});
