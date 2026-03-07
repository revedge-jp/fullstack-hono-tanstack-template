export async function onRequestError(
  error: { digest: string } & Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
  },
) {
  // GCP Cloud Error Reporting 互換の JSON 構造化ログ
  console.error(
    JSON.stringify({
      severity: "ERROR",
      message: `Unhandled request error: ${error.message}`,
      digest: error.digest,
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
    }),
  );
}
