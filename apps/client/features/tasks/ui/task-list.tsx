import { useQueryClient } from "@tanstack/react-query";
import { ListTodo } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/patterns/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/shared/lib/action-error";

import { advanceTask } from "../actions/advance-task";
import { deleteTask } from "../actions/delete-task";
import type { TaskItem } from "../queries/schemas";

const STATUS_LABEL: Record<string, string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
};

export function TaskList({ items }: { items: TaskItem[] }) {
  const queryClient = useQueryClient();
  // 送信中のタスクを行ごとに持つ。1 つの ID で持つと、A の送信中に B を押した時点で A のボタンが押せるように
  // 戻り（二重送信で todo → done まで進む）、先に終わった方がもう片方の送信中の表示も解除する
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  // 削除は元に戻せないので、確認ダイアログで対象を見せてから実行する（.claude/rules/client.md「状態を必ず作る」）。
  // 対象は閉じても残す。閉じるアニメーションの間にタスク名が消えて見えないように
  const [deleteTarget, setDeleteTarget] = useState<TaskItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function run(task: TaskItem, action: (input: { id: string }) => Promise<ActionResult>) {
    setPendingIds((current) => new Set(current).add(task.id));
    setMessage(null);
    try {
      const result = await action({ id: task.id });
      if (!result.ok) {
        // どのタスクの失敗かが分かるように、タイトルを添える
        setMessage(`【${task.title}】：${result.message}`);
        return;
      }
      // 一覧を取り直すまで送信中のままにする。先に戻すと、古い表示（未着手）のまま押し直せて
      // API は更新後の状態（進行中）から進めるので、2 段進む
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function confirmDelete() {
    if (deleteTarget === null) {
      return;
    }
    setDeleteOpen(false);
    void run(deleteTarget, deleteTask);
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo />}
        title="タスクはまだありません"
        description="上のフォームから最初のタスクを追加できます。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((task) => (
          <li
            key={task.id}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{task.title}</span>
              <span className="text-xs text-muted-foreground">
                {STATUS_LABEL[task.status] ?? task.status}
              </span>
            </div>
            <div className="flex gap-2">
              {task.status !== "done" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingIds.has(task.id)}
                  onClick={() => run(task, advanceTask)}
                >
                  次へ進める
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingIds.has(task.id)}
                onClick={() => {
                  setDeleteTarget(task);
                  setDeleteOpen(true);
                }}
              >
                削除
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle>タスクの削除</AlertDialogTitle>
            <AlertDialogDescription>
              以下のタスクを削除しますか？　この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">削除するタスク</dt>
            <dd className="text-sm font-medium">{deleteTarget?.title}</dd>
          </dl>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
