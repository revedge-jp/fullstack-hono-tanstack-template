// レート制限（middlewares/rate-limit.ts）と Better Auth（ipAddressHeaders）は接続元を CF-Connecting-IP で見る。
// Workers では Cloudflare が付け直すが、Bun で直接受けるとクライアントが自由に書けるので、送られてきた値を捨てて
// 実際の接続元を入れる。プロキシの後ろで動かすなら、信頼するプロキシのヘッダーから取るようにここを変える
export function withConnectingIp(req: Request, ip: string | undefined): Request {
  const headers = new Headers(req.headers);
  headers.delete("x-forwarded-for");
  if (ip) {
    headers.set("CF-Connecting-IP", ip);
  } else {
    headers.delete("CF-Connecting-IP");
  }
  // new Request(req, { headers }) にしない: Bun は headers が空だと元のリクエストのヘッダーを残す（1.4.0 で確認）
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(req.url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : null,
    redirect: req.redirect,
    signal: req.signal,
  });
}
