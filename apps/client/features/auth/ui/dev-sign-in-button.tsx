import { cn } from "@/shared/lib/utils";
import { buttonVariants } from "@/shared/ui/shadcn";

// ローカル開発専用のログインバイパス。Google OAuth を経由せず、
// api-service の /api/dev/login (本番では 404) を叩いてセッション Cookie を発行する。
export function DevSignInButton() {
  return (
    <a href="/api/dev/login" className={cn(buttonVariants({ variant: "secondary" }))}>
      （開発用）テストユーザーでサインイン
    </a>
  );
}
