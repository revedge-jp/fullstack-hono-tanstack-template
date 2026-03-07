import type { Metadata } from "next";
import Image from "next/image";
import { ServerDemo } from "@/widgets/demo";

export const metadata: Metadata = {
  title: "Home",
  description: "ax-saas-template のホームページ",
};

// 動的レンダリングを強制（ビルド時にAPIを呼び出さない）
// データキャッシュは fetch の next.revalidate で制御
export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center bg-white px-16 py-32 sm:items-start dark:bg-black">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />

        <ServerDemo className="mt-4" />
      </main>
    </div>
  );
}
