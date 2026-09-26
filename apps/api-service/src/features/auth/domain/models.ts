/**
 * 認証済みユーザーのドメインモデル。
 * Better Auth の session から復元する値オブジェクト。
 */
type AuthUserId = string & { readonly _brand: "AuthUserId" };

export type AuthUser = {
  readonly id: AuthUserId;
  readonly email: string;
  readonly name: string;
};

export function reconstituteAuthUser(raw: { id: string; email: string; name: string }): AuthUser {
  return {
    id: raw.id as AuthUserId,
    email: raw.email,
    name: raw.name,
  };
}
