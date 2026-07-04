import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getSessionServerFn } from "@/features/auth";

export const Route = createFileRoute("/_authenticated")({
  loader: async () => {
    const user = await getSessionServerFn();
    if (!user) {
      throw redirect({ to: "/signin" });
    }
    return { user };
  },
  component: () => <Outlet />,
});
