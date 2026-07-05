"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createTask } from "../actions/create-task";

export function CreateTaskForm() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await createTask({ title: title.trim() });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setTitle("");
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor="task-title" className="text-sm font-medium">
        タスクのタイトル
      </label>
      <div className="flex gap-2">
        <Input
          id="task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 資料を作成する"
          className="flex-1"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || title.trim().length === 0}>
          追加
        </Button>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
