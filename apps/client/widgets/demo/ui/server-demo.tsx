import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateUserForm, UsersList } from "@/features/users";
import { cn } from "@/shared/lib/utils";
import { UsersListSkeleton } from "./users-list-skeleton";

type DemoProps = {
  className?: string;
};

export function Demo({ className }: DemoProps) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="font-semibold text-lg">Demo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-2">
          <h3 className="font-medium text-sm text-zinc-700 dark:text-zinc-300">
            Create user (Server Function)
          </h3>
          <CreateUserForm />
        </section>

        <div className="border-zinc-200 border-t dark:border-zinc-800" />

        <section className="space-y-2">
          <h3 className="font-medium text-sm text-zinc-700 dark:text-zinc-300">Users list</h3>
          <Suspense fallback={<UsersListSkeleton />}>
            <UsersList />
          </Suspense>
        </section>
      </CardContent>
    </Card>
  );
}
