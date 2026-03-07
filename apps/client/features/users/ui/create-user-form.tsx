import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { createUserFn } from "@/features/users/actions/create";

export function CreateUserForm() {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const mutation = useMutation({
    mutationFn: (data: { email: string; name?: string }) => createUserFn({ data }),
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["users"] });
        formRef.current?.reset();
      }
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const name = formData.get("name") as string;
    mutation.mutate({ email, name: name || undefined });
  }

  const error = mutation.data?.ok === false ? mutation.data.message : null;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex max-w-md flex-col gap-3">
      <input
        name="email"
        type="email"
        placeholder="email@example.com"
        required
        className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
      />
      <input
        name="name"
        type="text"
        placeholder="optional name"
        className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
      />
      {error ? (
        <div className="text-red-600 text-sm" role="alert">
          {error}
        </div>
      ) : null}
      <div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating..." : "Create"}
        </Button>
      </div>
    </form>
  );
}
