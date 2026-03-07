import { Skeleton } from "@/components/ui/skeleton";

export function UsersListSkeleton() {
  const placeholders = ["a", "b", "c", "d"] as const;
  return (
    <div className="space-y-2">
      {placeholders.map((id) => (
        <div key={id} className="flex items-center gap-3">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
