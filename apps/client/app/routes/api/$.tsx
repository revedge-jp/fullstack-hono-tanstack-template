import { createFileRoute } from "@tanstack/react-router";

import { getHonoApp } from "@/shared/lib/hono-app";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) => getHonoApp().fetch(request),
    },
  },
});
