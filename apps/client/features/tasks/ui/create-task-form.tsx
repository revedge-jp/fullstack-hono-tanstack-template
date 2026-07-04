"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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
    const result = await createTask({ title });
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
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクのタイトル"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm shadow-xs"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || title.trim().length === 0}>
          追加
        </Button>
      </div>
      {message && <p className="text-sm text-destructive">{message}</p>}
    </form>
  );
}
