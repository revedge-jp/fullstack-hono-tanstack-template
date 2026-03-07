import "dotenv/config";
import { prisma } from "../src/index";

async function main() {
  // biome-ignore lint/suspicious/noConsole: シードスクリプトではログ出力が必要
  console.log("🌱 Seeding database...");

  // =====================================================
  // ここにシードデータを追加
  // =====================================================

  // 例: ユーザーの作成
  // const user = await prisma.user.upsert({
  //   where: { email: "admin@example.com" },
  //   update: {},
  //   create: {
  //     email: "admin@example.com",
  //     name: "Admin User",
  //   },
  // });
  // console.log(`Created user: ${user.email}`);

  // 例: タスクの作成
  // const tasks = await prisma.task.createMany({
  //   data: [
  //     { title: "サンプルタスク1", status: "pending" },
  //     { title: "サンプルタスク2", status: "done" },
  //   ],
  //   skipDuplicates: true,
  // });
  // console.log(`Created ${tasks.count} tasks`);

  // biome-ignore lint/suspicious/noConsole: シードスクリプトではログ出力が必要
  console.log("✅ Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
