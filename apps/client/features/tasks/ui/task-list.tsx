"use client";

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { advanceTaskServerFn } from "../actions/advance-task";
import { deleteTaskServerFn } from "../actions/delete-task";
import type { TaskItem } from "../queries/get-tasks";

const STATUS_LABEL: Record<string, string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
};

export function TaskList({ items }: { items: TaskItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleAdvance(id: string) {
    setPendingId(id);
    await advanceTaskServerFn({ data: { id } });
    setPendingId(null);
    await router.invalidate();
  }

  async function handleDelete(id: string) {
    setPendingId(id);
    await deleteTaskServerFn({ data: { id } });
    setPendingId(null);
    await router.invalidate();
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">タスクはまだありません。</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((task) => (
        <li
          key={task.id}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div className="flex flex-col">
            <span className="font-medium text-sm">{task.title}</span>
            <span className="text-xs text-zinc-500">
              {STATUS_LABEL[task.status] ?? task.status}
            </span>
          </div>
          <div className="flex gap-1">
            {task.status !== "done" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pendingId === task.id}
                onClick={() => handleAdvance(task.id)}
              >
                次へ進める
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pendingId === task.id}
              onClick={() => handleDelete(task.id)}
            >
              削除
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
